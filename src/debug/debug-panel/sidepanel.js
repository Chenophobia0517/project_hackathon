// Debug Side Panel：读取 Background / Storage 数据并实时渲染。仅开发用。
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  var els = {
    extStatus: $('ext-status'), csStatus: $('cs-status'), bgStatus: $('bg-status'),
    pageTitle: $('page-title'), pageUrl: $('page-url'), capturedAt: $('captured-at'),
    totalCount: $('total-count'), visibleCount: $('visible-count'),
    readingList: $('reading-list'), logList: $('log-list')
  };

  function now() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

  function addLog(text) {
    var div = document.createElement('div');
    div.className = 'log-item';
    div.textContent = now() + '  ' + text;
    els.logList.insertBefore(div, els.logList.firstChild);
    while (els.logList.children.length > 100) els.logList.removeChild(els.logList.lastChild);
    if (window.WCCLogger) window.WCCLogger.info(text);
  }

  function renderContext(context) {
    if (!context || !context.payload) {
      els.extStatus.textContent = 'CONNECTED';
      els.csStatus.textContent = 'WAITING...';
      els.bgStatus.textContent = 'ACTIVE';
      return;
    }
    var p = context.payload;
    els.extStatus.textContent = 'CONNECTED';
    els.csStatus.textContent = 'ACTIVE';
    els.bgStatus.textContent = 'ACTIVE';
    els.pageTitle.textContent = p.title || '(无标题)';
    els.pageUrl.textContent = p.url || '-';
    els.capturedAt.textContent = p.capturedAt || '-';
    els.totalCount.textContent = String(p.totalParagraphCount != null ? p.totalParagraphCount : '-');
    var vp = p.visibleParagraphs || [];
    els.visibleCount.textContent = String(vp.length);

    els.readingList.textContent = '';
    vp.forEach(function (item, idx) {
      var wrap = document.createElement('div');
      wrap.className = 'paragraph-item';
      var head = document.createElement('div');
      head.className = 'paragraph-head';
      head.textContent = 'Paragraph ' + (idx + 1) + ':';
      var pos = document.createElement('div');
      pos.className = 'paragraph-pos';
      pos.textContent = 'top: ' + item.top + '  bottom: ' + item.bottom;
      var body = document.createElement('div');
      body.className = 'paragraph-text';
      body.textContent = item.text;
      wrap.appendChild(head);
      wrap.appendChild(pos);
      wrap.appendChild(body);
      els.readingList.appendChild(wrap);
    });
  }

  function pullFromBackground() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_CURRENT_CONTEXT' }, function (resp) {
        if (chrome.runtime.lastError) {
          addLog('通信错误: ' + chrome.runtime.lastError.message);
          return;
        }
        if (resp && resp.ok) renderContext(resp.context);
      });
    } catch (e) {
      addLog('错误: ' + e.message);
    }
  }

  // 实时：Content Script → Background → Storage 链路末端
  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName !== 'session' || !changes.currentContext) return;
    addLog('Content Script captured context');
    addLog('Background received message');
    addLog('Storage updated');
    if (window.WCCInspector) {
      window.WCCInspector.mark('contentScript');
      window.WCCInspector.mark('background');
      window.WCCInspector.mark('storage');
    }
    renderContext(changes.currentContext.newValue);
  });

  addLog('Debug Panel opened');
  pullFromBackground();
  setInterval(pullFromBackground, 5000); // 兜底轮询
})();