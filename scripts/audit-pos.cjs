const { chromium } = require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(process.env.AUDIT_OUT || 'output/pos-audit');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const { openDb } = await import('../apps/server/src/db.ts');
  const { seedIfEmpty } = await import('../apps/server/src/seed.ts');
  const { importMenu } = await import('../apps/server/src/menu.ts');
  const { createApp } = await import('../apps/server/src/app.ts');
  const db = openDb(':memory:');
  seedIfEmpty(db);
  importMenu(db, fs.readFileSync('../product/z.product', 'utf8'), { sampleStock: true });
  const server = createApp({ db }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const reports = [];
  try {
    const session = await (await fetch(`${root}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'chu', password: 'chu123456', client: 'isolated-pos-audit' }) })).json();
    const api = async (url, body) => {
      const response=await fetch(root + '/api' + url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data=await response.json();if(!response.ok)throw Error(`${url}: ${response.status} ${JSON.stringify(data)}`);return data;
    };
    const sizes = process.env.AUDIT_SIZE ? [process.env.AUDIT_SIZE.split('x').map(Number)] : [[1366,768],[1624,1000],[360,800],[390,844],[430,932],[844,390]];
    for (const [width,height] of sizes) {
      const id = `${width}x${height}`;
      const mobile = width < 900;
      const deviceId = `audit-${id}`;
      const shift = await api('/shifts/open', { deviceId, openingCash: 500000 });
      const context = await browser.newContext({ viewport: {width,height}, isMobile: mobile, hasTouch: mobile, acceptDownloads: true, colorScheme: 'dark' });
      await context.addInitScript(({session,shift,deviceId,root}) => {
        if (!localStorage.getItem('shopflow.session')) localStorage.setItem('shopflow.session', JSON.stringify(session));
        if (!localStorage.getItem('shopflow.settings')) localStorage.setItem('shopflow.settings', JSON.stringify({ deviceId, backendUrl: root, hardware: { printer: 'mock', drawer: 'mock' } }));
        if (!localStorage.getItem('shopflow.shift')) localStorage.setItem('shopflow.shift', JSON.stringify(shift));
      }, {session,shift,deviceId,root});
      const page = await context.newPage();
      page.setDefaultTimeout(3500);
      const report = { size:id, steps:[], errors:[], badRequests:[] };
      reports.push(report);
      page.on('pageerror', e => report.errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) report.badRequests.push({url:r.url().replace(root,''),status:r.status()}); });
      const shot = async label => page.screenshot({ path:path.join(out,`${id}-${label}.png`) });
      const metrics = async selectors => page.evaluate(selectors => {
        const box = el => {const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
        return { viewport:{w:innerWidth,h:innerHeight}, documentWidth:document.documentElement.scrollWidth,
          elements:selectors.flatMap(s=>[...document.querySelectorAll(s)].map(el=>({selector:s,text:el.innerText?.slice(0,90),...box(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,overflowX:getComputedStyle(el).overflowX,zIndex:getComputedStyle(el).zIndex,stack:document.elementsFromPoint(Math.min(innerWidth-1,Math.max(0,el.getBoundingClientRect().x+el.getBoundingClientRect().width/2)),Math.min(innerHeight-1,Math.max(0,el.getBoundingClientRect().y+el.getBoundingClientRect().height/2))).slice(0,5).map(x=>x.className)}))) };
      }, selectors);
      const step = async (label, fn) => {
        try { const data = await fn(); report.steps.push({label,ok:true,data}); }
        catch(e) { report.steps.push({label,ok:false,error:e.message.split('\n').slice(0,20).join('\n')}); }
        report.steps.at(-1).probe = await metrics(['.strip-search input','.pos-bill','.tp','.tp-table','.modal-backdrop','.modal .btn.full','.orders-main','.orders-table-wrap','.orders-table tbody tr','.stock-body','.stock-table','.admin-layout','.settings-layout']).catch(()=>null);
        await shot(label).catch(()=>{});
        fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(reports,null,2));
        console.log(id,label,report.steps.at(-1).ok ? 'PASS':'FAIL');
      };
      const bill = async () => { if (await page.locator('.pos-bill-bar').isVisible() && !(await page.locator('.pos-bill').evaluate(e=>e.classList.contains('open')))) { await page.locator('.pos-bill-bar').click(); await page.waitForTimeout(250); } };
      const closeBill = async () => { if(await page.locator('.pos-bill-bar').isVisible() && await page.locator('.pos-bill.open').count()) await page.getByRole('button',{name:'Đóng hoá đơn',exact:true}).click(); };
      const home = async () => { await page.goto(root+'/pos/'); await page.locator('.pos-grid').waitFor(); await page.waitForTimeout(350); };
      await home();
      await step('light-theme', async()=>{
        const colors=await page.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,bg:getComputedStyle(document.body).backgroundColor}));
        const rgb=colors.bg.match(/\d+/g)?.slice(0,3).map(Number)||[];
        if(colors.scheme.includes('dark')||rgb.length<3||rgb.reduce((a,b)=>a+b,0)<600)throw Error('Dark appearance: '+JSON.stringify(colors));
        return colors;
      });
      await step('menu',async()=>metrics(['.strip','.strip-search','.strip-right','.pos-grid','.pos-cats','.pos-bill-bar','.pos-tile:first-child']));
      await step('categories',async()=>{
        const data=[];
        for(const cat of ['Đồ ăn','Đồ ăn kèm','Đồ uống','Mang về']) {
          await page.locator('.pos-cats').getByRole('tab',{name:cat,exact:true}).click();
          await page.locator('button.pos-tile').last().scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await page.locator('.pos-tile').first().scrollIntoViewIfNeeded();
          data.push({cat,count:await page.locator('button.pos-tile').count(),missing:await page.locator('.pos-letter').count()});
        }
        await page.locator('.pos-cats').getByRole('tab',{name:'Đồ ăn',exact:true}).click();
        return data;
      });
      await step('search',async()=>{
        const input=page.getByPlaceholder('Tìm món…'); await input.fill('ca kho');
        const names=await page.locator('.pos-name').allTextContents();
        if(!names.length || names.some(n=>!n.toLowerCase().includes('cá kho'))) throw Error('Search mismatch: '+names.join(','));
        await input.fill(''); return names;
      });
      await step('category-more-pinned',async()=>{
        if(width>600)return {applicable:false};
        await page.locator('.pos-cats').evaluate(e=>e.scrollLeft=e.scrollWidth);
        const rect=await page.locator('.pos-cat.more').boundingBox();
        if(rect.x<0||rect.x+rect.width>width)throw Error('More menu outside screen after category scroll');
        await page.locator('.pos-cat.more').click();
        await page.getByRole('menuitem',{name:'Hoạt động',exact:true}).waitFor();
        await home();return rect;
      });
      // A failed search must not prevent testing the rest of the sale flow.
      await home();
      await step('cart',async()=>{
        await page.locator('button.pos-tile').first().click(); await bill();
        await page.getByRole('button',{name:'Tăng',exact:true}).first().click();
        await page.getByRole('button',{name:'Giảm',exact:true}).first().click();
        const layout=await metrics(['.pos-bill','.pos-lines','.pos-actions','.pos-table-btn']);
        if(layout.elements.find(e=>e.selector==='.pos-lines').h<90)throw Error('Cart list too short: '+JSON.stringify(layout));
        return {lines:await page.locator('.pos-line').count(),layout};
      });
      await step('tables-from-bill',async()=>{
        await bill(); await page.locator('.pos-table-btn').click();
        const pick=page.getByRole('dialog',{name:'Chọn bàn',exact:true}); await pick.waitFor();
        const layout=await metrics(['.tp','.tp-head','.tp-grid']);
        await page.locator('.tp-table.free').first().click();
        return {layout,table:await page.locator('.pos-table-btn').innerText()};
      });
      // Recover from a covered table picker before independent modal tests.
      await home();
      await step('discount',async()=>{
        await bill(); await page.getByRole('button',{name:/^Giảm giá/}).click();
        await page.getByRole('button',{name:'10%',exact:true}).click();
        await page.getByRole('button',{name:'Áp dụng',exact:true}).click();
        return page.locator('.pos-total').innerText();
      });
      await step('payment-dialog',async()=>{
        await bill(); await page.getByRole('button',{name:'THANH TOÁN',exact:true}).click();
        const layout=await metrics(['.modal','.payment-modal','.payment-controls','.modal .btn.full']);
        await page.locator('.modal').getByRole('button',{name:'Chuyển khoản',exact:true}).click();
        await page.locator('.modal').getByRole('button',{name:'Tiền mặt',exact:true}).click();
        await page.locator('.modal').getByRole('button',{name:'Đóng',exact:true}).click();
        return layout;
      });
      await home();
      await step('save-resume',async()=>{
        await bill(); await page.locator('.pos-switch input').check({force:true});
        await page.getByPlaceholder('Ghi chú hoá đơn…').fill(`AUDIT ${id}`);
        await page.getByRole('button',{name:'Lưu đơn',exact:true}).click();
        await closeBill();
        await page.locator('.pos-cat.tables').click();
        await page.locator('.tp-bill').filter({hasText:`AUDIT ${id}`}).click();
        await bill();
        return {lines:await page.locator('.pos-line').count(),badge:await page.locator('.pos-bill-badge').innerText()};
      });
      await home();
      await step('checkout',async()=>{
        await bill();
        if(!(await page.locator('.pos-line').count())) {await closeBill();await page.locator('button.pos-tile').first().click();await bill();}
        await page.getByRole('button',{name:'THANH TOÁN',exact:true}).click();
        await page.locator('.modal').getByRole('button',{name:'Hoàn tất',exact:true}).click();
        await page.getByRole('button',{name:'Đơn mới',exact:true}).waitFor();
        await page.getByRole('button',{name:'Đơn mới',exact:true}).click();
        await page.waitForTimeout(700);
        const persisted=db.prepare('SELECT COUNT(*) AS n FROM orders WHERE device_id = ?').get(deviceId).n;
        if(persisted!==1)throw Error('Expected exactly one synced order, got '+persisted);
        return {persisted};
      });
      for(const screen of ['Hoạt động','Báo cáo','Hàng tồn','Nhân viên & thực đơn','Két tiền','Cài đặt']) {
        await home();
        await step('screen-'+['Hoạt động','Báo cáo','Hàng tồn','Nhân viên & thực đơn','Két tiền','Cài đặt'].indexOf(screen),async()=>{
          await page.locator('.pos-cat.more').click();
          await page.getByRole('menuitem',{name:screen,exact:true}).click(); await page.waitForTimeout(400);
          if(screen==='Hoạt động') {
            const table=page.locator('.orders-table-wrap');
            if((await table.boundingBox()).height<150)throw Error('Order list height <150px');
            await page.locator('.orders-table tbody tr').first().click();
            await page.locator('.order-pane').waitFor();
          }
          if(screen==='Báo cáo') {
            const hour=await page.evaluate(()=>new Date().getHours());
            await page.locator('.hour-bars').waitFor();
            if(!(await page.locator('.hour-bars small').allTextContents()).includes(hour+'h'))throw Error('Sales hour missing from chart: '+hour);
          }
          if(width<=600){
            const header=await page.locator('.strip-back').evaluate(e=>({whiteSpace:getComputedStyle(e).whiteSpace}));
            if(header.whiteSpace!=='nowrap')throw Error('Back button can wrap');
          }
          return {screen,layout:await metrics(['.strip','.app-main','.settings-layout','.stock-layout','.orders-wide','.shift-wide','.more-menu'])};
        });
      }
      await context.close();
      const shiftReport=await api(`/shifts/${shift.id}/report`);
      await api(`/shifts/${shift.id}/close`,{countedCash:shiftReport.shift.expectedCash,note:'Isolated audit finished'});
    }
  } finally {
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(reports,null,2));
    if(reports.some(r=>r.errors.length||r.badRequests.length||r.steps.some(s=>!s.ok)))process.exitCode=1;
    await browser.close();
    await new Promise(r=>server.close(r)); db.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
