// Screenshots for the thesis (chapter 4) after the inventory module was removed.
// Isolated in-memory database with SAMPLE data only; QR uses a test bank account.
const {chromium}=require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve('output/thesis-screens');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {openDb,setSetting}=await import('../apps/server/src/db.ts');
 const {seedIfEmpty,seedDemoSales}=await import('../apps/server/src/seed.ts');
 const {importMenu}=await import('../apps/server/src/menu.ts');
 const {createApp}=await import('../apps/server/src/app.ts');
 const db=openDb(':memory:');seedIfEmpty(db);importMenu(db,fs.readFileSync('../product/z.product','utf8'));seedDemoSales(db);
 for(const [k,v]of Object.entries({store_name:'Cửa hàng mẫu ShopFlow',bank_bin:'970436',bank_name:'Vietcombank',bank_account:'0000000000',bank_holder:'TAI KHOAN THU NGHIEM'}))setSetting(db,k,v);
 const server=createApp({db}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}`;
 const login=async(username,password)=>{const r=await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});if(!r.ok)throw Error(await r.text());return r.json();};
 const owner=await login('chu','chu123456'),kim=await login('thungan','thungan123');
 const call=(s)=>async(url,body)=>{const r=await fetch(root+'/api'+url,{method:body?'POST':'GET',headers:{authorization:`Bearer ${s.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(url+' '+JSON.stringify(d));return d;};
 const asKim=call(kim),asOwner=call(owner);
 // Today: Kim's morning shift with cash and transfer sales, one refund and one void, then the shift is closed.
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
 const at=(h,m)=>new Date(`${today}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`).toISOString();
 const name=id=>db.prepare('SELECT name FROM products WHERE id=?').get(id).name;
 const shift=await asKim('/shifts/open',{deviceId:'quay-1',openingCash:500000});
 db.prepare('UPDATE shifts SET opened_at=? WHERE id=?').run(at(7,0),shift.id); // morning shift (sample)
 const sales=[[7,40,'p-com-trang-suon',50000,2,'cash'],[8,5,'p-com-dao-ga',55000,1,'transfer'],[9,20,'p-com-trang-ca-kho',50000,3,'cash'],[10,10,'p-com-trang-xa-xiu',50000,2,'transfer'],[11,35,'p-com-trang-bo',50000,2,'cash'],[11,50,'p-com-dao-suon',55000,1,'cash'],[12,15,'p-com-trang-ga',50000,2,'transfer']];
 let n=0;
 for(const [h,m,pid,price,qty,method]of sales){n++;const total=price*qty;await asKim('/orders',{id:`th-${n}`,number:`MAU-${100+n}`,deviceId:'quay-1',shiftId:shift.id,createdAt:at(h,m),items:[{productId:pid,name:name(pid),price,qty}],paymentMethod:method,paid:method==='cash'?Math.ceil(total/50000)*50000:total,orderType:n%3?'dine_in':'takeaway',tableName:n%3?`0${10+n}`:''});}
 await asKim('/orders/th-6/refund',{reason:'Món lỗi / không đạt',shiftId:shift.id});
 await asKim('/orders/th-3/void',{reason:'Nhập nhầm món'});
 const report=await asKim(`/shifts/${shift.id}/report`);
 await asKim(`/shifts/${shift.id}/close`,{countedCash:report.shift.expectedCash});
 db.prepare('UPDATE shifts SET closed_at=? WHERE id=?').run(at(13,0),shift.id);
 db.prepare("UPDATE notifications SET created_at=? WHERE type='shift.closed'").run(at(13,0));
 // Owner (Hiền) has her own open shift on the POS used for the POS screenshots.
 await asOwner('/shifts/open',{deviceId:'thesis-pos',openingCash:300000});
 await asOwner('/orders',{id:'th-hien-1',number:'MAU-201',deviceId:'thesis-pos',createdAt:at(13,5),items:[{productId:'p-com-trang-suon',name:name('p-com-trang-suon'),price:50000,qty:1}],paymentMethod:'cash',paid:50000});

 const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const shots=[];
 const shot=async(p,file)=>{await p.waitForTimeout(350);await p.screenshot({path:path.join(out,file),animations:'disabled'});shots.push(file);console.log('SHOT',file);};
 const posCtx=async(w,h)=>{const c=await b.newContext({viewport:{width:w,height:h},timezoneId:'Asia/Ho_Chi_Minh',colorScheme:'light'});await c.addInitScript(r=>localStorage.setItem('shopflow.settings',JSON.stringify({backendUrl:r,deviceId:'thesis-pos',hardware:{printer:'mock',drawer:'mock'}})),root);return c;};
 const bossCtx=async(dsf,session)=>{const c=await b.newContext({viewport:{width:430,height:932},deviceScaleFactor:dsf,isMobile:true,hasTouch:true,timezoneId:'Asia/Ho_Chi_Minh',colorScheme:'light',reducedMotion:'reduce'});await c.addInitScript(({root,session})=>{localStorage.setItem('shopflow.boss.url',JSON.stringify(root));localStorage.setItem('shopflow.boss.installHint','hidden');if(session)localStorage.setItem('shopflow.boss.session',JSON.stringify(session));},{root,session});return c;};
 const pin=async(p)=>{await p.locator('.staff').filter({hasText:'Hiền'}).click();for(let i=0;i<4;i++)await p.locator('.pinpad').getByRole('button',{name:'3',exact:true}).click();await p.locator('.pinpad').getByRole('button',{name:'OK',exact:true}).click();await p.locator('.pos-grid').waitFor();};
 const menu=async(p,label)=>{await p.locator('.pos-cat.more').click();await p.getByRole('menuitem',{name:label,exact:true}).click();await p.waitForTimeout(400);};
 try{
  { // POS login with the PIN pad, 1920x1080
   const c=await posCtx(1920,1080);const p=await c.newPage();await p.goto(root+'/pos/');await p.locator('.staff').first().waitFor();
   await p.locator('.staff').filter({hasText:'Hiền'}).click();for(let i=0;i<2;i++)await p.locator('.pinpad').getByRole('button',{name:'3',exact:true}).click();
   await shot(p,'pos-login-pin-1920.png');await c.close();
  }
  { // POS 1366x768: refund panel, owner back-office
   const c=await posCtx(1366,768);const p=await c.newPage();p.setDefaultTimeout(8000);await p.goto(root+'/pos/');await p.locator('.staff').first().waitFor();await pin(p);
   await menu(p,'Hoạt động');await p.locator('.orders-table tbody tr').first().click();await p.getByRole('button',{name:'Hoàn tiền',exact:true}).click();await p.getByPlaceholder('Lý do (bắt buộc)').fill('Món lỗi / không đạt');
   await shot(p,'pos-refund-1366.png');
   await p.goto(root+'/pos/');await p.locator('.pos-grid').waitFor();await menu(p,'Nhân viên & thực đơn');await shot(p,'pos-admin-1366.png');
   await p.goto(root+'/pos/');await p.locator('.pos-grid').waitFor();await menu(p,'Báo cáo');await shot(p,'pos-reports-1366.png');
   await c.close();
  }
  { // Boss login (1x)
   const c=await bossCtx(1);const p=await c.newPage();await p.goto(root+'/boss/');await p.locator('.login-form').waitFor();await shot(p,'boss-login.png');await c.close();
  }
  { // Boss home (1x) and the 2x screens
   const c1=await bossCtx(1,owner);const p1=await c1.newPage();await p1.goto(root+'/boss/');await p1.locator('.tabbar').waitFor();await p1.locator('.hero strong').waitFor();await shot(p1,'boss-home.png');await c1.close();
   const c=await bossCtx(2,owner);const p=await c.newPage();p.setDefaultTimeout(10000);await p.goto(root+'/boss/');await p.locator('.tabbar').waitFor();
   await p.locator('.tabbar .tab').nth(1).click();await p.getByRole('button',{name:/Doanh thu tổng quan/}).click();await p.waitForTimeout(500);
   await p.getByRole('button',{name:/Tuỳ|Tùy/}).first().click();await p.getByRole('button',{name:'Xem báo cáo',exact:true}).waitFor();await shot(p,'boss-report-custom.png');
   await p.getByRole('button',{name:'Xem báo cáo',exact:true}).click();await p.waitForTimeout(400);
   await p.locator('.tabbar .tab').nth(1).click();await p.waitForTimeout(300);
   const back=p.locator('.screen-head button').first();if(await back.isVisible().catch(()=>false))await back.click().catch(()=>{});
   await p.getByRole('button',{name:/Ca làm việc & đối soát tiền mặt/}).click();await p.waitForTimeout(600);await p.getByRole('button',{name:'Hôm nay',exact:true}).first().click();await p.waitForTimeout(600);await shot(p,'boss-shifts.png');
   await p.locator('.tabbar .tab').nth(2).click();await p.waitForTimeout(600);await shot(p,'boss-activity.png');
   await p.locator('.tabbar .tab').nth(3).click();await p.getByRole('button',{name:/Thông báo/}).first().click();await p.locator('.notif').first().waitFor();await shot(p,'boss-notifications.png');
   await c.close();
  }
 }finally{fs.writeFileSync(path.join(out,'shots.json'),JSON.stringify({shots,data:'isolated in-memory DB; SAMPLE data only; test bank account'},null,2));await b.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
