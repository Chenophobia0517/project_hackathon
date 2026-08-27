// Evidence Graph（V2.5 M4）：基础证据独立性分析——避免多个转载页被误认为多份独立证据。
// 升级要求 §9：识别 A cites B 关系并按「证据簇」归组；完整 Source Graph 不在本期范围。
// TQ4 原则：只标「疑似同一来源」（cluster 判定保守），宁可漏判不可错杀。
(function (global) {
  'use strict';

  var URL_UTILS = global.WCC_URL_UTILS;

  // ---------- 文本相似度（bigram Dice，与 V2.0 search-controller 同实现口径） ----------

  function bigrams(s) {
    var set = {};
    var n = 0;
    s = String(s || '').replace(/\s+/g, '');
    for (var i = 0; i < s.length - 1; i++) {
      var g = s.slice(i, i + 2);
      if (!set[g]) { set[g] = 0; n++; }
      set[g]++;
    }
    return { set: set, count: n };
  }

  function diceSimilarity(a, b) {
    var A = bigrams(a), B = bigrams(b);
    if (!A.count || !B.count) return 0;
    var inter = 0;
    for (var g in A.set) {
      if (B.set[g]) inter += Math.min(A.set[g], B.set[g]);
    }
    return 2 * inter / (A.count + B.count);
  }

  // ---------- 相似度阈值（search_advise §17：转载分级，不再一刀切） ----------
  // duplicate：标题 ≥0.82 且摘要 ≥0.72（原阈值，确凿重复）
  // likely_syndication：标题 ≥0.70，或标题 ≥0.55 且摘要 ≥0.65（改标题转载常见形态）
  // possible_syndication：标题 ≥0.50 且摘要 ≥0.45（弱信号，仅标记不强制入簇）
  var TITLE_THRESHOLD = 0.82;
  var SNIPPET_THRESHOLD = 0.72;

  // §17.1：返回 { level: 'duplicate'|'likely_syndication'|'possible_syndication'|null, titleSim, snippetSim }
  // duplicate：标题 ≥0.82 且摘要 ≥0.72（确凿重复）
  // likely_syndication：标题 ≥0.70；或标题略改但摘要高度重合（改标题转载：标题 ≥0.40 且摘要 ≥0.60）
  // possible_syndication：弱信号（标题 ≥0.40 且摘要 ≥0.40），仅标记不并入簇
  function looksLikeSyndication(a, b) {
    var titleSim = diceSimilarity(a.title, b.title);
    var snippetSim = diceSimilarity(a.snippet, b.snippet);
    var level = null;
    if (titleSim >= TITLE_THRESHOLD && snippetSim >= SNIPPET_THRESHOLD) level = 'duplicate';
    else if (titleSim >= 0.70 || (titleSim >= 0.40 && snippetSim >= 0.60)) level = 'likely_syndication';
    else if (titleSim >= 0.40 && snippetSim >= 0.40) level = 'possible_syndication';
    return { similar: level !== null, level: level, titleSim: titleSim, snippetSim: snippetSim };
  }

  // 领域先验：同一媒体矩阵的固定二级域名互相转载概率极高（如 sogou/sohu 家族）
  var DOMAIN_FAMILIES = [
    ['sina.com', 'sina.cn', 'k.sina.com.cn'],
    ['sohu.com', 'changxiang.cn'],
    ['toutiao.com', 'dongchedi.com']
  ];
  function sameDomainFamily(urlA, urlB) {
    var ha = extractHostLoose(urlA), hb = extractHostLoose(urlB);
    return DOMAIN_FAMILIES.some(function (fam) {
      return fam.some(function (d) { return ha.indexOf(d) >= 0; }) &&
             fam.some(function (d) { return hb.indexOf(d) >= 0; });
    });
  }
  function extractHostLoose(url) {
    var m = String(url || '').toLowerCase().match(/^https?:\/\/([^\/?#]+)/);
    return m ? m[1] : '';
  }

  // ---------- 对外入口 ----------

  // buildClusters(items) -> items'（每条注入 evidenceClusterId / syndicationLevel）+ 统计
  // 聚类策略：贪心合并——按序遍历，与已有簇代表比对；命中则归入该簇，否则自立新簇。
  // 代表取每簇第一条（排序后通常是权威最高者，M5 排序后再调用效果更好）。
  // §17.2：duplicate / likely_syndication 入簇；possible_syndication 只标记不并入（保守，宁漏判不错杀）。
  function buildClusters(items) {
    var clusters = []; // [{rep: item, members: [item]}]
    items.forEach(function (it) {
      var placed = false;
      for (var c = 0; c < clusters.length; c++) {
        var rep = clusters[c].rep;
        var sim = looksLikeSyndication(it, rep);
        var familyTie = sim.titleSim >= TITLE_THRESHOLD && sameDomainFamily(rep.url, it.url);
        if ((sim.similar && sim.level !== 'possible_syndication') || familyTie) {
          it.evidenceClusterId = 'ec-' + c;
          it.sameAsOriginal = rep;          // 引用关系：it 疑似转载自 rep（§9 A cites B 的基础形态）
          it.simTitle = Number(sim.titleSim.toFixed(2));
          it.simSnippet = Number(sim.snippetSim.toFixed(2));
          it.syndicationLevel = sim.level || 'likely_syndication';
          it.suspectedSyndication = true;   // 「疑似」标记：保守判定，允许下游豁免
          clusters[c].members.push(it);
          placed = true;
          break;
        }
        if (sim.similar && sim.level === 'possible_syndication') {
          // 弱信号：标记但不并入簇（避免错杀独立来源）
          it.syndicationLevel = 'possible_syndication';
        }
      }
      if (!placed) {
        it.evidenceClusterId = 'ec-' + clusters.length;
        it.sameAsOriginal = null;
        it.suspectedSyndication = false;
        if (!it.syndicationLevel) it.syndicationLevel = null;
        clusters.push({ rep: it, members: [it] });
      }
    });
    return {
      items: items,
      totalItems: items.length,
      clusterCount: clusters.length,
      syndicationCount: items.length - clusters.length,
      independentCount: clusters.length   // §18：独立证据数 = 簇数（网页数量 ≠ 独立来源数量）
    };
  }

  global.WCC_EVIDENCE_GRAPH = {
    buildClusters: buildClusters,
    diceSimilarity: diceSimilarity,
    _THRESHOLDS: { TITLE_THRESHOLD: TITLE_THRESHOLD, SNIPPET_THRESHOLD: SNIPPET_THRESHOLD }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
