// 节流与防抖，供滚动监听与 MutationObserver 使用。
(function (global) {
  'use strict';

  function throttle(fn, wait) {
    var last = 0;
    var timer = null;
    var lastArgs = null;
    var lastThis = null;
    return function () {
      var now = Date.now();
      lastArgs = arguments;
      lastThis = this;
      var remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        fn.apply(lastThis, lastArgs);
      } else if (!timer) {
        timer = setTimeout(function () {
          last = Date.now();
          timer = null;
          fn.apply(lastThis, lastArgs);
        }, remaining);
      }
    };
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(ctx, args); }, wait);
    };
  }

  global.WCC = global.WCC || {};
  global.WCC.throttle = throttle;
  global.WCC.debounce = debounce;
})(typeof globalThis !== 'undefined' ? globalThis : self);