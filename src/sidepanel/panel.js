// Side Panel（M0 最小骨架）：获取并显示当前 Active Selection。
// M2 将在此之上叠加三 Tab 工作台与 AI 分析结果。
(function () {
  'use strict';

  var els = {
    empty: document.getElementById('empty-state'),
    card: document.getElementById('claim-card'),
    text: document.getElementById('claim-text'),
    sourceTitle: document.getElementById('claim-source-title'),
    expand: document.getElementById('claim-expand'),
    debug: document.getElementById('debug-msgs')
  };

  function showClaim(payload) {
    if (!payload || !payload.selectedText) return;

    var text = String(payload.selectedText);
    els.text.textContent = '“' + text + '”';
    // 长文本折叠（PRD 05-UI-UX §7.3）
    els.expand.hidden = text.length <= 90;
    els.text.classList.remove('expanded');
    els.expand.textContent = '展开全文';

    els.sourceTitle.textContent = payload.title || '';
    els.card.hidden = false;
    els.empty.hidden = true;
  }

  function resetToEmpty() {
    els.card.hidden = true;
    els.empty.hidden = false;
  }

  els.expand.addEventListener('click', function () {
    var expanded = els.text.classList.toggle('expanded');
    els.expand.textContent = expanded ? '收起' : '展开全文';
  });

  // 面板打开时拉取当前 Active Selection
  try {
    chrome.runtime.sendMessage({ type: WCC_MSG.GET_ACTIVE_SELECTION }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.selection && resp.selection.payload) {
        showClaim(resp.selection.payload);
      }
    });
  } catch (e) { /* context invalidated */ }

  // 面板已打开时，新选区实时更新
  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== WCC_MSG.ACTIVE_SELECTION_UPDATED) return;
    if (!message.payload || !message.payload.selectedText) { resetToEmpty(); return; }
    showClaim(message.payload);
  });
})();
