// Dev 通信链路观察：Content Script → Background → Storage 各阶段状态。
(function (global) {
  'use strict';
  var stages = ['contentScript', 'background', 'storage'];
  var state = {};
  stages.forEach(function (s) { state[s] = { state: 'UNKNOWN', lastAt: null }; });

  global.WCCInspector = {
    mark: function (stage) {
      if (state[stage]) {
        state[stage].state = 'OK';
        state[stage].lastAt = new Date().toISOString();
      }
    },
    snapshot: function () { return JSON.parse(JSON.stringify(state)); },
    describe: function () {
      return 'Content Script: ' + state.contentScript.state +
        ' -> Background: ' + state.background.state +
        ' -> Storage: ' + state.storage.state;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);