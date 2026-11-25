const {chromium}=require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const {openDb,setSetting}=await import('../apps/server/src/db.ts');
 const {seedIfEmpty,seedDemoSales}=await import('../apps/server/src/seed.ts');
 const {createApp}=await import('../apps/server/src/app.ts');
 const {importMenu}=await import('../apps/server/src/menu.ts');
 const db=openDb(':memory:');seedIfEmpty(db);importMenu(db,fs.readFileSync('../product/z.product','utf8'));seedDemoSales(db);setSetting(db,'store_name','Cửa hàng mẫu ShopFlow');
 const server=createApp({db}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}`;
 const login=async username=>{const r=await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:username==='chu'?'chu123456':'thungan123'})});if(!r.ok)throw Error(await r.text());return r.json()};
 const owner=await login('chu'),cashier=await login('thungan');
 const item=db.prepare('SELECT id,unit_cost FROM inventory_items ORDER BY name LIMIT 1').get();
 const supplier=db.prepare('SELECT id FROM suppliers LIMIT 1').get();
 const res=await fetch(root+'/api/purchases',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${cashier.token}`},body:JSON.stringify({supplierId:supplier?.id,note:'[MẪU] Đề xuất nhập nguyên liệu phục vụ ca tiếp theo',lines:[{itemId:item.id,qty:20,unitCost:25000}]})});
 if(!res.ok)throw Error(await res.text());const purchase=await res.json();
 const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const out=path.resolve('output/report-screens');fs.mkdirSync(out,{recursive:true});
 try{
  const ctx=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:2,isMobile:true,hasTouch:true,timezoneId:'Asia/Ho_Chi_Minh',colorScheme:'light',reducedMotion:'reduce'});
  await ctx.addInitScript(({root,owner})=>{localStorage.setItem('shopflow.boss.url',JSON.stringify(root));localStorage.setItem('shopflow.boss.session',JSON.stringify(owner));localStorage.setItem('shopflow.boss.installHint','hidden')},{root,owner});
  const p=await ctx.newPage();p.setDefaultTimeout(10000);await p.goto(root+'/boss/');await p.locator('.tabbar').waitFor();
  await p.locator('.tabbar .tab').nth(1).click();await p.getByRole('button',{name:/Doanh thu tổng quan/}).click();await p.waitForTimeout(600);
  fs.writeFileSync(path.join(out,'report-buttons.txt'),await p.locator('button').allTextContents().then(x=>x.join('\n')));
  await p.getByRole('button',{name:/Tuỳ|Tùy|Tùy chọn|Tuỳ chọn|Tùy chỉnh|Tuỳ chỉnh/}).first().click();
  await p.getByRole('button',{name:'Xem báo cáo',exact:true}).waitFor();
  const values=await p.locator('input').evaluateAll(es=>es.map(e=>({type:e.type,value:e.value})));
  await p.screenshot({path:path.join(out,'boss-reports-custom-time.png'),animations:'disabled'});
  await p.getByRole('button',{name:'Xem báo cáo',exact:true}).click();await p.waitForTimeout(500);
  await p.setViewportSize({width:480,height:1000});
  await p.locator('.tabbar .tab').nth(3).click();await p.locator('.segmented').getByRole('tab',{name:'Nhập hàng',exact:true}).click();await p.locator('.order-row').first().click();
  await p.getByRole('button',{name:'Duyệt nhập hàng',exact:true}).waitFor();await p.waitForTimeout(300);
  await p.screenshot({path:path.join(out,'boss-purchase-pending-detail.png'),animations:'disabled'});
  await p.getByRole('button',{name:'Đóng',exact:true}).click();await p.setViewportSize({width:430,height:932});
  await p.locator('.tabbar .tab').nth(4).click();await p.getByRole('button',{name:/Thông báo/}).first().click();
  await p.locator('.notif').first().waitFor();await p.waitForTimeout(300);
  await p.screenshot({path:path.join(out,'boss-notifications-populated.png'),animations:'disabled'});
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({fixture:'isolated in-memory DB; 14-day sample sales; pending purchase created by cashier through API; not approved',purchaseId:purchase.id,customRangeInputs:values,customViewport:[430,932],purchaseViewport:[480,1000],deviceScaleFactor:2},null,2));
  console.log('Captured custom time picker and actual pending purchase with approval buttons');
 }finally{await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}
})().catch(e=>{console.error(e);process.exit(1)});
