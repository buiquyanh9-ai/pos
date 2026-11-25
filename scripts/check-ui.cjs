const { chromium } = require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs = require('node:fs');
const path = require('node:path');
const root = 'http://127.0.0.1:4000';
const output = path.resolve('output/ui-check');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const results = [];
  try {
    const login = await fetch(`${root}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'chu', password: 'chu123456', client: 'ui-check' }) });
    if (!login.ok) throw new Error(`Owner login HTTP ${login.status}; no repeated attempts`);
    const session = await login.json();
    for (const width of process.env.UI_POS_ONLY ? [] : [360, 390, 430]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      await context.addInitScript(({ root, session }) => {
        localStorage.setItem('shopflow.boss.session', JSON.stringify(session));
        localStorage.setItem('shopflow.boss.url', JSON.stringify(root));
        localStorage.setItem('shopflow.boss.installHint', 'hidden');
      }, { root, session });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${root}/boss/`);
      await page.locator('.tabbar').waitFor();
      for (const tab of ['Tổng quan', 'Báo cáo', 'Hoạt động', 'Kho', 'Thêm']) {
        await page.locator('.tabbar .tab').filter({ has: page.locator('span', { hasText: new RegExp(`^${tab}$`) }) }).click();
        await page.waitForTimeout(450);
        if (tab === 'Kho') await page.locator('.segmented').getByRole('tab', { name: 'Nhập hàng', exact: true }).click();
        const metrics = await page.evaluate(() => {
          const box = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
          const selected = document.querySelector('.seg.on');
          return {
            viewport: { width: innerWidth, height: innerHeight },
            pageWidth: document.documentElement.scrollWidth,
            nav: box(document.querySelector('.tabbar')),
            chips: [...document.querySelectorAll('.chips')].map(box),
            chipButtons: [...document.querySelectorAll('.chip')].map(box),
            segmented: selected ? { text: selected.textContent, color: getComputedStyle(selected).color, lineHeight: getComputedStyle(selected).lineHeight, box: box(selected), whiteSpace: getComputedStyle(selected).whiteSpace } : null,
          };
        });
        const issues = [];
        if (metrics.pageWidth > width) issues.push('horizontal page overflow');
        if (metrics.nav.bottom > 845) issues.push('bottom navigation outside viewport');
        if (metrics.chips.some(r => r.height < 38)) issues.push('filter row squeezed');
        if (tab === 'Kho' && (metrics.segmented?.whiteSpace !== 'nowrap' || metrics.segmented?.color !== 'rgb(255, 255, 255)')) issues.push('purchase tab text wrapping/color');
        const file = `boss-${width}-${tab === 'Hoạt động' ? 'activity' : tab === 'Kho' ? 'stock' : tab === 'Tổng quan' ? 'home' : tab === 'Báo cáo' ? 'reports' : 'more'}.png`;
        await page.screenshot({ path: path.join(output, file) });
        results.push({ app: 'boss', width, tab, issues, errors: [...errors], metrics, screenshot: file });
      }
      await context.close();
    }
    const shiftData = await (await fetch(`${root}/api/shifts`, { headers: { authorization: `Bearer ${session.token}` } })).json();
    const openShift = shiftData.shifts.find(s => s.status === 'open');
    const context = await browser.newContext({ viewport: { width: 1624, height: 1000 } });
    await context.addInitScript(({ session, openShift }) => {
      localStorage.setItem('shopflow.session', JSON.stringify(session));
      if (openShift) {
        localStorage.setItem('shopflow.settings', JSON.stringify({ deviceId: openShift.deviceId }));
        localStorage.setItem('shopflow.shift', JSON.stringify(openShift));
      }
    }, { session, openShift });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${root}/pos/`);
    await page.waitForTimeout(1800);
    await page.locator('.pos-grid').waitFor();
    for (const category of ['Đồ ăn', 'Đồ ăn kèm', 'Đồ uống', 'Mang về']) {
      await page.locator('.pos-cats').getByRole('tab', { name: category, exact: true }).click();
      await page.waitForTimeout(400);
      await page.locator('.pos-menu').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.locator('.pos-tile').last().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await page.locator('.pos-tile').first().scrollIntoViewIfNeeded();
      const images = await page.locator('.pos-photo img').evaluateAll(images => images.map(i => ({ src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0 })));
      const missing = await page.locator('.pos-photo .pos-letter').count();
      await page.screenshot({ path: path.join(output, `pos-desktop-${category === 'Đồ ăn' ? 'food' : category === 'Đồ ăn kèm' ? 'sides' : category === 'Đồ uống' ? 'drinks' : 'takeaway'}.png`) });
      results.push({ app: 'pos', category, errors: [...errors], images, missing, tileCount: await page.locator('button.pos-tile').count() });
    }
    await page.locator('.pos-cats').getByRole('tab', { name: 'Đồ ăn', exact: true }).click();
    await page.locator('button.pos-tile').first().click();
    const cartLineCount = await page.locator('.pos-line').count();
    results.push({ app: 'pos-cart', cartLineCount, errors: [...errors] });
    await context.close();
    await fetch(`${root}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } });
    fs.writeFileSync(path.join(output, process.env.UI_POS_ONLY ? 'pos-results.json' : 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.map(({ app, width, tab, issues, errors, images, category, missing, tileCount, cartLineCount }) => ({ app, width, tab, issues, errors, images, category, missing, tileCount, cartLineCount })), null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
