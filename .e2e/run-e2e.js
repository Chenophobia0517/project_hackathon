// M0 端到端验证：合成选区 → 深读按钮出现 → 点击 → Side Panel 打开并显示 Claim。
// 运行前提：Chrome 已带 --load-extension 和 --remote-debugging-port=9333 启动。
const path = require('path');
const pw = require(path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent', 'node_modules', 'playwright-core'));

(async () => {
  const browser = await pw.chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];

  // 找到测试页 tab
  let page = null;
  for (const p of ctx.pages()) {
    if (p.url().includes('test-page.html')) { page = p; break; }
  }
  if (!page) { console.log('FAIL: test-page not found'); process.exit(1); }
  console.log('STEP1 page:', page.url());

  // STEP2: 合成选区 + mouseup（content script 在隔离世界，但监听的是真实 DOM 事件）
  const sel = await page.evaluate(() => {
    const p = document.getElementById('p1');
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 25);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return s.toString().length;
  });
  console.log('STEP2 selection length:', sel);
  await page.waitForTimeout(400);

  // STEP3: 按钮出现且可见
  const btn = page.locator('#qiuzhen-shendu-btn');
  const btnVisible = await btn.isVisible().catch(() => false);
  const btnText = btnVisible ? await btn.textContent() : '(none)';
  console.log('STEP3 button visible:', btnVisible, '| text:', JSON.stringify(btnText));
  if (!btnVisible) {
    await browser.close();
    process.exit(2);
  }

  // STEP4: 真实点击按钮（产生 user gesture，sidePanel.open 需要）
  await btn.click();
  console.log('STEP4 clicked');
  await page.waitForTimeout(1500);

  // STEP5: 检查 Side Panel 页面是否打开（扩展页面 target，Playwright 发现有延迟 → 轮询）
  let panelPage = null;
  for (let i = 0; i < 10 && !panelPage; i++) {
    await page.waitForTimeout(500);
    const pools = [ctx.pages()];
    for (const c of browser.contexts()) pools.push(c.pages());
    for (const pool of pools) {
      for (const p of pool) {
        if (p.url().includes('sidepanel/index.html')) { panelPage = p; break; }
      }
      if (panelPage) break;
    }
  }
  console.log('STEP5 side panel target:', panelPage ? panelPage.url() : 'NOT FOUND');

  if (!panelPage) {
    // background service worker 的诊断
    const workers = ctx.serviceWorkers ? ctx.serviceWorkers() : [];
    console.log('  (service workers:', workers.map(w => w.url()).join(', ') || 'none', ')');
    await browser.close();
    process.exit(3);
  }

  await panelPage.waitForTimeout(600);
  // STEP6: 面板显示 Claim、Empty 隐藏
  const claimHidden = await panelPage.locator('#claim-card').isHidden();
  const emptyHidden = await panelPage.locator('#empty-state').isHidden();
  const claimText = await panelPage.locator('#claim-text').textContent();
  const sourceTitle = await panelPage.locator('#claim-source-title').textContent();
  console.log('STEP6 claim-card hidden:', claimHidden, '| empty hidden:', emptyHidden);
  console.log('      claim text:', JSON.stringify(claimText.slice(0, 40)));
  console.log('      source title:', JSON.stringify(sourceTitle));

  const pass = !claimHidden && emptyHidden && claimText.includes('人工智能') && sourceTitle.includes('测试页');
  console.log(pass ? '\nE2E RESULT: PASS ✅' : '\nE2E RESULT: FAIL ❌');
  await browser.close();
  process.exit(pass ? 0 : 4);
})().catch(e => { console.error('E2E ERROR:', e.message); process.exit(99); });
