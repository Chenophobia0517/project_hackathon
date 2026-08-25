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

  function normalizeItems(data) {
    var items = (data && data.Items) || [];
    return items.map(function (it) {
      return {
        title: it.Title || '',
        // 摘要去高亮 <em> 标签
        snippet: String(it.ContentText || '').replace(/<\/?em>/g, ''),
        url: it.Url || '',
        author: it.AuthorName || '',
        sourceType: it.ContentType || '',   // Answer / Article ...
        votes: it.VoteUpCount || 0,
        authority: Number(it.AuthorityLevel) || 1  // 1低~4超高
      };
    });
  }

  // ---------- 对外接口 ----------

  // searchZhihu(query, count) -> Promise<items[]>  知乎站内讨论/回答/文章
  function searchZhihu(query, count) {
    return apiGet('/zhihu_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 10) })
      .then(normalizeItems);
  }

  // searchGlobal(query, count) -> Promise<items[]>  知乎之外的全网来源
  function searchGlobal(query, count) {
    return apiGet('/global_search', { Query: String(query || '').slice(0, 100), Count: Math.min(count || 5, 20) })
      .then(normalizeItems);
  }

  // searchBoth(query) -> Promise<{ zhihu, global }>，任一失败不拖垮整体（返回空数组）
  function searchBoth(query) {
    return Promise.all([
      searchZhihu(query, 5).catch(function () { return []; }),
      searchGlobal(query, 5).catch(function () { return []; })
    ]).then(function (r) { return { zhihu: r[0], global: r[1] }; });
  }

  global.WCC_DATASOURCE = {
    isAvailable: isAvailable,
    searchZhihu: searchZhihu,
    searchGlobal: searchGlobal,
    searchBoth: searchBoth
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
