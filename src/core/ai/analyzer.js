// AI 深读分析链路（M1）：在 Background Service Worker 内直连 DeepSeek（决策 D2=B）。
// 三种模式（PRD 04-功能需求）：truth=求真 / deep=求深 / differ=求异。
// 原则：结构化 JSON 输出；不制造虚假确定性；查询缓存防配额击穿（PRD 06-技术架构 §14）。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG || null;

  // ---------- 三模式 Prompt ----------

  var SYSTEM_PROMPTS = {
    truth: [
      '你是严谨的事实核查助手。用户给你一段网页中选中的话（Claim），请基于你的知识核查它。',
      '要求：',
      '1. 先给 Claim 分类（type 字段）：数值/时间/地理/排名比较/科学/法律政策/人物机构/因果关系/预测/主观观点。',
      '2. 若属"主观观点"，supportLevel 固定为 "opinion"，并在 summary 说明"该内容属于观点表达，无需事实溯源"。',
      '3. supportLevel 四选一：supported(有较充分证据支持)/partial(部分支持)/insufficient(证据不足)/unsupported(不支持)。不确定时宁可 insufficient，不要猜测。',
      '4. evidences 给出 1~4 条支持或反驳的证据。每项固定字段：sourceType(五选一:原始研究/官方资料/权威报告/专业媒体/社区讨论)、point(一句话结论)、detail(简要说明)。无法给出可靠来源时留空数组。',
      '5. comparison 必须诚实对照"原文说了什么"与"来源实际表达了什么"。固定字段：original(原文表述)、actual(来源实际表达)、gap(差异判断，如把相关性夸大为因果/绝对化/以偏概全)。没有可靠来源时 comparison 为 null。',
      '6. 输出 JSON 必须包含全部字段：type、supportLevel、summary、evidences、comparison。',
      '7. 只输出 JSON，不要输出任何其他文字。'
    ].join('\n'),
    deep: [
      '你是深入浅出的知识讲解者。用户给你一段网页中选中的话（Claim），请解释它背后的原理与知识。',
      '要求：',
      '1. principle：用平实语言解释这句话背后的原理或机制，120 字以内，先结论后展开。',
      '2. concepts：3~6 个关键概念节点，每项固定字段：name(概念名)、description(一句话简介)。',
      '3. tree：围绕 Claim 的知识树。固定结构：root(核心概念名)、branches 数组，每支固定字段：label(维度名如 原理/应用/争议)、nodes(字符串数组，具体节点名)。branches 取 2~4 个维度，每支挂 2~4 个节点。',
      '4. questions：3 条值得继续追问的问题（为什么/怎么实现/有什么局限）。',
      '5. 知识不足的领域如实说明，不要编造术语。',
      '6. 输出 JSON 必须包含全部字段：principle、concepts、tree、questions。',
      '7. 只输出 JSON，不要输出任何其他文字。'
    ].join('\n'),
    differ: [
      '你是多元视角分析助手。用户给你一段网页中选中的话（Claim）及其出处，请呈现不同立场与被忽略的维度。',
      '要求：',
      '1. currentStance：概括当前内容的立场倾向。',
      '2. viewpoints：2~4 个不同立场。每项固定字段：stance(中文短语如 乐观派/谨慎派/怀疑派)、point(核心论点)、reason(主要理由)。立场必须有实质差异，不是同义反复。',
      '3. blindSpots：1~4 个当前内容较少讨论但重要的维度（认知盲区）。每项固定字段：topic(维度名)、why(为什么重要)。',
      '4. 观点要能代表真实世界中存在的讨论，不虚构边缘立场。',
      '5. 输出 JSON 必须包含全部字段：currentStance、viewpoints、blindSpots。',
      '6. 只输出 JSON，不要输出任何其他文字。'
    ].join('\n')
  };

  var USER_TEMPLATE = [
    'Claim（用户选中的话）：',
    '「{{CLAIM}}」',
    '',
    '出处页面：{{TITLE}}（{{URL}}）',
    '',
    '请按要求输出 JSON。'
  ].join('\n');

  // ---------- 缓存（内存 + storage.session 镜像，防 SW 休眠丢失） ----------

  var CACHE_MAX = 60;
  var cache = new Map(); // key -> { result, at }

  function cacheKey(mode, claim, url) {
    return mode + '|' + claim + '|' + (url || '');
  }

  function cacheGet(key) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise(function (resolve) {
      try {
        chrome.storage.session.get('analysisCache', function (data) {
          var stored = (data && data.analysisCache && data.analysisCache[key]) || null;
          if (stored) { // 回填内存
            cache.set(key, stored);
          }
          resolve(stored);
        });
      } catch (e) { resolve(null); }
    });
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    if (cache.size > CACHE_MAX) {
      var firstKey = cache.keys().next().value; // 简单 FIFO 淘汰
      cache.delete(firstKey);
    }
    try {
      chrome.storage.session.get('analysisCache', function (data) {
        var all = (data && data.analysisCache) || {};
        all[key] = value;
        chrome.storage.session.set({ analysisCache: all });
      });
    } catch (e) { /* 仅内存 */ }
  }

  // ---------- JSON 提取与校验 ----------

  // 模型可能输出 ```json 包裹或前后杂文，提取首个平衡的 JSON 对象
  function extractJson(text) {
    if (!text) throw new Error('empty_response');
    var start = text.indexOf('{');
    if (start === -1) throw new Error('no_json_in_response');
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < text.length; i++) {
      var ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { if (inStr) esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw new Error('unbalanced_json');
  }

  var REQUIRED_FIELDS = {
    truth: ['type', 'supportLevel', 'summary'],
    deep: ['principle', 'concepts', 'questions'],
    differ: ['currentStance', 'viewpoints', 'blindSpots']
  };

  function validate(mode, obj) {
    var missing = (REQUIRED_FIELDS[mode] || []).filter(function (f) { return !(f in obj); });
    if (missing.length) throw new Error('missing_fields:' + missing.join(','));
    return obj;
  }

  // ---------- DeepSeek 调用 ----------

  var TIMEOUT_MS = 45000;

  function callDeepseek(mode, payload) {
    if (!CONFIG || !CONFIG.DEEPSEEK_API_KEY) {
      return Promise.reject(new Error('config_missing'));
    }
    var userMsg = USER_TEMPLATE
      .replace('{{CLAIM}}', String(payload.selectedText || '').slice(0, 1200))
      .replace('{{TITLE}}', String(payload.title || '').slice(0, 200))
      .replace('{{URL}}', String(payload.url || '').slice(0, 300));

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

    return fetch(CONFIG.DEEPSEEK_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.DEEPSEEK_API_KEY
      },
      body: JSON.stringify({
        model: CONFIG.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[mode] },
          { role: 'user', content: userMsg }
        ],
        temperature: mode === 'differ' ? 0.9 : 0.3,
        max_tokens: 1600,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) {
        // 透传状态码便于 UI 区分配额/鉴权问题
        throw new Error('http_' + resp.status);
      }
      return resp.json();
    }).then(function (data) {
      var text = data && data.choices && data.choices[0] && data.choices[0].message &&
        data.choices[0].message.content;
      return validate(mode, extractJson(text));
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ---------- 对外入口 ----------

  // analyze(mode, payload) -> Promise<result>
  // result: { mode, result, cached } 或抛错（config_missing / http_xxx / abort / 解析失败）
  function analyze(mode, payload) {
    if (!SYSTEM_PROMPTS[mode]) return Promise.reject(new Error('unknown_mode'));
    var key = cacheKey(mode, String(payload.selectedText || ''), payload.url);
    return cacheGet(key).then(function (hit) {
      if (hit) return { mode: mode, result: hit.result, cached: true };
      // 校验失败（模型偶发漏字段）自动重试一次再放弃
      return callDeepseek(mode, payload).catch(function (err) {
        if (String(err.message).indexOf('missing_fields') === 0 ||
            err.message === 'unbalanced_json' || err.message === 'no_json_in_response') {
          return callDeepseek(mode, payload);
        }
        throw err;
      }).then(function (parsed) {
        var entry = { result: parsed, at: Date.now() };
        cacheSet(key, entry);
        return { mode: mode, result: parsed, cached: false };
      });
    });
  }

  global.WCC_ANALYZER = {
    analyze: analyze,
    isConfigured: function () { return !!(CONFIG && CONFIG.DEEPSEEK_API_KEY); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
