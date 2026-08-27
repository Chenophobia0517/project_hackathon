// Scoring Engine（V2.5 M5）：结构化来源信息 → 六维评分 → 综合排序。
// 升级要求 §6/§7/§8：
//   - Authority 与 Originality 分离（高权威媒体≠一手来源）；
//   - 六维：authority/expertise/relevance/originality/evidence/freshness 各 0-100；
//   - LLM 只理解来源，本引擎做确定性综合排序；
//   - 流程：硬过滤 → 分类/分析已由上游完成 → 评分 → 排序。
(function (global) {
  'use strict';

  var REGISTRY = global.WCC_SOURCE_REGISTRY;

  // ---------- 权重（初版固定，注释说明依据） ----------
  // authority 0.30：来源可靠性根基
  // relevance 0.25：与 claim 无关的来源没有价值
  // originality 0.15：一手性独立维度（§6）
  // evidence 0.12：证据强度（含逐字数据/官方文件特征）
  // expertise 0.10：领域专业度
  // freshness 0.08：新近度权重最低——多数声明核对不依赖极新鲜度
  var WEIGHTS = {
    authority: 0.30, relevance: 0.25, originality: 0.15,
    evidence: 0.12, expertise: 0.10, freshness: 0.08
  };

  var SCORE_TYPE = {
    // 来源类型先验 authority 表（registry prior 与类型先验融合取较大者）
    gov: 95, paper: 92, acad: 88, org: 78, media: 70, biz: 55, zhihu: 50, other: 45
  };
  // 一手性得分（originality 维度；与 authority 完全独立计算）
  var SCORE_ORIGINALITY = { original: 95, secondary: 45, tertiary: 20 };

  // ---------- 硬过滤（§7 先过滤后评分） ----------
  function hardFilter(item) {
    if (!item || !item.url) return false;                 // 无 URL
    if (item.junk === true) return false;                  // 明显垃圾
    var t = item.registryInfo && item.registryInfo.tier;
    if (t === 'restricted') return false;                  // 受限来源出局（唯一硬准入点）
    return true;
  }

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  // freshScore(publishedDate|recencyHint)：有时间窗时按年份距当前衰减
  function freshnessScore(item, timeWindow) {
    var d = null;
    if (item.publishedDate) {
      d = new Date(item.publishedDate);
      if (isNaN(d.getTime())) d = null;
    }
    if (!d) {
      // metaso 常给中文日期串（"2025年03月17日"），尝试解析
      var m = String(item.publishedDate || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
      if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    if (!d) return 50; // 无日期：中性分
    var years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    var windowYears = timeWindow ? parseInt(timeWindow, 10) || null : null;
    var cap = windowYears || 10;
    var score = 100 - Math.min(100, (years / cap) * 100);
    return clamp(score);
  }

  // relevanceScore(item, strategy)：snippet/title 与关键词组的重合度（确定性计算）
  function relevanceScore(item, strategy) {
    var text = String((item.title || '') + ' ' + (item.snippet || '')).toLowerCase();
    var kws = (strategy && strategy.keywords) || [];
    if (!kws.length) return 60;
    var hits = 0;
    kws.forEach(function (k) {
      // 关键词可能是词组：拆单字词与整组都算命中信号
      if (text.indexOf(String(k).toLowerCase()) >= 0) hits += 1;
      else {
        var parts = String(k).split(/\s+/);
        var sub = parts.filter(function (p) { return p.length >= 2 && text.indexOf(p.toLowerCase()) >= 0; }).length;
        hits += sub / Math.max(1, parts.length) * 0.8;
      }
    });
    return clamp(hits / kws.length * 100);
  }

  // evidenceScore(item)：内容证据强度启发式（数字/百分号/文件词根存在性）
  function evidenceScore(item) {
    var s = String(item.snippet || '');
    var score = 40;
    if (/\d+(?:\.\d+)?%/.test(s)) score += 20;
    if (/[\d,.]+(?:万|亿|万亿)/.test(s)) score += 20;
    if (/文件|通知|公告|报告|论文|数据显示|研究表明/.test(s)) score += 15;
    if (s.length > 120) score += 5;
    return clamp(score);
  }

  // expertiseScore(analysis)：科研/学术/官方机构在垂直领域的专业度加成
  function expertiseScore(item) {
    var a = item.sourceAnalysis || {};
    var base = { gov: 80, paper: 90, acad: 88, org: 72, media: 62, biz: 58, zhihu: 45, other: 40 }[a.sourceType] || 45;
    // 有明确机构名 + 领域 → 加成
    if (a.org) base += 6;
    if (a.domain) base += 4;
    return clamp(base);
  }

  // ---------- 对外入口 ----------

  // rank(items, strategy) -> { ranked, filtered }
  // 前置要求：items 已过 url-utils 归一、source-analyzer 分析、evidence-graph 聚簇。
  // 每条注入 scores{6维} + total + whyText（「为什么信这个来源」一句话解释）。
  function rank(items, strategy) {
    var kept = items.filter(hardFilter);
    var filtered = items.length - kept.length;

    kept.forEach(function (it) {
      var reg = it.registryInfo || REGISTRY.lookup(it.url);
      var typeAuth = SCORE_TYPE[(it.sourceAnalysis && it.sourceAnalysis.sourceType)] || SCORE_TYPE.other;

      var dims = {
        authority: clamp(Math.max(reg.prior, typeAuth)),
        relevance: relevanceScore(it, strategy),
        originality: SCORE_ORIGINALITY[(it.sourceAnalysis && it.sourceAnalysis.originality)] || SCORE_ORIGINALITY.secondary,
        evidence: evidenceScore(it),
        expertise: expertiseScore(it),
        freshness: freshnessScore(it, strategy && strategy.timeWindow)
      };
      var total = 0;
      for (var k in WEIGHTS) total += dims[k] * WEIGHTS[k];

      it.scores = dims;
      it.scoreTotal = clamp(total);

      // 一句话解释（面板展示用）：强项优先级 relevance > originality > authority > freshness
      var reasons = [];
      if (reg.tier === 'verified') reasons.push(reg.label || '权威机构');
      if (dims.originality >= 95) reasons.push('原始发布');
      else if (it.suspectedSyndication) reasons.push('疑似转载自 ' + ((it.sameAsOriginal && it.sameAsOriginal.title) || '').slice(0, 14));
      if (dims.authority >= 85) reasons.push('来源类型' + ({ gov: '政府', paper: '学术论文', acad: '科研机构', org: '官方组织' }[(it.sourceAnalysis||{}).sourceType] || '权威'));
      if (dims.freshness >= 80) reasons.push('时效性强');
      it.whyText = reasons.slice(0, 2).join(' · ') || '综合匹配';
    });

    // 转载页排序降权：同簇内非代表条目总分 ×0.75（不剔除，仍可点击追溯）
    var seenClusterRep = {};
    kept.forEach(function (it) {
      if (it.suspectedSyndication) {
        if (!seenClusterRep[it.evidenceClusterId]) seenClusterRep[it.evidenceClusterId] = true;
        else it.scoreTotal = clamp(it.scoreTotal * 0.75);
      }
    });

    kept.sort(function (a, b) { return b.scoreTotal - a.scoreTotal; });
    return { ranked: kept, filtered: filtered };
  }

  global.WCC_SCORING_ENGINE = {
    rank: rank,
    WEIGHTS: WEIGHTS,
    hardFilter: hardFilter,
    _internals: { freshnessScore: freshnessScore, relevanceScore: relevanceScore, evidenceScore: evidenceScore, expertiseScore: expertiseScore }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
