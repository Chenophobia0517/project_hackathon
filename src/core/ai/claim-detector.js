// Claim Detection 管线（V1.5 U1）：整篇文档句子 → 一次 LLM 批量分类 → Claim Index。
// 职责边界（v1.5_UPGRADE §4/§7）：全文阶段只做「发现+分类+定位」，绝不验证、绝不搜索。
// 输出 Claim Index：{id, text, type, verifiable, sentenceId, position}（§5 数据模型）。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG || null;

  var MAX_SENTENCES = 120;   // VD1：截断策略，超过只分析前部并标记 truncated
  var CHUNK_SIZE = 40;       // 每批句子数（token 控制）
  var TIMEOUT_MS = 45000;

  // ---------- 缓存（内存 + storage.session 镜像，键=url+正文指纹） ----------

  var CACHE_MAX = 30;
  var cache = new Map();

  function docFingerprint(documentPayload) {
    var sents = documentPayload.sentences || [];
    var head = '';
    for (var i = 0; i < Math.min(sents.length, 5); i++) head += sents[i].text;
    return (documentPayload.doc.url || '') + '|' + sents.length + '|' + head.length;
  }

  function cacheGet(key) {
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return new Promise(function (resolve) {
      try {
        chrome.storage.session.get('claimIndexCache', function (data) {
          var m = (data && data.claimIndexCache) || {};
          if (m[key]) resolve(m[key]);
          else resolve(null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function cacheSet(key, val) {
    cache.set(key, val);
    if (cache.size > CACHE_MAX) {
      var first = cache.keys().next().value;
      cache.delete(first);
    }
    try {
      chrome.storage.session.get('claimIndexCache', function (data) {
        var m = (data && data.claimIndexCache) || {};
        m[key] = val;
        var keys = Object.keys(m);
        while (keys.length > CACHE_MAX) delete m[keys.shift()];
        chrome.storage.session.set({ claimIndexCache: m });
      });
    } catch (e) { /* 仅内存缓存 */ }
  }

  // ---------- 批量 LLM 分类 ----------

  var SYSTEM_PROMPT = [
    '你是中文网页声明分析器。用户会给你一篇网页的结构化句子列表（JSON 数组，每项有 sid 和 text）。',
    '请判断每一句是否包含【值得验证的声明】，即可以被证据支持或反驳的主张。',
    '分类（每句必须给出 verdict）：',
    '- claim（可验证声明）：事实断言、数字/数据、因果判断、比较、预测、定义等。',
    '- opinion（主观观点）：个人评价、感受、建议、价值判断（如"我认为""最好""很棒"）。',
    '- none（非声明）：过渡句、设问、修辞、背景描述、纯场景交代。',
    '若为 claim，再给 type 子类：fact(事实) / number(数字/数据) / causal(因果) / compare(比较) / predict(预测) / define(定义) / other(其他)。',
    '规则：宁缺毋滥——拿不准的句子归 none；一个句子含多个声明时按最主要的一个分类；不要漏掉任何句子。',
    '只输出 JSON，不要任何解释。输出格式：{"claims":[{"sid":"s-0","verdict":"claim","type":"number"},{"sid":"s-1","verdict":"none"}]}'
  ].join('\n');

  // 从响应中提取 JSON（兼容 ```json 包裹/前后杂文）
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

  function callChunk(chunk) {
    var body = {
      model: CONFIG.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(chunk) }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 4000
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
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) throw new Error('http_' + resp.status);
      return resp.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('empty_response');
      var parsed = extractJson(content);
      if (!parsed || !Array.isArray(parsed.claims)) throw new Error('missing_fields:claims');
      return parsed.claims;
    });
  }

  // ---------- 汇总为 Claim Index ----------

  function buildIndex(sentences, verdictsBySid, truncated) {
    var claims = [];
    var seen = {};
    // 用第一批输出为准；缺失 sid 保守归 none
    sentences.forEach(function (s, i) {
      var v = verdictsBySid[s.id] || { verdict: 'none' };
      seen[s.id] = true;
      if (v.verdict !== 'claim') return;
      claims.push({
        id: 'claim-' + i,
        text: s.text,
        type: v.type || 'other',
        verifiable: true,
        sentenceId: s.id,
        position: { paraId: s.paraId, start: s.start, end: s.end }
      });
    });
    return {
      claims: claims,
      analyzed: sentences.length,
      truncated: !!truncated
    };
  }

  // ---------- 对外入口 ----------

  // detectClaims(documentPayload) -> Promise<{claims, analyzed, truncated, cached}>
  function detectClaims(documentPayload) {
    if (!CONFIG || !CONFIG.DEEPSEEK_API_KEY) return Promise.reject(new Error('config_missing'));
    var sentences = (documentPayload && documentPayload.sentences) || [];
    if (!sentences.length) return Promise.resolve({ claims: [], analyzed: 0, truncated: false, cached: false });

    var key = docFingerprint(documentPayload);
    return cacheGet(key).then(function (hit) {
      if (hit) return { claims: hit.claims, analyzed: hit.analyzed, truncated: hit.truncated, cached: true };

      var truncated = sentences.length > MAX_SENTENCES;
      var work = sentences.slice(0, MAX_SENTENCES);

      // 串行分批（并发会撞 DeepSeek 限流）
      var chunks = [];
      for (var i = 0; i < work.length; i += CHUNK_SIZE) chunks.push(work.slice(i, i + CHUNK_SIZE));

      var chain = Promise.resolve([]);
      chunks.forEach(function (chunk) {
        chain = chain.then(function (acc) {
          return callChunk(chunk).then(function (verdicts) {
            return acc.concat(verdicts);
          }).catch(function (err) {
            // 单批失败重试一次，仍失败则整批按 none 兜底（不拖垮整体）
            return callChunk(chunk).catch(function () {
              return chunk.map(function (s) { return { sid: s.id, verdict: 'none' }; });
            });
          });
        });
      });

      return chain.then(function (allVerdicts) {
        var verdictsBySid = {};
        allVerdicts.forEach(function (v) {
          if (v && v.sid) verdictsBySid[v.sid] = v;
        });
        var index = buildIndex(work, verdictsBySid, truncated);
        var entry = { claims: index.claims, analyzed: index.analyzed, truncated: index.truncated };
        cacheSet(key, entry);
        return { claims: index.claims, analyzed: index.analyzed, truncated: index.truncated, cached: false };
      });
    });
  }

  global.WCC_CLAIM_DETECTOR = { detectClaims: detectClaims };
})(typeof globalThis !== 'undefined' ? globalThis : self);
