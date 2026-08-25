// 测试页面自检：验证测试环境满足 Skill 要求。
// 打开测试页面 → F12 → Console 查看结果。
(function () {
  'use strict';
  window.addEventListener('load', function () {
    setTimeout(function () {
      var results = [];
      var pCount = document.querySelectorAll('#article p').length;
      results.push({ name: '段落数量 ≥ 50', pass: pCount >= 50, actual: pCount });
      results.push({ name: '包含数字声明', pass: /\d/.test(document.getElementById('article').innerText) });
      results.push({ name: '页面可滚动', pass: document.documentElement.scrollHeight > window.innerHeight });
      results.push({ name: '动态加载触发器存在', pass: !!document.getElementById('load-more') });
      results.push({ name: '页面标题存在', pass: !!document.title });

      var allPass = results.every(function (r) { return r.pass; });
      console.group('%c[WCC Test Runner] 测试页面自检: ' + (allPass ? 'ALL PASS' : 'HAS FAILURE'), 'font-weight:bold');
      results.forEach(function (r) {
        console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.actual != null ? '（实际: ' + r.actual + '）' : ''));
      });
      console.groupEnd();
      window.__WCC_TEST_RESULTS__ = results;
    }, 500);
  });
})();