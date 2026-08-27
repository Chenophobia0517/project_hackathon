// Provenance Tracing（upgrade.md §17~§29，P1 + Phase4）
// 搜索后信源追踪：读取媒体/二手正文 → 提取上游线索 → 共同上游检测 → 受控上游检索 → Provenance Graph。
// 原则（§25）：不把"发布时间最早"当绝对首发，只追踪 Earliest Traceable Source；
// 预算（§33）：maxDepth / maxUpstreamCandidates / maxAdditionalSearches / maxPageReads 全部封顶。
(function (global) {
  'use strict';

  // ---------- §19 Provenance Extraction（规则式，零 LLM） ----------
  var UPSTREAM_PATTERNS = [
    // 中文引用："据 X 报道 / 援引 X / 来源 X"
    { re: /(?:据|按照|援引|引自|消息来源|来源|源自)\s*([\u4e00-\u9fa5A-Za-z0-9·]{2,24}?(?:社|通讯社|新闻社|通讯社|方面|官方|中心|部|局|署|委员会|研究所|大学|媒体|报|网|TV|News|Agency|Wire))/g, relation: 'EXPLICIT_CITATION' },
    // 中文转载："编译自 / 转载自 / 转自 / 摘编自 / 综合报道"
    { re: /(?:编译自|翻译自|综合自|转载自|转自|摘编自|内容(?:来源|源自)|本文(?:编译|综合)?(?:自|报道))[\s:：]*([^\s。；;]{2,30})/g, relation: 'REPOST' },
    // 英文引用
    { re: /(?:according to|reported by|as (?:quoted|reported) by|credit[\s:：]*)[\s:：]*([A-Za-z][A-Za-z0-9 .&'-]{2,40})/gi, relation: 'QUOTED_SOURCE' },
    // 原始采访
    { re: /(?:接受|在)[^，。]{0,24}?([\u4e00-\u9fa5A-Za-z]{2,14}?(?:社|TV|电视台|电台|报纸|网|记者|radio|television))[^，。]{0,16}?(?:采访|专访|时说|表示)/g, relation: 'INTERVIEW' }
  ];
  // 直接链接（"原文/来源: http..."）
  var LINK_HINTS = /(?:原文|来源|原报道|原链接|Source|Original|Read more|paper|doi)\s*[：: ]?\s*(https?:\/\/[^\s<>"']+)/gi;

  // 从正文提取上游线索 -> [{publisher, relation, evidence, url?}]
  function extractProvenance(text) {
    var clues = [];
    var seen = {};
    var t = String(text || '');
    if (!t) return clues;

    var i, p;
    for (i = 0; i < UPSTREAM_PATTERNS.length && clues.length < 6; i++) {
      p = UPSTREAM_PATTERNS[i];
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(t)) !== null && clues.length < 6) {
        var name = String(m[1] || '').replace(/[，。；、\s：:]+$/g, '').trim();
        if (name.length >= 2 && !seen[p.relation + '|' + name]) {
          seen[p.relation + '|' + name] = true;
          clues.push({ publisher: name, relation: p.relation, evidence: m[0].slice(0, 60), url: null });
        }
      }
    }
    LINK_HINTS.lastIndex = 0;
    var lm;
    while ((lm = LINK_HINTS.exec(t)) !== null && clues.length < 8) {
      clues.push({ publisher: '', relation: 'EXPLICIT_LINK', evidence: lm[0].slice(0, 60), url: lm[1] });
    }
    return clues;
  }

  // ---------- §23 Common Provenance Detection / §28 Independence ----------
  // 输入：候选（含 provenanceClues）→ 注入 provenanceClusterId / independence / upstreamRoot
  function buildGraph(items) {
    var clusters = [];
    var clusterMap = {};
    items.forEach(function (it) {
      var clues = it.provenanceClues || [];
      // 取第一个非空上游（链接或具名引用）
      var up = null;
      for (var i = 0; i < clues.length; i++) {
        if (clues[i].url || clues[i].publisher) { up = clues[i]; break; }
      }
      if (up) {
        var key = up.url || up.publisher;
        if (!clusterMap[key]) {
          clusterMap[key] = 'pc-' + clusters.length;
          clusters.push({ root: key, rootUrl: up.url || null, members: [], relations: [] });
        }
        var cid = clusterMap[key];
        it.provenanceClusterId = cid;
        it.independence = 'SHARED_UPSTREAM';
        it.upstreamRoot = key;
        clusters[Number(cid.slice(3))].members.push(it.url);
        clusters[Number(cid.slice(3))].relations.push(up.relation);
      } else if (it.suspectedSyndication) {
        it.independence = 'DERIVED';
      } else {
        it.independence = 'INDEPENDENT';
      }
    });
    return { clusters: clusters, items: items };
  }

  // ---------- §24 Upstream Source Retrieval（预算受控） ----------
  // trace(candidates, claim, budget):
  //   只追踪 media/org/疑似转载 候选（≤maxUpstreamCandidates）
  //   读正文（≤maxPageReads）→ 提取线索 → 线索命中上游时做定向检索（≤maxAdditionalSearches）
  //   返回 { traced, upstreamHits, stops }
  function trace(candidates, claim, budget) {
    var READER = global.WCC_WEB_READER;
    var DS = global.WCC_DATASOURCE;
    budget = budget || {};
    var maxUpstream = budget.maxUpstreamCandidates || 3;
    var maxReads = budget.maxPageReads || 3;
    var maxSearches = budget.maxAdditionalSearches || 3;

    var targets = (candidates || []).filter(function (c) {
      var st = c.sourceAnalysis && c.sourceAnalysis.sourceType;
      return st === 'media' || st === 'org' || c.suspectedSyndication;
    }).slice(0, maxUpstream);

    if (!targets.length) return Promise.resolve({ traced: [], upstreamHits: [], stops: ['no_secondary_source'] });

    var chain = Promise.resolve({ reads: 0, searches: 0, stops: [], traced: [], upstreamHits: [] });
    targets.forEach(function (cand) {
      chain = chain.then(function (acc) {
        if (acc.reads >= maxReads) { acc.stops.push('maxPageReads'); return acc; }
        return READER.readUrl(cand.url).then(function (r) {
          acc.reads++;
          cand.cachedBody = r.ok ? r.text : null;
          cand.cachedTitle = r.ok ? r.title : null;
          cand.provenanceClues = r.ok ? extractProvenance(r.text) : [];
          acc.traced.push({ url: cand.url, title: cand.title, clues: cand.provenanceClues });
          if (!r.ok) { acc.stops.push('read_failed_' + r.reason); return acc; }
          var up = cand.provenanceClues[0];
          if (!up || !(up.publisher || up.url)) { acc.stops.push('no_upstream_clue'); return acc; }
          if (acc.searches >= maxSearches) { acc.stops.push('maxAdditionalSearches'); return acc; }
          var query = up.url || (up.publisher + ' ' + String((claim && claim.text) || '').slice(0, 40));
          return DS.engineSearch('metaso', query, 3).catch(function () { return []; }).then(function (hits) {
            acc.searches++;
            hits.slice(0, 2).forEach(function (h) {
              acc.upstreamHits.push({ from: cand.url, clue: up, hit: h });
            });
            return acc;
          });
        }).catch(function () {
          cand.provenanceClues = cand.provenanceClues || [];
          acc.stops.push('trace_error');
          return acc;
        });
      });
    });
    return chain.then(function (acc) { return acc; });
  }

  // ---------- §26 Provenance Confidence（规则版） ----------
  function confidenceFor(item) {
    var clues = (item && item.provenanceClues) || [];
    if (!clues.length) return 'NONE';
    var hasLink = clues.some(function (c) { return c.relation === 'EXPLICIT_LINK' && c.url; });
    var hasCite = clues.some(function (c) { return c.relation === 'EXPLICIT_CITATION' || c.relation === 'QUOTED_SOURCE'; });
    if (hasLink && hasCite) return 'HIGH';
    if (hasLink || hasCite) return 'MEDIUM';
    return 'LOW'; // 仅 REPOST/INTERVIEW/推断
  }

  global.WCC_PROVENANCE = {
    extractProvenance: extractProvenance,
    buildGraph: buildGraph,
    trace: trace,
    confidenceFor: confidenceFor,
    UPSTREAM_PATTERNS: UPSTREAM_PATTERNS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
