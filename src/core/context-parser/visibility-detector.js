// 可视区域检测：基于 Element.getBoundingClientRect()
(function (global) {
  'use strict';

  function VisibilityDetector() {}

  VisibilityDetector.prototype.detect = function (paragraphs, win) {
    win = win || window;
    var viewportHeight = win.innerHeight ||
      (document.documentElement && document.documentElement.clientHeight) || 0;
    var visible = [];

    for (var i = 0; i < paragraphs.length; i++) {
      var p = paragraphs[i];
      var el = p._element;
      if (!el || !el.getBoundingClientRect) continue;
      var rect;
      try { rect = el.getBoundingClientRect(); } catch (e) { continue; }

      // 判定规则：rect.bottom > 0 且 rect.top < window.innerHeight
      if (rect.bottom > 0 && rect.top < viewportHeight) {
        visible.push({
          id: p.id,
          text: p.text,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom)
        });
      }
    }
    return visible;
  };

  global.WCC = global.WCC || {};
  global.WCC.VisibilityDetector = VisibilityDetector;
})(typeof globalThis !== 'undefined' ? globalThis : self);