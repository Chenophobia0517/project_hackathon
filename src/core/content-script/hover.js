// Hover 声明交互（V1.5 U3）：Claim Index → 句子打标 → 悬浮提示卡 → 复用现有分析链路。
// 原则（v1.5_UPGRADE §2.5/§10）：不改原文文字；轻微高亮（虚线下划线+Hover 浅色底，VD2）；
// 非 Claim 文本 Hover 零处理；提示卡 Shadow DOM 隔离样式。
(function () {
  'use strict';

  if (window.__QIUZHEN_HOVER_READY__) return;
  window.__QIUZHEN_HOVER_READY__ = true;

  var claimById = {};      // claimId -> claim
  var docMeta = null;      // {title, url}（CAPTURE_SELECTION payload 用）
  var marks = [];          // 已打标的 span（清理用）
  var host = null;         // 提示卡 Shadow DOM 宿主
  var shadow = null;
  var hideTimer = null;    // 延迟隐藏（O1：给鼠标留出移动到卡片的时间）
  var lastHoverClaimId = null;

  // ---------- 样式注入（页面内高亮，仅装饰不改文字） ----------

  function ensureStyle() {
    if (document.getElementById('qiuzhen-hover-style')) return;
    var st = document.createElement('style');
    st.id = 'qiuzhen-hover-style';
    st.textContent = [
      '.qiuzhen-claim {',
      '  text-decoration: underline dotted rgba(79,110,247,.65);',
      '  text-underline-offset: 3px; cursor: pointer;',
      '  transition: background .18s ease;',
      '}',
      '.qiuzhen-claim:hover { background: rgba(79,110,247,.14); border-radius: 2px; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- 打标：按 sentence offset 包裹原文（不改变文字内容） ----------

  function wrapClaim(paraEl, start, end, claimId) {
    var walker = document.createTreeWalker(paraEl, NodeFilter.SHOW_TEXT);
    var offset = 0;
    var node;
    while ((node = walker.nextNode())) {
      var len = (node.textContent || '').length;
      var nodeStart = offset;
      var nodeEnd = offset + len;
      offset = nodeEnd;
      if (nodeEnd <= start || nodeStart >= end) continue;
      var s = Math.max(start - nodeStart, 0);
      var e = Math.min(end - nodeStart, len);
      if (s >= e) continue;
      var range = document.createRange();
      range.setStart(node, s);
      range.setEnd(node, e);
      // 每个文本节点独立创建 span（v2.0 回归修复：N6 误删声明致 ReferenceError 中断全部打标）
      var span = document.createElement('span');
      try {
        span.className = 'qiuzhen-claim';
        span.dataset.claimId = claimId;
        range.surroundContents(span); // 仅当 range 在单个文本节点内才成功
        marks.push(span);
        return true;
      } catch (err) {
        return false; // 跨节点（含 <a>/<strong> 等内联元素）→ 放弃打标，hover 兜底
      }
    }
    return false;
  }

  function activate(index, meta) {
    deactivate();
    if (!index || !index.claims || !index.claims.length) return;
    docMeta = meta || null;
    ensureStyle();
    var extractor = window.__QIUZHEN_EXTRACTOR__;
    index.claims.forEach(function (claim) {
      var pos = claim.position;
      if (!pos || !pos.paraId) return;
      try {
        // 独立兜底：任何一条的异常只跳过该条，不中断其余 Claim 打标（v2.0 防御加固）
        var paraEl = extractor && extractor.getParaElement(pos.paraId);
        if (!paraEl) return;
        if (wrapClaim(paraEl, pos.start, pos.end, claim.id)) {
          claimById[claim.id] = claim;
        }
      } catch (err) { /* 单条失败不影响整体 */ }
    });
    if (Object.keys(claimById).length) document.addEventListener('mouseover', onMouseOver, true);
  }

  function deactivate() {
    document.removeEventListener('mouseover', onMouseOver, true);
    cancelHide();
    marks.forEach(function (m) {
      var parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      }
    });
    marks = [];
    claimById = {};
    docMeta = null;
    hideTooltip();
  }

  // ---------- 提示卡（Shadow DOM 隔离） ----------

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none; display: none; left: 0; top: 0;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = [
      '<style>',
      ':host { all: initial; }',
      '.tip {',
      '  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;',
      '  max-width: 300px; padding: 10px 12px; border-radius: 14px;',
      '  background: rgba(250,250,253,.92); backdrop-filter: blur(14px) saturate(160%);',
      '  border: 1px solid rgba(255,255,255,.7);',
      '  box-shadow: 0 10px 32px rgba(30,40,80,.22);',
      '  color: #20263a; font-size: 12.5px; line-height: 1.6;',
      '  pointer-events: auto;',
      '  opacity: 1; transform: translateY(0);',
      '  transition: opacity .18s ease, transform .18s ease;',
      '}',
      '.tip.hiding { opacity: 0; transform: translateY(4px); }',
      '.badge { display: inline-block; padding: 1px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #8a6d1a; border: 1px solid #d9b84a; background: rgba(217,184,74,.14); margin-bottom: 6px; }',
      '.text { margin: 4px 0 8px; }',
      '.btns { display: flex; gap: 8px; }',
      '.btn { border: none; cursor: pointer; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; background: linear-gradient(135deg, #32ade6, #a05bf5); }',
      '.btn:hover { filter: brightness(1.08); }',
      '</style>',
      '<div class="tip">',
      '  <div class="badge">🟡 可验证声明</div>',
      '  <div class="text"></div>',
      '  <div class="btns"><button class="btn" data-mode="truth">求真</button><button class="btn" data-mode="deep">求深</button><button class="btn" data-mode="differ">求异</button></div>',
      '</div>'
    ].join('');
    // O1：卡片自身 hover 保护——进入卡片取消延迟隐藏，离开卡片再延迟
    shadow.querySelector('.tip').addEventListener('mouseenter', cancelHide);
    shadow.querySelector('.tip').addEventListener('mouseleave', function () { scheduleHide(250); });
    shadow.querySelectorAll('.btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var claim = claimById[host.dataset.claimId];
        if (!claim || !docMeta) return;
        // 复用现有主动选区链路（CAPTURE_SELECTION）——不新建分析入口
        try {
          chrome.runtime.sendMessage({
            type: WCC_MSG.CAPTURE_SELECTION,
            payload: {
              title: docMeta.title,
              url: docMeta.url,
              selectedText: claim.text,
              capturedAt: new Date().toISOString()
            }
          }, function () {});
        } catch (e) { /* context invalidated */ }
        hideTooltip();
      });
    });
    document.documentElement.appendChild(host);
  }

  // O1：延迟隐藏——鼠标离开句子后给 ~300ms 移动窗口，期间进入卡片即取消
  function scheduleHide(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { hideTooltip(); }, delay || 300);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  function hideTooltip() {
    if (!host || host.style.display === 'none') return;
    var tip = shadow.querySelector('.tip');
    tip.classList.add('hiding'); // 淡出动画
    clearTimeout(host._hideDone);
    host._hideDone = setTimeout(function () {
      host.style.display = 'none';
      tip.classList.remove('hiding');
    }, 200); // 与 transition 时长一致
  }

  function showTooltip(claim, x, y) {
    ensureHost();
    cancelHide();
    var isNewClaim = host.dataset.lastClaim !== claim.id;
    host.dataset.claimId = claim.id;
    host.dataset.lastClaim = claim.id;
    shadow.querySelector('.text').textContent = claim.text;
    if (isNewClaim) {
      // 新句：定位一次；同句内移动不跟随（避免卡片追着鼠标跑，用户无法点击）
      var w = 320, h = 160;
      var left = x + 14, top = y + 16;
      if (left + w > window.innerWidth - 8) left = x - w - 14;
      if (top + h > window.innerHeight - 8) top = y - h - 16;
      host.style.left = Math.max(8, left) + 'px';
      host.style.top = Math.max(8, top) + 'px';
    }
    host.style.display = 'block';
    void host.offsetWidth; // 强制 reflow 使 transition 生效
    shadow.querySelector('.tip').classList.remove('hiding'); // 淡入
  }

  // ---------- 委托 ----------

  function onMouseOver(e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    // O1 根因修复：Element.contains 不穿透 Shadow DOM——卡片内部 hover 必须识别为"在卡片上"
    var insideHost = host && (host.contains(target) || (host.shadowRoot && host.shadowRoot.contains(target)));
    if (insideHost) { cancelHide(); return; }
    var span = target.closest ? target.closest('.qiuzhen-claim') : null;
    if (!span) {
      if (lastHoverClaimId) scheduleHide(300); // 离开句子：延迟隐藏，留出移动到卡片的时间
      return;
    }
    var claim = claimById[span.dataset.claimId];
    if (!claim) { scheduleHide(300); return; }
    lastHoverClaimId = claim.id;
    showTooltip(claim, e.clientX, e.clientY);
  }

  // ---------- 面板定位请求（N6：Claim ↔ 网页定位闭环） ----------

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || message.type !== 'QIUZHEN_LOCATE_CLAIM') return;
      var ok = false;
      if (message.claimId) ok = scrollToClaimId(message.claimId);
      if (!ok && message.sentenceId) ok = scrollToClaim(message.sentenceId);
      try { sendResponse({ ok: ok }); } catch (e) { /* 忽略 */ }
    });
  }

  window.__QIUZHEN_HOVER__ = {
    activate: activate,
    deactivate: deactivate,
    // N6：Claim ↔ 网页定位——滚动到声明句并高亮闪烁
    scrollToClaim: function (sentenceId) {
      var target = null;
      for (var i = 0; i < marks.length; i++) {
        if (marks[i].dataset.claimId && marks[i].dataset.sid === sentenceId) { target = marks[i]; break; }
      }
      if (!target) {
        // 兜底：按 data-qz-sid 找（未打标但 extractor 有锚点的段落）
        return false;
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.style.background = 'rgba(79,110,247,.28)';
      setTimeout(function () { target.style.background = ''; }, 1600);
      return true;
    },
    // 按 claimId 直接定位（marks 上存了 claimId）
    scrollToClaimId: function (claimId) {
      for (var i = 0; i < marks.length; i++) {
        if (marks[i].dataset.claimId === claimId) {
          marks[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
          marks[i].style.background = 'rgba(79,110,247,.28)';
          var m = marks[i];
          setTimeout(function () { m.style.background = ''; }, 1600);
          return true;
        }
      }
      return false;
    }
  };
})();
