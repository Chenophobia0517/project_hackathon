// Background Service Worker：接收上下文、保存状态、提供查询接口。
importScripts('../utils/message-types.js');

var latestContext = null; // 内存副本

function saveContext(payload, sender) {
  latestContext = {
    payload: payload,
    tabId: sender && sender.tab ? sender.tab.id : null,
    receivedAt: new Date().toISOString()
  };
  try {
    chrome.storage.session.set({ currentContext: latestContext });
  } catch (e) {
    // storage 异常时仅保留内存副本
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;

  switch (message.type) {
    case WCC_MSG.PAGE_CONTEXT_UPDATED:
      saveContext(message.payload, sender);
      sendResponse({ ok: true });
      return false;

    case WCC_MSG.GET_CURRENT_CONTEXT:
      sendResponse({ ok: true, context: latestContext });
      return false;

    case WCC_MSG.PING:
      sendResponse({ ok: true, pong: true, at: Date.now() });
      return false;

    default:
      return false; // Core 不响应任何 debug/test 消息类型
  }
});

// dev 版：点击扩展图标打开 Side Panel（prod 无 sidePanel 权限，此分支不执行）
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
}