// 消息类型常量：content script / background / side panel 三方共享。
// 命名与 PRD 06-技术架构 §5 消息协议一致。
(function (global) {
  'use strict';
  global.WCC_MSG = Object.freeze({
    // content script → background：用户点击「深读」，提交当前选区
    CAPTURE_SELECTION: 'CAPTURE_SELECTION',
    // side panel → background：拉取当前 Active Selection
    GET_ACTIVE_SELECTION: 'GET_ACTIVE_SELECTION',
    // background → side panel：Active Selection 已更新（面板打开时实时刷新）
    ACTIVE_SELECTION_UPDATED: 'ACTIVE_SELECTION_UPDATED',
    // 诊断
    PING: 'PING'
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
