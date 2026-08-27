// V2.5 溯源管线编排：Claim → Query Analyzer → 多引擎 → URL 去重 → Registry
//   → Source Analysis → Evidence Clusters → Scoring → Top-N → Web Reader → 五态结论。
// 升级要求 §14 完整链路；§11 动态预算 + 缓存；§12 明确不做完整 Source Graph/Critic。
// TQ3：metaso/exa 未配置时知乎通道兜底，明示降级；TQ5：策略级缓存（同 claim 免重分析）。
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

  // ---------- 策略级会话缓存（TQ5）----------
  var strategyCache = {}; // claim.text -> strategy

  // 根据策略+可用性产出实际引擎队列（TQ3 fallback）
  function resolveEngines(strategy) {
    var base = [];
    if (strategy.questionType === 'academic') base = ['zhihu_global', 'exa', 'metaso'];
    else if (strategy.questionType === 'policy' || strategy.questionType === 'data') base = ['metaso', 'zhihu_global'];
    else if (strategy.questionType === 'event') base = ['metaso', 'zhihu_global'];
    else if (strategy.questionType === 'open') base = ['metaso', 'exa'];
    else base = ['zhihu_global'];

    var avail = base.filter(function (e) {
      if (e === 'metaso') return DS.isMetasoAvailable();
      if (e === 'exa') return DS.isExaAvailable();
      return DS.isAvailable(); // zhihu 系
    });
    // 至少保留知乎通道（TQ3: 增强不是替代）
    if (!avail.length && DS.isAvailable()) avail = ['zhihu_global'];
    var degraded = !!(strategy.dualEngine && !(DS.isMetasoAvailable() && DS.isExaAvailable()));
    return { engines: avail.slice(0, Math.max(1, strategy.budget)), degraded: degraded };
  }

  // ---------- 主流程 ----------
  // verifyClaimV25(claim) -> Promise<verification>（与 V2.0 verify-engine 输出结构兼容，附 v2.5 字段）
  function verifyClaimV25(claim, meta) {
    meta = meta || {};
    // ① Query Analyzer（TQ5 缓存）
    var cachedStrategy = strategyCache[claim.text];
    var strategyP = cachedStrategy
      ? Promise.resolve(cachedStrategy)
      : QA.analyzeQuery(claim).then(function (s) {
          s.enginesViaFallback = false;
          strategyCache[claim.text] = s;
          return s;
        });

    return strategyP.then(function (strategy) {
      // ② 引擎解析与检索（串行：先预算首路，不足再补——省配额）
      var plan = resolveEngines(strategy);
      strategy.degradedExternal = plan.degraded;

      var queries = strategy.keywords && strategy.keywords.length ? strategy.keywords : [claim.text];
      var searchSeq = Promise.resolve({ merged: [], enginesUsed: [], queryLog: [] });
      var usedIdx = 0;

      function runEngineStep(acc) {
        if (usedIdx >= plan.engines.length || acc.merged.length >= 8) return acc;
        var engine = plan.engines[usedIdx++];
        var q = queries[Math.min(usedIdx - 1, queries.length - 1)] || queries[0];
        return DS.engineSearch(engine, q, 6).then(function (items) {
          acc.enginesUsed.push(engine + '(' + items.length + ')');
          acc.queryLog.push({ engine: engine, query: q, hits: items.length });
          acc.merged = acc.merged.concat(items);
          return acc;
        }, function () {
          return acc;
        }).then(runEngineStep);
      }

      return searchSeq.then(runEngineStep).then(function (acc) {
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
            stats: { rawCount: acc.merged.length, uniqueCount: 0, filteredCount: 0 }
          };
        }

        // ④ Registry 先验 + ⑤ 来源分析（串行防限流）
        candidates.forEach(function (it) { it.registryInfo = REG.lookup(it.url); });
        return SA.analyzeSources(candidates).then(function (analyzed) {
          // ⑥ 证据聚簇（§9）
          EG.buildClusters(analyzed);
          // ⑦ Scoring 排序（硬过滤→六维→转载降权）
          var ranked = SE.rank(analyzed, strategy);

          // ⑧ Top-3 读原文逐源判定（V2.0 verify-engine 复用）
          var topN = ranked.ranked.slice(0, 3);
          return VE.verifyClaim(claim, topN).then(function (v) {
            v.queries = acc.queryLog;
            v.candidates = ranked.ranked;         // 全量排序候选供面板展示
            v.strategy = strategy;                 // 问题类型/预算/降级标记
            v.stats = {
              rawCount: acc.merged.length,
              uniqueCount: ranked.ranked.length,
              filteredCount: ranked.filtered + (acc.merged.length - dd.unique.length),
              clusterCount: Math.min(ranked.ranked.length, (function () {
                var ids = {};
                ranked.ranked.forEach(function (c) { ids[c.evidenceClusterId] = 1; });
                return Object.keys(ids).length;
              })()),
              enginesUsed: acc.enginesUsed
            };
            return v;
          });
        });
      });
    });
  }

  global.WCC_V25 = {
    verifyClaimV25: verifyClaimV25,
    resolveEngines: resolveEngines,
    _strategyCache: strategyCache
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
