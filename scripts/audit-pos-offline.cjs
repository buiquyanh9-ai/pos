const { chromium } = require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const { openDb } = await import('../apps/server/src/db.ts');
  const { seedIfEmpty } = await import('../apps/server/src/seed.ts');
  const { importMenu } = await import('../apps/server/src/menu.ts');
  const { createApp } = await import('../apps/server/src/app.ts');
  const db = openDb(':memory:'); seedIfEmpty(db);
  importMenu(db, fs.readFileSync('../product/z.product','utf8'));
  const server = createApp({db}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  const root = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'chu',password:'chu123456'})});
  const session = await login.json();
  const api = async (url,body) => {
    const r=await fetch(root+'/api'+url,{method:body?'POST':'GET',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const data=await r.json(); if(!r.ok)throw Error(JSON.stringify(data));return data;
  };
  const shift=await api('/shifts/open',{deviceId:'audit-offline',openingCash:500000});
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const output=path.resolve('output/pos-offline');fs.mkdirSync(output,{recursive:true});
  const result={steps:[],errors:[]};
  try {
    const context=await browser.newContext({viewport:{width:1366,height:768}});
    await context.addInitScript(({root,session,shift})=>{
      localStorage.setItem('shopflow.session',JSON.stringify(session));
      localStorage.setItem('shopflow.settings',JSON.stringify({backendUrl:root,deviceId:'audit-offline',hardware:{printer:'mock',drawer:'mock'}}));
      localStorage.setItem('shopflow.shift',JSON.stringify(shift));
    },{root,session,shift});
    const p=await context.newPage();p.setDefaultTimeout(6000);
    p.on('pageerror',e=>result.errors.push(e.message));
    await p.goto(root+'/pos/'); await p.locator('button.pos-tile').first().waitFor();
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('shopflow.catalog')||'null')?.products?.length>0);
    await context.setOffline(true);
    await p.locator('button.pos-tile').first().click();
    await p.getByRole('button',{name:'THANH TOÁN',exact:true}).click();
    await p.locator('.modal').getByRole('button',{name:'Hoàn tất',exact:true}).click();
    await p.getByRole('button',{name:'Đơn mới',exact:true}).waitFor();
    await p.getByRole('button',{name:'Đơn mới',exact:true}).click();
    const local=await p.evaluate(()=>JSON.parse(localStorage.getItem('shopflow.orders')));
    assert.equal(local.length,1);assert.equal(local[0].sync,'pending');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,0);
    result.steps.push({name:'offline-sale',ok:true,pending:1,serverOrders:0});
    await p.screenshot({path:path.join(output,'offline-sale.png')});
    await context.setOffline(false);
    await p.evaluate(()=>window.dispatchEvent(new Event('online')));
    await p.waitForFunction(()=>JSON.parse(localStorage.getItem('shopflow.orders')||'[]')[0]?.sync==='synced');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
    // Repeated reconnects must not duplicate the order.
    await p.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('online'));});
    await p.waitForTimeout(750);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
    result.steps.push({name:'reconnect-idempotent',ok:true,serverOrders:1});
    await p.screenshot({path:path.join(output,'reconnected.png')});
    const order=db.prepare('SELECT * FROM orders').get();
    await api(`/orders/${order.id}/refund`,{reason:'AUDIT refund',shiftId:shift.id});
    const report=await api(`/shifts/${shift.id}/report`);
    assert.equal(report.shift.expectedCash,500000);
    const closed=await api(`/shifts/${shift.id}/close`,{countedCash:500000,note:'AUDIT isolated close'});
    assert.equal(closed.shift.cashDifference,0);
    assert.equal(closed.shift.status,'closed');
    result.steps.push({name:'refund-close-shift-api',ok:true,expectedCash:500000,cashDifference:0});
    await context.close();
  } catch(e) {result.steps.push({name:'failure',ok:false,error:e.stack});process.exitCode=1;}
  finally {fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));await browser.close();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
