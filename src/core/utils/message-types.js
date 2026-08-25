// 消息类型常量：content script 与 background 共享。
(function (global) {
  'use strict';
  global.WCC_MSG = Object.freeze({
    PAGE_CONTEXT_UPDATED: 'PAGE_CONTEXT_UPDATED',
    GET_CURRENT_CONTEXT: 'GET_CURRENT_CONTEXT',
    PING: 'PING'
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);