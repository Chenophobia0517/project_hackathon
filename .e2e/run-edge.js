// 边界用例：A) 选区 <2 字符不出按钮  B) 滚动隐藏按钮
const path = require('path');
const pw = require(path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent', 'node_modules', 'playwright-core'));

(async () => {
  const browser = await pw.chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('test-page.html'));
  if (!page) { console.log('FAIL: page not found'); process.exit(1); }
  await page.reload(); // 确保拿到最新测试页（页面高度影响滚动用例）
  await page.waitForTimeout(500);

  // CASE A：选中 1 个字符 → 不应出现按钮
  await page.evaluate(() => {
    const p = document.getElementById('p2');
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 1);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const btnAfterShort = await page.locator('#qiuzhen-shendu-btn').isVisible().catch(() => false);
  console.log('CASE-A short selection shows button:', btnAfterShort, btnAfterShort ? '❌' : '✅');

  // CASE B：有效选区出按钮后滚动 → 按钮应隐藏
  await page.evaluate(() => {
    const p = document.getElementById('p2');
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 20);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const visibleBefore = await page.locator('#qiuzhen-shendu-btn').isVisible().catch(() => false);
  await page.evaluate(() => window.scrollBy(0, 120));
  await page.waitForTimeout(300);
  const visibleAfterScroll = await page.locator('#qiuzhen-shendu-btn').isVisible().catch(() => false);
  console.log('CASE-B button before scroll:', visibleBefore, '| after scroll:', visibleAfterScroll,
    (visibleBefore && !visibleAfterScroll) ? '✅' : '❌');

  // 清理选区，避免影响后续操作
  await page.evaluate(() => window.getSelection().removeAllRanges());
  const pass = !btnAfterShort && visibleBefore && !visibleAfterScroll;
  console.log(pass ? '\nEDGE RESULT: PASS ✅' : '\nEDGE RESULT: FAIL ❌');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(99); });
