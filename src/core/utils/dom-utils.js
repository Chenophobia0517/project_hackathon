// DOM 辅助：安全取文本、忽略元素判断、稳定 id 分配。
(function (global) {
  'use strict';

  function cleanText(el) {
    if (!el || !el.textContent) return '';
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  function isIgnorable(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    var skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED'];
    if (skipTags.indexOf(tag) !== -1) return true;
    var view = el.ownerDocument && el.ownerDocument.defaultView;
    var style = view ? view.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    return false;
  }

  var seq = 0;
  function getOrAssignId(el) {
    try {
      if (el.dataset && el.dataset.wccId) return el.dataset.wccId;
      var id = 'wcc-p-' + (++seq);
      if (el.dataset) el.dataset.wccId = id;
      return id;
    } catch (e) {
      return 'wcc-p-x-' + (++seq);
    }
  }

  global.WCC = global.WCC || {};
  global.WCC.dom = { cleanText: cleanText, isIgnorable: isIgnorable, getOrAssignId: getOrAssignId };
})(typeof globalThis !== 'undefined' ? globalThis : self);