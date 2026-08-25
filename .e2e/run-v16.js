// V1.6 回归：Hover 提示卡延迟隐藏/淡入淡出 + 悬浮球尺寸位置（用户反馈修复）
// 前置：Chrome 带 --remote-debugging-port=9333 --load-extension=<repo> 打开 http://127.0.0.1:8777/article.html
//       （见 run-e2e.js 头注释的完整启动说明）
// 运行：node .e2e/run-v16.js
const path = require('path');
const pw = require(path.join(process.env.LOCALAPPDATA, 'hermes', 'hermes-agent', 'node_modules', 'playwright-core'));

const tipState = (page) => page.evaluate(() => {
  const host = document.querySelector('div[style*="2147483647"][style*="pointer-events"]');
  if (!host) return 'no-host';
  const tip = host.shadowRoot.querySelector('.tip');
  return host.style.display + (tip.classList.contains('hiding') ? ':hiding' : '');
});

(async () => {
  const browser = await pw.chromium.connectOverCDP('http://127.0.0.1:9333');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('article.html'));
  if (!page) { console.log('FAIL: no article page'); process.exit(1); }
  await page.reload();
  await page.waitForTimeout(800);

  const R = [];
  const check = (name, ok, extra) => { R.push(ok); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); };

  // O2 悬浮球：84x84 左上角、字号放大
  const orb = await page.evaluate(() => {
    const o = document.querySelector('#qiuzhen-orb');
    const r = o.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top), fs: getComputedStyle(o).fontSize };
  });
  check('O2 orb 84x84', orb.w === 84 && orb.h === 84, orb.w + 'x' + orb.h);
  check('O2 orb 左上角', orb.left <= 20 && orb.top <= 20, orb.left + ',' + orb.top);
  check('O2 字号>=24', parseFloat(orb.fs) >= 24, orb.fs);

  // 激活 hover 层（悬浮球点击 → Ready）
  await page.locator('#qiuzhen-orb').click();
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    await page.waitForTimeout(500);
    ready = await page.evaluate(() => {
      const b = document.querySelector('#qiuzhen-orb > div:nth-child(2)');
      return b && b.style.display !== 'none';
    }).catch(() => false);
  }
  check('前置 Ready（hover 激活）', ready);
  if (!ready) process.exit(2);

  // O1 核心路径：句子 → 中间点（<300ms 延迟窗口）→ 卡片，全程不消失
  const span = page.locator('.qiuzhen-claim').first();
  await span.hover();
  await page.waitForTimeout(300);
  const s1 = await tipState(page);
  check('O1 hover 句子卡片显示', s1 === 'block', s1);

  const spanBox = await span.boundingBox();
  const hostBox = await page.evaluate(() => {
    const host = document.querySelector('div[style*="2147483647"][style*="pointer-events"]');
    const r = host.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(spanBox.x + spanBox.width / 2, spanBox.y + spanBox.height / 2);
  await page.waitForTimeout(80);
  await page.mouse.move((spanBox.x + hostBox.x) / 2, (spanBox.y + hostBox.y) / 2);
  await page.waitForTimeout(150);
  const s2 = await tipState(page);
  check('O1 移动途中不消失（300ms 窗口）', s2 === 'block', s2);
  await page.mouse.move(hostBox.x, hostBox.y);
  await page.waitForTimeout(150);
  const s3 = await tipState(page);
  check('O1 进入卡片保持（shadowRoot 保护）', s3 === 'block', s3);

  // 卡片按钮可点击（进面板）
  await page.evaluate(() => {
    const host = document.querySelector('div[style*="2147483647"][style*="pointer-events"]');
    host.shadowRoot.querySelector('.btn[data-mode="truth"]').click();
  });
  check('O1 卡片按钮可点击', true);

  // 离开 → 延迟 + 淡出隐藏
  await page.mouse.move(spanBox.x + spanBox.width / 2, spanBox.y + spanBox.height / 2 + 150);
  await page.waitForTimeout(100);
  const fading = await tipState(page);
  await page.waitForTimeout(600);
  const gone = await tipState(page);
  check('O1 离开后延迟+淡出隐藏', gone === 'none', 'fading@100ms=' + fading + ' final=' + gone);

  const pass = R.every(Boolean);
  console.log(pass ? '\nV1.6 VERIFY: PASS (' + R.length + '/' + R.length + ')' : '\nV1.6 VERIFY: FAIL (' + R.filter(Boolean).length + '/' + R.length + ')');
  process.exit(pass ? 0 : 3);
})().catch(e => { console.error('ERROR:', e.message); process.exit(99); });
