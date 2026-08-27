// 知乎开放平台数据源（M3）：知乎搜索 / 全网搜索，经 HTTP API 直连（D2=B 无独立后端）。
// 鉴权（官方 http-api.md）：Authorization: Bearer <Access Secret> + X-Request-Timestamp（秒级）。
// 无凭证时 isAvailable()=false，调用方走降级路径；配额保护靠 analyzer 的查询缓存。
(function (global) {
  'use strict';

  var CONFIG = global.QIUZHEN_CONFIG || null;

  // ---------- 可用性 ----------

  function isAvailable() {
    return !!(CONFIG && CONFIG.ZHIHU_ACCESS_SECRET);
  }

  // ---------- 请求封装 ----------

  var TIMEOUT_MS = 15000;

  function apiGet(path, params) {
    if (!isAvailable()) return Promise.reject(new Error('zhihu_not_configured'));
    var qs = Object.keys(params || {})
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(CONFIG.ZHIHU_API_BASE + path + (qs ? '?' + qs : ''), {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + CONFIG.ZHIHU_ACCESS_SECRET,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    }).then(function (resp) {
      clearTimeout(timer);
      if (!resp.ok) throw new Error('zhihu_http_' + resp.status);
      return resp.json();
    }).then(function (data) {
      // 业务错误码：0=成功 20001=鉴权失败 30001=频率限制
      if (data && typeof data.Code === 'number' && data.Code !== 0) {
        throw new Error('zhihu_code_' + data.Code);
      }
      return (data && data.Data) || {};
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // ---------- 归一化 ----------

  // origin 标记来源接口（'zhihu'=站内搜索 / 'global'=全网搜索）：
  // 注意 ContentType 只是内容形态（Answer/Article），全网结果也可能是 Answer，不能作为来源判断依据
  function normalizeItems(data, origin) {
    var items = (data && data.Items) || [];
    return items.map(function (it) {
      return {
        title: it.Title || '',
        // 摘要去高亮 <em> 标签
        snippet: String(it.ContentText || '').replace(/<\/?em>/g, ''),
        url: it.Url || '',
        author: it.AuthorName || '',
        sourceType: it.ContentType || '',   // Answer / Article ...（内容形态）
        origin: origin,                     // zhihu / global（来源接口）
        votes: it.VoteUpCount || 0,
        authority: Number(it.AuthorityLevel) || 1  // 1低~4超高
      };
    });
  }

  // ---------- 对外接口 ----------

  // searchZhihu(query, count) -> Promise<items[]>  知乎站内讨论/回答/文章
  function searchZhihu(query, count) {
    return apiGet('/zhihu_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 10) })
      .then(function (data) { return normalizeItems(data, 'zhihu'); });
  }

  // searchGlobal(query, count) -> Promise<items[]>  知乎之外的全网来源
  function searchGlobal(query, count) {
    return apiGet('/global_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 20) })
      .then(function (data) { return normalizeItems(data, 'global'); });
  }

  // searchBoth(query) -> Promise<{ zhihu, global }>，任一失败不拖垮整体（返回空数组）
  function searchBoth(query) {
    return Promise.all([
      searchZhihu(query, 5).catch(function () { return []; }),
      searchGlobal(query, 5).catch(function () { return []; })
    ]).then(function (r) { return { zhihu: r[0], global: r[1] }; });
  }

  // ---------- V2.5 M1：外部搜索引擎 providers（metaso 广泛召回 / Exa 语义召回，TQ2/TQ3） ----------

  // 归一化为统一 item 结构（与知乎通道字段对齐）
  function normalizeExternal(raw, engine) {
    return {
      title: raw.title || raw.name || '',
      snippet: raw.snippet || raw.text || raw.summary || '',
      url: raw.url || raw.link || '',
      author: (raw.author && raw.author.name) || raw.author || '',
      sourceType: '',            // 由 source-analyzer 阶段判定
      origin: 'global',
      engine: engine,            // 'metaso' / 'exa'
      votes: 0,
      authority: 1,
      publishedDate: raw.publishedDate || raw.published_date || raw.datePublished || null
    };
  }

  function isMetasoAvailable() {
    return !!(CONFIG && CONFIG.METASO_API_KEY);
  }
  function isExaAvailable() {
    return !!(CONFIG && CONFIG.EXA_API_KEY);
  }

  // metaso：广泛召回。真实 API 为 https://metaso.cn/api/v1/search（M1 联调探明，
  // v2.5_UPGRADE 文档中的 playground 地址返回的是 HTML 页面，非 API）。
  // endpoint 允许配置覆盖（TQ2）。
  function searchMetaso(query, count) {
    if (!isMetasoAvailable()) return Promise.reject(new Error('metaso_not_configured'));
    var endpoint = CONFIG.METASO_ENDPOINT || 'https://metaso.cn/search-api/playground';
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.METASO_API_KEY
      },
      body: JSON.stringify({ q: String(query || '').slice(0, 100), count: Math.min(count || 5, 10) }),
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('metaso_http_' + res.status);
      return res.json();
    }).then(function (data) {
      if (data && typeof data.errCode === 'number' && data.errCode !== 0) throw new Error('metaso_code_' + data.errCode);
      var list = data.webpages || data.results || data.data || data.items || [];
      return list.map(function (it) { return normalizeExternal(it, 'metaso'); });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // Exa：语义召回（官方 https://api.exa.ai/search）
  function searchExa(query, count) {
    if (!isExaAvailable()) return Promise.reject(new Error('exa_not_configured'));
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
    return fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.EXA_API_KEY
      },
      body: JSON.stringify({
        query: String(query || '').slice(0, 200),
        numResults: Math.min(count || 5, 10),
        type: 'neural',
        contents: { text: { maxCharacters: 300 } }
      }),
      signal: controller.signal
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('exa_http_' + res.status);
      return res.json();
    }).then(function (data) {
      var list = data.results || [];
      return list.map(function (it) { return normalizeExternal(it, 'exa'); });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  // engineSearch(engine, query, count)：按名派发，供 search-controller 按策略调用。
  // 引擎失败返回 []（不拖垮整体——调用方聚合时统一兜底）。
  function engineSearch(engine, query, count) {
    try {
      if (engine === 'zhihu') return searchZhihu(query, count).catch(function () { return []; });
      if (engine === 'zhihu_global' || engine === 'zhihu-global') return searchGlobal(query, count).catch(function () { return []; });
      if (engine === 'metaso') return searchMetaso(query, count).catch(function () { return []; });
      if (engine === 'exa') return searchExa(query, count).catch(function () { return []; });
      return Promise.resolve([]);
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  global.WCC_DATASOURCE = {
    isAvailable: isAvailable,
    searchZhihu: searchZhihu,
    searchGlobal: searchGlobal,
    searchBoth: searchBoth,
    // V2.5 新增
    engineSearch: engineSearch,
    isMetasoAvailable: isMetasoAvailable,
    isExaAvailable: isExaAvailable,
    searchMetaso: searchMetaso,
    searchExa: searchExa
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
