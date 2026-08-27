// Query Analyzer（V2.5 M0）：Claim → 问题类型 → 搜索策略。
// 升级要求 §1/§11：根据问题类型决定 关键词/来源类型/时间要求/搜索预算/是否双引擎。
// TQ1：一次轻量 LLM 调用输出完整策略 JSON；LLM 失败时按 claim.objectType 走确定性规则兜底。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG;
  var TIMEOUT_MS = 15000;

  // ---------- 问题类型 → 策略的静态映射（兜底 + LLM 结果校验用） ----------
  // questionType: fact(事实查询) / academic(学术) / policy(政策) / event(时事事件) /
  //               data(数据核实) / open(开放研究)
  var TYPE_STRATEGY = {
    fact:     { engines: ['zhihu_global'], preferredSources: ['gov', 'media'], timeWindow: null,        budget: 1, dualEngine: false },
    academic: { engines: ['zhihu_global', 'exa'], preferredSources: ['acad', 'paper'], timeWindow: '5y',   budget: 2, dualEngine: true },
    policy:   { engines: ['metaso', 'zhihu_global'], preferredSources: ['gov'],      timeWindow: '3y',   budget: 2, dualEngine: true },
    event:    { engines: ['metaso', 'zhihu_global'], preferredSources: ['media'],    timeWindow: '1y',   budget: 2, dualEngine: true },
    data:     { engines: ['metaso', 'zhihu_global'], preferredSources: ['gov', 'paper', 'media'], timeWindow: '5y', budget: 2, dualEngine: true },
    open:     { engines: ['metaso', 'exa'],          preferredSources: [],           timeWindow: null,   budget: 3, dualEngine: true }
  };

  // claim.objectType → questionType 的静态兜底映射（TQ1 规则兜底）
  var OBJECT_TO_TYPE = {
    fact: 'fact', data: 'data', research_report: 'academic', paper: 'academic',
    gov_document: 'policy', org_info: 'fact', media_report: 'event',
    person_event: 'event', opinion: 'open', rhetoric: 'open', plain: 'fact'
  };

  function validType(t) { return !!TYPE_STRATEGY[t]; }

  // ---------- LLM 策略判定 ----------
  var SYSTEM_PROMPT = [
    '你是搜索策略分析器。用户给你一条网页声明（claim）。',
    '请判断问题类型并输出搜索策略 JSON：',
    '- questionType: "fact"(事实查询，官方来源优先) / "academic"(学术问题，论文与研究机构优先) /',
    '  "policy"(政策问题，政府与监管机构优先) / "event"(时事事件) / "data"(数据核实) / "open"(开放研究)',
    '- keywords: 2~3 组中文搜索关键词数组（去口语化、含实体与数字）',
    '- preferredSources: 来源类型偏好数组，取值 gov/acad/paper/media/org/biz/zhihu/other',
    '- timeWindow: 时间要求，"1y"/"3y"/"5y" 或 null(不限)',
    '- budget: 搜索预算 1~3（简单事实=1，需要多方印证=2，开放探索=3）',
    '- dualEngine: 是否需要双搜索引擎（广泛召回+语义召回），布尔值',
    '',
    '只输出 JSON：{"questionType":"data","keywords":["...","..."],"preferredSources":["gov","paper"],"timeWindow":"5y","budget":2,"dualEngine":true}'
  ].join('\n');

  function extractJson(text) {
    if (!text) throw new Error('empty_response');
    var start = text.indexOf('{');
    if (start < 0) throw new Error('no_json_in_response');
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < text.length; i++) {
      var ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw new Error('unbalanced_json');
  }

  function callLLM(claimText) {
    var body = {
      model: CONFIG.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: claimText }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 500
    };
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.DEEPSEEK_API_KEY
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    }).then(function (data) {
      return extractJson(data.choices[0].message.content);
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ---------- LLM 输出校验 + 兜底字段填充 ----------
  function sanitizeStrategy(raw, fallbackType) {
    var s = TYPE_STRATEGY[fallbackType];
    var out = {
      questionType: validType(raw && raw.questionType) ? raw.questionType : fallbackType
    };
    var base = TYPE_STRATEGY[out.questionType];
    out.keywords = Array.isArray(raw && raw.keywords) && raw.keywords.length
      ? raw.keywords.map(String).slice(0, 4)
      : null; // null → 调用方用 claim.text 原文作为关键词
    out.preferredSources = Array.isArray(raw && raw.preferredSources) && raw.preferredSources.length
      ? raw.preferredSources.map(String).slice(0, 4)
      : base.preferredSources;
    out.timeWindow = typeof (raw && raw.timeWindow) === 'string' ? raw.timeWindow : base.timeWindow;
    var b = Number(raw && raw.budget);
    out.budget = (b >= 1 && b <= 3) ? Math.round(b) : base.budget;
    out.dualEngine = typeof (raw && raw.dualEngine) === 'boolean' ? raw.dualEngine : base.dualEngine;
    return out;
  }

  function ruleFallback(claim) {
    var t = OBJECT_TO_TYPE[claim.objectType] || 'fact';
    var strategy = sanitizeStrategy(null, t);
    strategy.viaFallback = true;
    return strategy;
  }

  // ---------- 对外入口 ----------

  // analyzeQuery(claim) -> Promise<strategy>
  // strategy: { questionType, keywords, preferredSources, timeWindow, budget, dualEngine, viaFallback? }
  function analyzeQuery(claim) {
    if (!CONFIG || !CONFIG.DEEPSEEK_API_KEY) {
      return Promise.resolve(ruleFallback(claim)); // 无凭证 → 纯规则（仍可用）
    }
    return callLLM(claim.text).then(function (raw) {
      var st = sanitizeStrategy(raw, OBJECT_TO_TYPE[claim.objectType] || 'fact');
      st.viaFallback = false;
      return st;
    }).catch(function () {
      return ruleFallback(claim); // LLM 失败/超时/解析失败 → 规则兜底
    });
  }

  global.WCC_QUERY_ANALYZER = {
    analyzeQuery: analyzeQuery,
    ruleFallback: ruleFallback,
    TYPE_STRATEGY: TYPE_STRATEGY,
    OBJECT_TO_TYPE: OBJECT_TO_TYPE
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

