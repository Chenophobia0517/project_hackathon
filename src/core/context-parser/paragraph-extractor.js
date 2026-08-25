// 结构化文本解析：提取段落级文本单元，保留文本内容、DOM 位置、页面顺序。
(function (global) {
  'use strict';

  var BLOCK_SELECTORS = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li', 'blockquote', 'pre', 'dd', 'dt',
    'figcaption', 'caption', 'summary'
  ].join(',');

  function ParagraphExtractor() {}

  ParagraphExtractor.prototype.extract = function (doc) {
    doc = doc || document;
    var candidates = [];
    try {
      candidates = Array.prototype.slice.call(doc.querySelectorAll(BLOCK_SELECTORS));
    } catch (e) {
      return []; // 页面无正文结构等异常 → 返回空数组
    }

    var paragraphs = [];
    var seen = {};
    var scrollY = (doc.defaultView && doc.defaultView.scrollY) || 0;

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (WCC.dom.isIgnorable(el)) continue;

      var text = WCC.dom.cleanText(el);
      if (!text || text.length < 2) continue;

      // 跳过仍包含子块级元素的容器，避免父子重复计数
      try { if (el.querySelector(BLOCK_SELECTORS)) continue; } catch (e2) {}

      var rect;
      try { rect = el.getBoundingClientRect(); } catch (e3) { continue; }

      var id = WCC.dom.getOrAssignId(el);
      if (seen[id]) continue;
      seen[id] = true;

      paragraphs.push({
        id: id,
        text: text,
        position: {
          top: Math.round(rect.top + scrollY),
          bottom: Math.round(rect.bottom + scrollY)
        },
        _element: el // 内部引用：供可视检测使用，序列化前必须剥离
      });
    }
    return paragraphs; // 数组顺序 = DOM 顺序 = 页面顺序
  };

  global.WCC = global.WCC || {};
  global.WCC.ParagraphExtractor = ParagraphExtractor;
})(typeof globalThis !== 'undefined' ? globalThis : self);