// URL Utils（V2.5 M1）：多搜索源结果 → 规范化 + 去重。
// 升级要求 §3：tracking 参数清除、fragment 剥离、http/https 与 www/non-www 归一、
// canonical/重定向处理。canonical 解析需要页面内容（Web Reader 阶段），此处做**URL 级**归一。
(function (global) {
  'use strict';

  // 常见 tracking 参数（UTM + 主要广告/追踪参数）
  var TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'fbclid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', '_ga', 'ref', 'referer',
    'spm', 'share_token', 'share_medium', 'share_plat', 'share_session_id',
    'vd', 'aid', 'app_id', 'tt_from', 'share_from'
  ];

  function stripTracking(searchParams) {
    var kept = [];
    searchParams.split('&').forEach(function (pair) {
      if (!pair) return;
      var key = pair.split('=')[0].toLowerCase();
      // 精确名单命中，或 utm_* 通配（单写 utm / utm_xxx 均视为追踪参数）
      var isTracking = TRACKING_PARAMS.indexOf(key) >= 0 || key.indexOf('utm_') === 0 || key === 'utm';
      if (!isTracking) kept.push(pair);
    });
    return kept.join('&');
  }

  // normalizeUrl(raw) -> string
  // 输入任意形态 URL，输出规范化形式；解析失败返回原串小写去空白
  function normalizeUrl(raw) {
    var u = String(raw || '').trim();
    if (!u) return '';
    // 补协议
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    try {
      var parsed = new URL(u);
      // 协议归一为 https
      parsed.protocol = 'https:';
      // fragment 剥离
      parsed.hash = '';
      // tracking 清洗
      if (parsed.search) {
        var cleaned = stripTracking(parsed.search.slice(1));
        parsed.search = cleaned ? '?' + cleaned : '';
      }
      // www 归一：去掉前导 www.（保留其余子域）
      var host = parsed.hostname.toLowerCase();
      if (host.indexOf('www.') === 0) host = host.slice(4);
      parsed.hostname = host;
      // 去末尾斜杠（根路径除外）
      var path = parsed.pathname;
      if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
      parsed.pathname = path;
      return parsed.toString();
    } catch (e) {
      return u.toLowerCase();
    }
  }

  // dedupeUrls(items, keyFn) -> {unique: [...], droppedCount}
  // items: 搜索结果数组；keyFn(item) 返回该条目的原始 URL 字段名或取值函数
  function dedupeByNormalizedUrl(items, urlGetter) {
    var seen = {};
    var unique = [];
    var dropped = 0;
    for (var i = 0; i < items.length; i++) {
      var raw = typeof urlGetter === 'function' ? urlGetter(items[i]) : items[i][urlGetter];
      var norm = normalizeUrl(raw);
      if (!norm || seen[norm]) { dropped++; continue; }
      seen[norm] = true;
      items[i].normalizedUrl = norm;
      unique.push(items[i]);
    }
    return { unique: unique, droppedCount: dropped };
  }

  global.WCC_URL_UTILS = {
    normalizeUrl: normalizeUrl,
    dedupeByNormalizedUrl: dedupeByNormalizedUrl,
    TRACKING_PARAMS: TRACKING_PARAMS
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
