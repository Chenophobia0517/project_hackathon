// Content Script：注入页面、捕获上下文、监听滚动与 DOM 变化、发送到 Background。
(function () {
  'use strict';

  var SCROLL_THROTTLE_MS = 300;
  var MUTATION_DEBOUNCE_MS = 600;
  var RESIZE_DEBOUNCE_MS = 300;

  var extractor = new WCC.ParagraphExtractor();
  var detector = new WCC.VisibilityDetector();

  function buildPayload() {
    var paragraphs = [];
    var visible = [];
    try {
      paragraphs = extractor.extract(document);
      visible = detector.detect(paragraphs);
    } catch (e) {
      // 页面无文本 / 无正文结构 → 空结果，仍然上报
    }
    return {
      title: document.title || '',
      url: location.href || '',
      visibleText: visible.map(function (p) { return p.text; }).join('\n'),
      visibleParagraphs: visible,
      totalParagraphCount: paragraphs.length,
      capturedAt: new Date().toISOString()
    };
  }

  function sendToBackground(payload) {
    try {
      chrome.runtime.sendMessage({
        type: WCC_MSG.PAGE_CONTEXT_UPDATED,
        payload: payload
      }, function () {
        // Extension context invalidated / 通道关闭 → 静默，等待页面重新注入
        if (chrome.runtime.lastError) { /* noop */ }
      });
    } catch (e) {
      // Extension context invalidated：扩展被重载时此处会抛异常，静默处理
    }
  }

  function capture() {
    sendToBackground(buildPayload());
  }

  // 滚动监听（throttle 避免频繁计算）
  window.addEventListener('scroll', WCC.throttle(capture, SCROLL_THROTTLE_MS), { passive: true });

  // 视口尺寸变化
  window.addEventListener('resize', WCC.debounce(capture, RESIZE_DEBOUNCE_MS));

  // MutationObserver：SPA / 动态加载 / 无限滚动
  try {
    var observer = new MutationObserver(WCC.debounce(capture, MUTATION_DEBOUNCE_MS));
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  } catch (e) { /* 异常环境降级为仅滚动捕获 */ }

  // 初始捕获
  capture();
})();