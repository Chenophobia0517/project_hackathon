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
  // 基础步：exa(英文或中文 Query)、metaso(中文 Query)、zhihu(中文 Query, 低配额)
  // 官方步（§24）：exa 用 includeDomains 限定官方域；metaso 用 site: 约束（各限 2 个域名）
  function buildPlan(strategy, claimText) {
    var budget = ENGINE_BUDGET[strategy.questionType] || ENGINE_BUDGET.fact;
    var queries = QA.buildQueries(strategy, claimText);
    var zh = queries.zh[0] || String(claimText || '');
    var en = queries.en[0] || zh;
    var official = queries.official || [];

    var steps = [];
    var degraded = false;
    if (DS.isExaAvailable()) {
      steps.push({ engine: 'exa', query: en, count: budget.exa, opts: {} });
    } else degraded = true;
    if (DS.isMetasoAvailable()) {
      steps.push({ engine: 'metaso', query: zh, count: budget.metaso, opts: {} });
    } else degraded = true;
    if (DS.isAvailable()) {
      steps.push({ engine: 'zhihu', query: zh, count: budget.zhihu, opts: {} });
    }

    // 官方域名定向步：先于兜底深度，保证官方源有机会进入候选池（NASA→nasa.gov 等）
    official.slice(0, 2).forEach(function (o) {
      if (DS.isExaAvailable()) steps.push({ engine: 'exa', query: o.query, count: 3, opts: { includeDomains: [o.domain] } });
      if (DS.isMetasoAvailable()) steps.push({ engine: 'metaso', query: o.query, count: 3, opts: { siteDomain: o.domain } });
    });

    if (!steps.length) return { steps: [], degraded: true };
    return { steps: steps, degraded: degraded };
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
      // ② 引擎计划与检索（串行执行各步，官方定向步优先；总候选上限 14）
      var plan = buildPlan(strategy, claim.text);
      strategy.degradedExternal = plan.degraded;

      var searchSeq = Promise.resolve({ merged: [], enginesUsed: [], queryLog: [] });
      var stepIdx = 0;

      function runStep(acc) {
        if (stepIdx >= plan.steps.length || acc.merged.length >= 14) return acc;
        var step = plan.steps[stepIdx++];
        var q = String(step.query || '').slice(0, 100);
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
            stats: { rawCount: acc.merged.length, uniqueCount: 0, filteredCount: 0 }
          };
        }

        // ④ Registry 先验 + ⑤ 来源分析（串行防限流）
        candidates.forEach(function (it) { it.registryInfo = REG.lookup(it.url); });
        return SA.analyzeSources(candidates).then(function (analyzed) {
          // ⑥ 证据聚簇（§9）
          EG.buildClusters(analyzed);
          // ⑦ Scoring 排序（硬过滤→六维→转载降权；传入 claim 供 Entity/Directness/Temporal 维度使用）
          var ranked = SE.rank(analyzed, strategy, claim.text);

          // ⑧ 读原文逐源判定：交给 verify-engine 的 Top-6 多样性验证池（§19）
          //    （传入 Top-8，验证池按来源类型多样性挑选，避免前三全是同类媒体）
          var topN = ranked.ranked.slice(0, 8);
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
    buildPlan: buildPlan,
    ENGINE_BUDGET: ENGINE_BUDGET,
    _strategyCache: strategyCache
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
