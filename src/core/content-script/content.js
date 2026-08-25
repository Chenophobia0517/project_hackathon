// Content Script：捕获用户主动选择的文本，显示「深读」按钮，点击后提交给 Background。
// 产品原则（PRD 01-产品定义 §8）：不改造网页、用户主动触发、只读选中的那一句。
(function () {
  'use strict';

  // 防重复注入（扩展 reload 后对同一页面的二次注入）
  if (window.__QIUZHEN_CONTENT_READY__) return;
  window.__QIUZHEN_CONTENT_READY__ = true;

  var MIN_SELECTION_LENGTH = 2; // PRD 04-功能需求：selectedText.length >= 2 才显示按钮

  var button = null;
  var toastTimer = null;

  // ---------- 「深读」按钮 ----------

  function ensureButton() {
    if (button) return button;
    button = document.createElement('div');
    button.id = 'qiuzhen-shendu-btn';
    button.textContent = '深读';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', '深读当前选中内容');
    // 挂在 documentElement 上并用页面绝对坐标定位，避免宿主 body 布局干扰
    button.style.cssText = [
      'position: absolute', 'z-index: 2147483647',
      'display: none', 'align-items: center', 'justify-content: center',
      'padding: 6px 16px', 'border: none', 'border-radius: 999px',
      'background: linear-gradient(135deg, #3B82F6, #8B5CF6)',
      'color: #fff', 'font-size: 13px', 'font-weight: 600',
      'font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      'line-height: 1.4', 'cursor: pointer', 'user-select: none',
      'box-shadow: 0 4px 16px rgba(59, 130, 246, .35)'
    ].join(';');

    button.addEventListener('mouseenter', function () { button.style.transform = 'scale(1.06)'; });
    button.addEventListener('mouseleave', function () { button.style.transform = 'scale(1)'; });
    // 阻断按钮上的 mousedown/mouseup 冒泡：避免先触发"清空选区→隐藏"逻辑
    button.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    button.addEventListener('mouseup', function (e) { e.stopPropagation(); });
    button.addEventListener('click', onButtonClick);

    document.documentElement.appendChild(button);
    return button;
  }

  function showButtonAt(rect) {
    var el = ensureButton();
    el.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    // 先隐藏测量宽度再定位，避免闪跳
    el.style.visibility = 'hidden';
    el.style.display = 'flex';
    var width = el.offsetWidth || 64;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - width - 8;
    el.style.left = Math.max(window.scrollX + 8, Math.min(rect.left + window.scrollX, maxLeft)) + 'px';
    el.style.visibility = 'visible';
  }

  function hideButton() {
    if (!button) return;
    button.style.display = 'none';
  }

  // ---------- 选区捕获 ----------

  function getSelectionInfo() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    var text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < MIN_SELECTION_LENGTH) return null;
    var range = sel.getRangeAt(0);
    // 锚定选区最后一个矩形（末行）：按钮出现在用户视线收尾处
    var rects = range.getClientRects();
    var rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text: text, rect: rect };
  }

  function refreshFromSelection() {
    var info = getSelectionInfo();
    if (info) { showButtonAt(info.rect); } else { hideButton(); }
  }

  // ---------- 提交与反馈 ----------

  function buildPayload() {
    return {
      title: document.title || '',
      url: location.href || '',
      selectedText: window.getSelection().toString(),
      capturedAt: new Date().toISOString()
    };
  }

  function onButtonClick() {
    var info = getSelectionInfo();
    hideButton();
    if (!info) return; // 极端时序：点击前选区已消失

    var payload = buildPayload();
    try {
      chrome.runtime.sendMessage({ type: WCC_MSG.CAPTURE_SELECTION, payload: payload }, function (resp) {
        if (chrome.runtime.lastError) { showToast('深读连接失败，请刷新页面重试'); return; }
        // panelOpened=false：面板未能自动打开（可能已打开或被拦截），提示手动入口
        if (resp && resp.ok && resp.panelOpened === false) {
          showToast('如侧栏未打开，请点击浏览器工具栏的扩展图标');
        }
      });
    } catch (e) {
      // Extension context invalidated（扩展被重载）
      showToast('扩展已更新，请刷新页面');
    }
  }

  function showToast(msg) {
    var el = document.getElementById('qiuzhen-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qiuzhen-toast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position: fixed', 'left: 50%', 'transform: translateX(-50%)',
        'bottom: 32px', 'z-index: 2147483647',
        'padding: 10px 18px', 'border-radius: 12px',
        'background: rgba(20, 20, 30, .88)', 'color: #fff', 'font-size: 13px',
        'font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        'box-shadow: 0 8px 24px rgba(0,0,0,.25)', 'transition: opacity .25s'
      ].join(';');
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.style.display = 'none'; }, 300);
    }, 2400);
  }

  // ---------- 事件绑定 ----------

  var debounceHideTimer = null;
  function debounceHide() {
    clearTimeout(debounceHideTimer);
    debounceHideTimer = setTimeout(function () {
      // 选区被清除/收窄到无效时隐藏；拖拽选择过程中的中间态不闪烁
      if (!getSelectionInfo()) hideButton();
    }, 120);
  }

  document.addEventListener('mouseup', function (e) {
    // 点在自家按钮上不处理（click 会走提交流程）
    if (button && button.contains(e.target)) return;
    refreshFromSelection();
  }, true);

  document.addEventListener('keyup', function (e) {
    // Shift+方向键 / Ctrl+A 等键盘选区
    if (e.key === 'Shift' || e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.ctrlKey || e.metaKey) {
      refreshFromSelection();
    }
  }, true);

  document.addEventListener('selectionchange', debounceHide, true);

  // 滚动即隐藏按钮（PRD 05-UI-UX §3.4 方案 B）：选区按钮是一次性入口，非常驻工具
  window.addEventListener('scroll', hideButton, { passive: true });
})();
