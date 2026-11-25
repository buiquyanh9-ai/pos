const { chromium } = require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
 const {openDb,setSetting}=await import('../apps/server/src/db.ts');
 const {seedIfEmpty}=await import('../apps/server/src/seed.ts');
 const {createApp}=await import('../apps/server/src/app.ts');
 const db=openDb(':memory:'); seedIfEmpty(db); setSetting(db,'store_name','Cửa hàng mẫu ShopFlow');
 const server=createApp({db}).listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 const root=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext({viewport:{width:1366,height:768},deviceScaleFactor:2,colorScheme:'light',timezoneId:'Asia/Ho_Chi_Minh',reducedMotion:'reduce'});
  await context.addInitScript(root=>localStorage.setItem('shopflow.settings',JSON.stringify({backendUrl:root,deviceId:'report-login'})),root);
  const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+'/pos/');await page.locator('.staff').first().waitFor();await page.waitForTimeout(1800);
  // Settle decorative entrance animations without changing the application layout.
  await page.evaluate(()=>document.getAnimations().forEach(a=>{if(a.effect?.getTiming().iterations!==Infinity)try{a.finish()}catch{}}));
  const out=path.resolve('output/report-screens');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'pos-login-staff.png'),animations:'disabled'});
  await page.locator('.staff').filter({hasText:'Hiền'}).click();await page.locator('.pinpad').waitFor();await page.waitForTimeout(800);
  await page.screenshot({path:path.join(out,'pos-login-pin.png'),animations:'disabled'});
  fs.writeFileSync(path.join(out,'login-capture.json'),JSON.stringify({viewport:{width:1366,height:768},deviceScaleFactor:2,fixture:'isolated SQLite :memory:, sample staff; no PIN entered',errors},null,2));
  console.log('Captured staff picker and actual PIN entry at 2x; errors:',errors);
 } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
