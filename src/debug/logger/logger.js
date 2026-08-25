// Dev 日志：仅 console + 内存环形缓冲。不依赖、不影响 Core。
(function (global) {
  'use strict';
  var buffer = [];
  var MAX = 200;

  function write(level, msg) {
    buffer.push({ level: level, msg: String(msg), at: new Date().toISOString() });
    if (buffer.length > MAX) buffer.shift();
    var fn = level === 'ERROR' ? console.error : (level === 'WARN' ? console.warn : console.log);
    fn('[WCC-DEBUG][' + level + ']', msg);
  }

  global.WCCLogger = {
    info: function (m) { write('INFO', m); },
    warn: function (m) { write('WARN', m); },
    error: function (m) { write('ERROR', m); },
    dump: function () { return buffer.slice(); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);