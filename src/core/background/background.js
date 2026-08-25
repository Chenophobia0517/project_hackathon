// Background Service Worker：Active Selection 的唯一中转与持久点（MV3，无独立后端——D2=B）。
// 职责（PRD 06-技术架构 §4）：接收 CAPTURE_SELECTION → 存 storage.session → 广播/打开 Side Panel。
importScripts('../utils/message-types.js');

// ---------- Active Selection 状态 ----------

var latestSelection = null; // 内存副本（SW 可能被休眠，storage.session 是权威）

function saveSelection(payload, sender) {
  latestSelection = {
    payload: payload,
    tabId: sender && sender.tab ? sender.tab.id : null,
    receivedAt: new Date().toISOString()
  };
  try {
    chrome.storage.session.set({ activeSelection: latestSelection });
  } catch (e) {
    // storage 异常时仅保留内存副本
  }
}

// ---------- Side Panel 控制 ----------

// 打开 Side Panel；无论成功失败都以 done 回调应答（异步响应，listener 需 return true）
function openSidePanel(tabId, done) {
  if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && typeof tabId === 'number') {
    chrome.sidePanel.open({ tabId: tabId }).then(
      function () { done({ ok: true }); },
      function () {
        // 打开失败（如面板已打开/无 gesture）：走广播路径更新已开面板
        notifyPanel();
        done({ ok: true, panelOpened: false });
      }
    );
  } else {
    notifyPanel();
    done({ ok: true, panelOpened: false });
  }
}

function notifyPanel() {
  if (!latestSelection) return;
  chrome.runtime.sendMessage({
    type: WCC_MSG.ACTIVE_SELECTION_UPDATED,
    payload: latestSelection.payload
  }, function () {
    // Side Panel 未打开时此处产生 lastError：属正常路径，静默
    void chrome.runtime.lastError;
  });
}

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;

  switch (message.type) {
    case WCC_MSG.CAPTURE_SELECTION:
      if (!message.payload || typeof message.payload.selectedText !== 'string' ||
          message.payload.selectedText.trim().length === 0) {
        sendResponse({ ok: false, reason: 'empty_selection' });
        return false;
      }
      saveSelection(message.payload, sender);
      // PRD 06-技术架构 §8：先存后开；面板已打开时 open 失败 → 走广播更新
      openSidePanel(sender && sender.tab ? sender.tab.id : null, sendResponse);
      return true; // 异步响应（等 sidePanel.open 结果）

    case WCC_MSG.GET_ACTIVE_SELECTION:
      // 面板刚打开时拉取当前 Active Selection
      if (latestSelection) {
        sendResponse({ ok: true, selection: latestSelection });
      } else {
        // SW 被休眠后内存为空：回退读 storage.session
        chrome.storage.session.get('activeSelection', function (data) {
          latestSelection = (data && data.activeSelection) || null;
          sendResponse({ ok: true, selection: latestSelection });
        });
        return true; // 异步响应
      }
      return false;

    case WCC_MSG.PING:
      sendResponse({ ok: true, pong: true, at: Date.now() });
      return false;

    default:
      return false;
  }
});

// 能力检测：点击扩展图标时打开 Side Panel（openPanelOnActionClick）。
// 同时作为「深读」按钮失效时的手动入口（PRD 05-UI-UX §28 最后一行）。
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
}
