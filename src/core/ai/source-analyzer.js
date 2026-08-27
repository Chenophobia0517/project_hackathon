// Source Analyzer（V2.5 M3）：LLM 理解来源——输入 URL/标题/摘要 → 结构化来源画像。
// 升级要求 §5/§8：LLM 只负责理解来源（类型/一手性/机构/领域），不做可信度打分；
// 评分由 Scoring Engine 综合。TQ4：一手性启发式优先、LLM 辅助、标注"疑似"。
// 缓存：按 (domain + normalizedUrl path) 会话级缓存——同域名路径相同即复用，跨 Claim 免分析。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG;
  var URL_UTILS = global.WCC_URL_UTILS;
  var TIMEOUT_MS = 20000;

  // ---------- 会话级缓存 ----------
  var cache = {}; // key -> analysis

  function cacheKey(item) {
    var norm = (item.normalizedUrl || item.url || '').toLowerCase();
    // domain+path 级：去 query（同文档不同 tracking 参数共享缓存）
    return norm.split('?')[0];
  }

  var SOURCE_TYPES = ['gov', 'acad', 'paper', 'media', 'org', 'biz', 'zhihu', 'other'];
  var ORIGINALITY_LEVELS = ['original', 'secondary', 'tertiary'];

  var SYSTEM_PROMPT = [
    '你是来源分析器。给你一个网页的 URL、标题和内容摘要。',
    '请理解该来源并输出结构化 JSON：',
    '- sourceType: 来源类型，取值 gov(政府机构)/acad(科研机构)/paper(学术论文)/media(媒体，含权威与专业)/org(官方组织/NGO)/biz(企业官方或商业机构)/zhihu(知乎)/other',
    '- originality: 一手性，取值 original(原始发布：官方公告/论文原文/当事人陈述/一手数据) /',
    '  secondary(转载或报道他人内容) / tertiary(聚合汇编多处来源)',
    '- originalityConfidence: high / medium / low（低置信时下游只标"疑似"）',
    '- org: 所属机构名（中文，未知给空串）',
    '- domain: 专业领域短语（如 财经/公共卫生/AI 技术，未知给空串）',
    '- citationHint: 摘要中是否引用了其他来源（"cites"/"none"）',
    '',
    '只输出 JSON：{"sourceType":"gov","originality":"original","originalityConfidence":"high","org":"国家统计局","domain":"经济统计","citationHint":"none"}'
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

  function callLLM(userContent) {
    var body = {
      model: CONFIG.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 300
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

  // sanitize：非法值回落 other/secondary/low
  function sanitize(raw) {
    raw = raw || {};
    var st = SOURCE_TYPES.indexOf(raw.sourceType) >= 0 ? raw.sourceType : 'other';
    var og = ORIGINALITY_LEVELS.indexOf(raw.originality) >= 0 ? raw.originality : 'secondary';
    var conf = ['high', 'medium', 'low'].indexOf(raw.originalityConfidence) >= 0 ? raw.originalityConfidence : 'low';
    return {
      sourceType: st,
      originality: og,
      originalityConfidence: conf,
      org: typeof raw.org === 'string' ? raw.org.slice(0, 40) : '',
      domain: typeof raw.domain === 'string' ? raw.domain.slice(0, 30) : '',
      citationHint: raw.citationHint === 'cites' ? 'cites' : 'none'
    };
  }

  // 规则兜底（无 LLM / 失败时）：URL 特征粗判
  function heuristicFallback(item) {
    var url = String(item.normalizedUrl || item.url || '').toLowerCase();
    var st = 'other';
    if (/\.gov\.cn$|(\.|^)gov($|\/)|\.edu\.cn$|^arxiv\.org|^pubmed\./.test(url)) st = url.indexOf('/abs/') >= 0 || /\.pdf/.test(url) ? 'paper' : 'gov';
    else if (/thepaper\.cn|caixin\.com|xinhuanet\.com|people\.com\.cn|cctv\.com|jiemian\.com|yicai\.com/.test(url)) st = 'media';
    else if (/zhihu\.com/.test(url)) st = 'zhihu';
    return {
      sourceType: st,
      originality: 'secondary',
      originalityConfidence: 'low',
      org: '',
      domain: '',
      citationHint: 'none'
    };
  }

  // ---------- 对外入口 ----------

  // analyzeSource(item) -> Promise<analysis>
  // item: 搜索结果条目（url/title/snippet/normalizedUrl）
  // analysis: { sourceType, originality, originalityConfidence, org, domain, citationHint, viaFallback }
  function analyzeSource(item) {
    var key = cacheKey(item);
    if (cache[key]) return Promise.resolve(cache[key]);

    var userContent = [
      'URL: ' + (item.normalizedUrl || item.url || ''),
      '标题: ' + (item.title || ''),
      '摘要: ' + String(item.snippet || '').slice(0, 260)
    ].join('\n');

    // 无凭证时同样走启发式兜底（v2.5 原则：来源分析在任何配置下都可用，只是质量不同）
    var p = (!CONFIG || !CONFIG.DEEPSEEK_API_KEY)
      ? Promise.resolve().then(function () {
          var a = heuristicFallback(item);
          a.viaFallback = true;
          return a;
        })
      : callLLM(userContent).then(sanitize).then(function (a) { a.viaFallback = false; return a; })
        .catch(function () {
          var a = heuristicFallback(item);
          a.viaFallback = true;
          return a;
        });

    return p.then(function (a) {
      cache[key] = a;
      return a;
    });
  }

  // analyzeSources(items) -> Promise<items'>（逐条注入 sourceAnalysis；串行防限流）
  function analyzeSources(items) {
    var chain = Promise.resolve();
    items.forEach(function (it) {
      chain = chain.then(function () {
        return analyzeSource(it).then(function (a) { it.sourceAnalysis = a; });
      });
    });
    return chain.then(function () { return items; });
  }

  global.WCC_SOURCE_ANALYZER = {
    analyzeSource: analyzeSource,
    analyzeSources: analyzeSources,
    SOURCE_TYPES: SOURCE_TYPES,
    _cache: cache
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
