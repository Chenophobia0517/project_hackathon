// V2.5 溯源管线编排（upgrade.md 集成版）：
// Claim → [Evidence Targeting 前置决策] → Query Analyzer → 多引擎（含显式来源步）→ URL 去重 → Registry
//   → Source Analysis → [Academic Exact-Source 验证] → Evidence Clusters → Scoring → [Provenance Tracing]
//   → Top-N 多样性 → Web Reader → 五态结论 → [Binding + Hard Validation]。
// 保留机制（upgrade.md §3）：双核召回、中文关键词、keywordsEn、官方域 Query、八维评分、
//   preferredSources、firstPartyBonus、转载分级、Top-6 多样性、Evidence Binding、硬降级。
(function (global) {
  'use strict';

  var QA = global.WCC_QUERY_ANALYZER;
  var DS = global.WCC_DATASOURCE;
  var UU = global.WCC_URL_UTILS;
  var REG = global.WCC_SOURCE_REGISTRY;
  var SA = global.WCC_SOURCE_ANALYZER;
  var EG = global.WCC_EVIDENCE_GRAPH;
  var SE = global.WCC_SCORING_ENGINE;
  var READER = global.WCC_WEB_READER;
  var VE = global.WCC_VERIFY_ENGINE;
  // upgrade.md 新增模块
  var ET = global.WCC_EVIDENCE_TARGET;
  var AC = global.WCC_ACADEMIC;
  var PV = global.WCC_PROVENANCE;

  // ---------- 策略级会话缓存（TQ5）----------
  var strategyCache = {}; // claim.text -> strategy
  // 页面级上下文缓存（upgrade.md §5/§14：同页多次验证免重复抓取；10 条 / 10 分钟）
  var pageFetchCache = {};
  function fetchPageContext(url) {
    if (!url || !/^https?:\/\//i.test(String(url))) return Promise.resolve(null);
    var hit = pageFetchCache[url];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit);
    return READER.readUrl(url, { wantHtml: true }).then(function (r) {
      var entry = r.ok ? {
        ok: true,
        text: r.text,
        title: r.title,
        links: (ET && ET.extractExplicitSourcesFromHtml) ? ET.extractExplicitSourcesFromHtml(r.html) : [],
        at: Date.now()
      } : { ok: false, at: Date.now() };
      var keys = Object.keys(pageFetchCache);
      if (keys.length >= 10) delete pageFetchCache[keys[0]];
      pageFetchCache[url] = entry;
      return entry;
    }).catch(function () { return null; });
  }

  // search_advise §5.1：取消硬路由——所有问题类型都跑 Exa + Metaso 双核召回，
  // Zhihu 只做低配额社区补充；questionType 只影响各引擎预算配额，不再排除任何引擎。
  var ENGINE_BUDGET = {
    fact:     { exa: 4, metaso: 4, zhihu: 1 },
    academic: { exa: 5, metaso: 3, zhihu: 1 },
    policy:   { exa: 3, metaso: 5, zhihu: 1 },
    event:    { exa: 5, metaso: 4, zhihu: 1 },
    data:     { exa: 4, metaso: 4, zhihu: 1 },
    open:     { exa: 4, metaso: 4, zhihu: 2 }
  };

  // 产出执行计划：{ steps: [{engine, query, count, opts}], degraded }
  // 步序（upgrade.md §14.3 Source Priority）：显式来源步（Level 0~2）最优先 → 基础双核 → 官方域定向步
  function buildPlan(strategy, claimText, evidenceTarget) {
    var budget = ENGINE_BUDGET[strategy.questionType] || ENGINE_BUDGET.fact;
    var queries = QA.buildQueries(strategy, claimText);
    var zh = queries.zh[0] || String(claimText || '');
    var en = queries.en[0] || zh;
    var official = queries.official || [];

    var steps = [];
    var degraded = false;
    var et = evidenceTarget || {};

    // §14/§15：显式来源步（页面已提供 DOI/URL/arXiv/PMID → 直接取原文，禁止先跳语义搜索）
    (et.explicitSources || []).slice(0, 2).forEach(function (s) {
      var url = null;
      if (s.kind === 'DOI') url = 'https://doi.org/' + s.value;
      else if (s.kind === 'ARXIV') url = 'https://arxiv.org/abs/' + s.value;
      else if (s.kind === 'PMID') url = 'https://pubmed.ncbi.nlm.nih.gov/' + s.value + '/';
      else if (s.kind === 'URL') url = s.value;
      if (url && /^https?:\/\//i.test(url)) {
        steps.push({ engine: 'explicit', query: url, count: 1, opts: { kind: s.kind, value: s.value } });
      }
    });

    if (DS.isExaAvailable()) {
      steps.push({ engine: 'exa', query: en, count: budget.exa, opts: {} });
    } else degraded = true;
    if (DS.isMetasoAvailable()) {
      steps.push({ engine: 'metaso', query: zh, count: budget.metaso, opts: {} });
    } else degraded = true;
    if (DS.isAvailable()) {
      steps.push({ engine: 'zhihu', query: zh, count: budget.zhihu, opts: {} });
    }

    // 官方域名定向步：保证官方源有机会进入候选池（NASA→nasa.gov 等）
    official.slice(0, 2).forEach(function (o) {
      if (DS.isExaAvailable()) steps.push({ engine: 'exa', query: o.query, count: 3, opts: { includeDomains: [o.domain] } });
      if (DS.isMetasoAvailable()) steps.push({ engine: 'metaso', query: o.query, count: 3, opts: { siteDomain: o.domain } });
    });

    if (!steps.length) return { steps: [], degraded: true };
    return { steps: steps, degraded: degraded };
  }

  // ---------- 主流程 ----------
  // verifyClaimV25(claim, meta) -> Promise<verification>
  // meta.context: { title, url, paragraph, surroundingText }（upgrade.md §5 Context Extraction 输入）
  function verifyClaimV25(claim, meta) {
    meta = meta || {};
    var context = meta.context || { paragraph: claim.text };
    var claimText = String(claim.text || '');

    // ① 前置决策层（upgrade.md Phase1）：Evidence Targeting（与 Query Analyzer 并行，省一次串行等待）
    //    同时并行抓取文章页 HTML——论文超链接（<a href>）只有抓页面才能拿到（upgrade.md §14）
    var cachedStrategy = strategyCache[claimText];
    var strategyP = cachedStrategy
      ? Promise.resolve(cachedStrategy)
      : QA.analyzeQuery(claim).then(function (s) {
          s.enginesViaFallback = false;
          strategyCache[claimText] = s;
          return s;
        });
    var targetP = (ET && ET.analyze) ? ET.analyze(claim, context) : Promise.resolve(null);
    var pageP = fetchPageContext(context.url);

    return Promise.all([strategyP, targetP, pageP]).then(function (r) {
      var strategy = r[0];
      var evidenceTarget = r[1];
      var page = r[2];

      // 页面超链接来源并入（论文以超链接引用时，显式来源从这里来；失败则静默降级）
      if (page && page.ok && ET && ET.mergeExplicitSources) {
        ET.mergeExplicitSources(evidenceTarget, page.text, page.links);
      }

      // ② 引擎计划与检索（串行执行各步；显式来源步优先；总候选上限 14）
      var plan = buildPlan(strategy, claimText, evidenceTarget);
      strategy.degradedExternal = plan.degraded;

      var searchSeq = Promise.resolve({ merged: [], enginesUsed: [], queryLog: [] });
      var stepIdx = 0;

      function runStep(acc) {
        if (stepIdx >= plan.steps.length || acc.merged.length >= 14) return acc;
        var step = plan.steps[stepIdx++];
        var q = String(step.query || '').slice(0, 200);
        if (step.engine === 'explicit') {
          // §14 Explicit Source：直接读取原文（Web Reader），不进搜索引擎
          return READER.readUrl(q).then(function (res) {
            if (res.ok) {
              acc.merged.push({
                url: q,
                title: res.title || q,
                snippet: String(res.text || '').slice(0, 300),
                origin: 'global',
                engine: 'explicit',
                isExplicit: true,
                explicitKind: step.opts && step.opts.kind,
                explicitValue: step.opts && step.opts.value,
                publishedDate: null
              });
            }
            acc.enginesUsed.push('explicit(' + (res.ok ? 1 : 0) + ')');
            acc.queryLog.push({ engine: 'explicit', query: q, hits: res.ok ? 1 : 0 });
            return acc;
          }, function () {
            return acc;
          }).then(runStep);
        }
        return DS.engineSearch(step.engine, q, step.count, step.opts).then(function (items) {
          acc.enginesUsed.push(step.engine + '(' + items.length + ')');
          acc.queryLog.push({ engine: step.engine, query: q, hits: items.length });
          acc.merged = acc.merged.concat(items);
          return acc;
        }, function () {
          return acc;
        }).then(runStep);
      }

      return searchSeq.then(runStep).then(function (acc) {
        // ③ URL 规范化去重（§3）
        var dd = UU.dedupeByNormalizedUrl(acc.merged, function (it) { return it.url; });
        var candidates = dd.unique;

        if (!candidates.length) {
          return {
            verdict: 'no_source',
            detail: '多引擎检索无结果',
            evidences: [], readErrors: [],
            queries: acc.queryLog,
            strategy: strategy,
            evidenceTarget: evidenceTarget,
            binding: ET ? ET.buildBinding(null, evidenceTarget, []) : null,
            stats: { rawCount: acc.merged.length, uniqueCount: 0, filteredCount: 0 }
          };
        }

        // ④ Registry 先验 + ⑤ 来源分析（串行防限流）
        candidates.forEach(function (it) { it.registryInfo = REG.lookup(it.url); });
        return SA.analyzeSources(candidates).then(function (analyzed) {
          // §15/§16 Academic Exact-Source 验证：论文候选身份确认（TARGET_PAPER vs RELATED_PAPER）
          if (evidenceTarget && evidenceTarget.claimType === 'ACADEMIC' && AC) {
            var paperTarget = AC.buildTarget(evidenceTarget.explicitSources || [], claimText);
            if (paperTarget && (paperTarget.doi || paperTarget.arxiv || paperTarget.pmid || paperTarget.title)) {
              analyzed.forEach(function (it) {
                var pv = AC.validatePaper(it, paperTarget);
                it.paperStatus = pv.status;
                it.paperMatchedOn = pv.matchedOn;
              });
            }
          }

          // ⑥ 证据聚簇（§9）
          EG.buildClusters(analyzed);
          // ⑦ Scoring 排序（八维 + preferredSources + firstParty + 转载降权）
          var ranked = SE.rank(analyzed, strategy, claimText);

          // ⑧ Provenance Tracing（upgrade.md §17~§24，预算受控；失败不阻断主流程）
          var traceP = (PV && PV.trace)
            ? PV.trace(ranked.ranked.slice(0, 8), claim, { maxUpstreamCandidates: 3, maxPageReads: 3, maxAdditionalSearches: 3 })
              .catch(function () { return { traced: [], upstreamHits: [], stops: ['trace_error'] }; })
            : Promise.resolve({ traced: [], upstreamHits: [], stops: [] });

          return traceP.then(function (traceRes) {
            // 共同上游检测（§23/§28）：注入 provenanceClusterId / independence
            if (PV && PV.buildGraph) PV.buildGraph(ranked.ranked);

            // ⑨ Top-N 多样性验证（§19 + §29：同 provenance 簇不占多个验证位；复用已读正文）
            var topN = ranked.ranked.slice(0, 8);
            return VE.verifyClaim(claim, topN).then(function (v) {
              // ⑩ Binding + Hard Validation（§30/§31/§35）
              var binding = (ET && ET.buildBinding) ? ET.buildBinding(v, evidenceTarget, ranked.ranked) : null;

              v.queries = acc.queryLog;
              v.candidates = ranked.ranked;         // 全量排序候选供面板展示
              v.strategy = strategy;
              v.evidenceTarget = evidenceTarget;    // 前置决策层结果
              v.binding = binding;                  // 绑定 + 硬校验
              v.provenance = {
                traced: traceRes.traced,
                upstreamHits: traceRes.upstreamHits,
                stops: traceRes.stops,
                clusters: ranked.ranked.reduce(function (acc2, c) {
                  if (c.provenanceClusterId && acc2.indexOf(c.provenanceClusterId) < 0) acc2.push(c.provenanceClusterId);
                  return acc2;
                }, []),
                confidence: PV ? PV.confidenceFor(ranked.ranked[0]) : 'NONE'
              };
              v.stats = {
                rawCount: acc.merged.length,
                uniqueCount: ranked.ranked.length,
                filteredCount: ranked.filtered + (acc.merged.length - dd.unique.length),
                clusterCount: Math.min(ranked.ranked.length, (function () {
                  var ids = {};
                  ranked.ranked.forEach(function (c) { ids[c.evidenceClusterId] = 1; });
                  return Object.keys(ids).length;
                })()),
                enginesUsed: acc.enginesUsed,
                independentCount: ranked.ranked.filter(function (c) { return c.independence === 'INDEPENDENT'; }).length,
                sharedUpstreamCount: ranked.ranked.filter(function (c) { return c.independence === 'SHARED_UPSTREAM'; }).length
              };
              return v;
            });
          });
        });
      });
    });
  }

  global.WCC_V25 = {
    verifyClaimV25: verifyClaimV25,
    buildPlan: buildPlan,
    ENGINE_BUDGET: ENGINE_BUDGET,
    _strategyCache: strategyCache
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
