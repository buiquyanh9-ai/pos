const {chromium}=require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('output/user-screens');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {openDb,setSetting}=await import('../apps/server/src/db.ts');
 const {seedIfEmpty}=await import('../apps/server/src/seed.ts');
 const {importMenu}=await import('../apps/server/src/menu.ts');
 const {createApp}=await import('../apps/server/src/app.ts');
 const db=openDb(':memory:');seedIfEmpty(db);importMenu(db,fs.readFileSync('../product/z.product','utf8'));
 for(const [key,value]of Object.entries({store_name:'Cửa hàng mẫu ShopFlow',bank_bin:'970436',bank_name:'Vietcombank',bank_account:'0000000000',bank_holder:'TAI KHOAN THU NGHIEM'}))setSetting(db,key,value);
 const server=createApp({db}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const root=`http://127.0.0.1:${server.address().port}`;
 const session=await(await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'chu',password:'chu123456'})})).json();
 const api=async(url,body)=>{const r=await fetch(root+'/api'+url,{method:body?'POST':'GET',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(url+' '+r.status+' '+JSON.stringify(data));return data;};
 const shift=await api('/shifts/open',{deviceId:'user-screens',openingCash:500000});
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
 for(const [i,productId,price,hour,method]of [[1,'p-com-trang-suon',50000,2,'cash'],[2,'p-com-dao-ga',55000,3,'cash'],[3,'p-com-trang-ca-kho',50000,3,'transfer']])await api('/orders',{id:`screens-${i}`,number:`MAU-${i}`,deviceId:'user-screens',shiftId:shift.id,createdAt:new Date(`${today}T0${hour}:15:00+07:00`).toISOString(),items:[{productId,name:db.prepare('SELECT name FROM products WHERE id=?').get(productId).name,price,qty:1}],paymentMethod:method,paid:price,orderType:'takeaway',note:'Dữ liệu thử chụp giao diện'});
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const shots=[],checks=[],errors=[];
 const check=async(name,fn)=>{try{const data=await fn();checks.push({name,ok:true,data});console.log('CHECK PASS',name);}catch(e){checks.push({name,ok:false,error:e.message});console.log('CHECK FAIL',name,e.message);}};
 async function light(page){const colors=await page.evaluate(()=>({scheme:getComputedStyle(document.documentElement).colorScheme,bg:getComputedStyle(document.body).backgroundColor}));assert(!colors.scheme.includes('dark'));assert(colors.bg.match(/\d+/g).slice(0,3).map(Number).reduce((a,b)=>a+b)>600);return colors;}
 async function shot(page,device,n,name,description){await page.waitForTimeout(200);await light(page);await page.screenshot({path:path.join(out,`${device}-${String(n).padStart(2,'0')}-${name}.png`)});shots.push({device,file:`${device}-${String(n).padStart(2,'0')}-${name}.png`,description});console.log('SHOT',shots.at(-1).file);}
 async function contextFor(width,height,app){const c=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,colorScheme:'dark',timezoneId:'Asia/Ho_Chi_Minh'});await c.addInitScript(({root,app})=>{if(app==='pos')localStorage.setItem('shopflow.settings',JSON.stringify({backendUrl:root,deviceId:'user-screens',hardware:{printer:'mock',drawer:'mock'}}));else{localStorage.setItem('shopflow.boss.url',JSON.stringify(root));localStorage.setItem('shopflow.boss.installHint','hidden');}},{root,app});return c;}
 async function posLogin(p){await p.locator('.staff').filter({hasText:'Hiền'}).click();for(let i=0;i<4;i++)await p.locator('.pinpad').getByRole('button',{name:'3',exact:true}).click();await p.locator('.pinpad').getByRole('button',{name:'OK',exact:true}).click();await p.locator('.pos-grid').waitFor();}
 async function home(p){await p.goto(root+'/pos/');await p.locator('.pos-grid').waitFor();await p.waitForTimeout(300);}
 async function menu(p,label){await p.locator('.pos-cat.more').click();await p.getByRole('menuitem',{name:label,exact:true}).click();await p.waitForTimeout(350);}
 async function bill(p){if(await p.locator('.pos-bill-bar').isVisible()&&!(await p.locator('.pos-bill').evaluate(e=>e.classList.contains('open')))){await p.locator('.pos-bill-bar').click();await p.waitForTimeout(250);}}
 try{
  for(const [width,height]of [[1366,768],[1920,1080]]){
   const device=`pos-laptop-${width}`;const c=await contextFor(width,height,'pos');const p=await c.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push({device,error:e.message}));
   await p.goto(root+'/pos/');await p.locator('.staff').first().waitFor();await shot(p,device,1,'login','Đăng nhập POS bằng PIN, hệ thống giả lập tối nhưng app sáng.');
   await posLogin(p);await p.locator('button.pos-tile').first().click();await p.locator('button.pos-tile').nth(2).click();await shot(p,device,2,'sale','Bán hàng với hai món trong hóa đơn.');
   await p.getByRole('button',{name:'THANH TOÁN',exact:true}).click();await shot(p,device,3,'payment-cash','Hộp thanh toán tiền mặt.');
   await p.locator('.modal').getByRole('button',{name:'Chuyển khoản',exact:true}).click();await p.locator('.vietqr-code svg').waitFor();await shot(p,device,4,'payment-qr','Chuyển khoản QR dùng tài khoản thử, không giao dịch thực.');
   await p.locator('.modal').getByRole('button',{name:'Đóng',exact:true}).click();await p.getByRole('button',{name:'Xoá',exact:true}).click();
   await menu(p,'Đăng xuất');await shot(p,device,5,'logout','Hộp hỏi đóng ca hay giữ ca khi đăng xuất.');await p.locator('.modal').getByRole('button',{name:'Huỷ',exact:true}).click();
   for(const [n,label,name]of [[6,'Két tiền','shift'],[7,'Báo cáo','reports'],[8,'Hàng tồn','stock'],[10,'Nhân viên & thực đơn','admin']]){await home(p);await menu(p,label);await shot(p,device,n,name,label+' trên laptop.');}
   await home(p);await menu(p,'Hoạt động');await p.locator('.orders-table tbody tr').first().click();await p.getByRole('button',{name:'Hoàn tiền',exact:true}).click();await p.getByPlaceholder('Lý do (bắt buộc)').fill('Món lỗi / không đạt');
   await p.getByRole('button',{name:'Xác nhận hoàn tiền',exact:true}).scrollIntoViewIfNeeded();
   await shot(p,device,9,'refund','Hoạt động và panel hoàn tiền; chưa xác nhận hoàn tiền.');
   if(width===1366)await check('POS-010',async()=>p.getByRole('button',{name:'Xác nhận hoàn tiền',exact:true}).evaluate(e=>{const css=getComputedStyle(e),r=e.getBoundingClientRect();if(css.whiteSpace!=='nowrap'||e.scrollWidth>e.clientWidth+1)throw Error('Refund text wrapping/clipped');return{whiteSpace:css.whiteSpace,width:r.width,height:r.height};}));
   await c.close();
  }
  {
   const device='pos-iphone-430';const c=await contextFor(430,932,'pos');const p=await c.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push({device,error:e.message}));await p.goto(root+'/pos/');await p.locator('.staff').first().waitFor();await posLogin(p);
   await p.locator('button.pos-tile').first().click();await shot(p,device,1,'sale','POS iPhone: bán hàng với món đã chọn.');await bill(p);await shot(p,device,2,'bill','POS iPhone: hóa đơn toàn màn hình.');
   await p.getByRole('button',{name:'THANH TOÁN',exact:true}).click();await shot(p,device,3,'payment','POS iPhone: hộp thanh toán nằm trên hóa đơn.');await p.locator('.modal').getByRole('button',{name:'Đóng',exact:true}).click();await p.getByRole('button',{name:'Đóng hoá đơn',exact:true}).click();
   await menu(p,'Két tiền');await shot(p,device,4,'shift','POS iPhone: két tiền và ca hiện tại.');await home(p);await menu(p,'Hàng tồn');await shot(p,device,5,'stock','POS iPhone: hàng tồn và các mục con.');await c.close();
  }
  {
   const device='boss-iphone-430';const c=await contextFor(430,932,'boss');const p=await c.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push({device,error:e.message}));await p.goto(root+'/boss/');await p.locator('.login-form').waitFor();await shot(p,device,1,'login','Boss iPhone: đăng nhập chủ cửa hàng.');
   await p.getByLabel('Tên đăng nhập').fill('chu');await p.getByLabel('Mật khẩu').fill('chu123456');await p.getByRole('button',{name:'Đăng nhập',exact:true}).click();await p.locator('.tabbar').waitFor();await p.locator('.hero strong').waitFor();
   for(const [i,tab]of ['Tổng quan','Báo cáo','Hoạt động','Kho','Thêm'].entries()){await p.locator('.tabbar .tab').nth(i).click();await p.waitForTimeout(400);if(tab==='Kho')await p.locator('.segmented').getByRole('tab',{name:'Nhập hàng',exact:true}).click();await shot(p,device,i+2,['home','reports','activity','purchases','more'][i],'Boss iPhone: '+tab);}
   await p.getByRole('button',{name:/Thông báo/}).first().click();await p.locator('.screen-head h1').filter({hasText:'Thông báo'}).waitFor();await shot(p,device,9,'notifications','Boss iPhone: Thêm > Thông báo.');
   await p.locator('.tabbar .tab').nth(3).click();await p.locator('.segmented').getByRole('tab',{name:'Tồn kho',exact:true}).click();await p.waitForTimeout(350);await shot(p,device,8,'stock','Boss iPhone: Kho > Tồn kho.');
   await p.locator('.tabbar .tab').nth(0).click();const chart=p.locator('figure.chart').first();await chart.waitFor();await chart.scrollIntoViewIfNeeded();await p.waitForTimeout(200);
   await check('BOSS-001',async()=>{const bars=await chart.locator('rect.bar').count();assert(bars>0,'No nonzero hourly bars despite 02/03h sales');const labels=await chart.locator('.chart-x').innerText();return{nonzeroBars:bars,labels};});await shot(p,device,10,'hourly-chart','Boss Tổng quan: cột doanh thu lúc 02h/03h với dữ liệu thử.');await c.close();
  }
  {
   const device='boss-iphone-360';const c=await contextFor(360,800,'boss');await c.addInitScript(s=>localStorage.setItem('shopflow.boss.session',JSON.stringify(s)),session);const p=await c.newPage();await p.goto(root+'/boss/');await p.locator('.tabbar').waitFor();await p.locator('.tabbar .tab').nth(2).click();
   const row=p.locator('.chips.scroll-x').first();await row.waitFor();await check('BOSS-002',async()=>{const mask=await row.evaluate(e=>getComputedStyle(e).maskImage);assert(mask&&mask!=='none','Missing right fade');await row.evaluate(e=>e.scrollLeft=e.scrollWidth);const target=row.getByRole('button',{name:'Giao hàng',exact:true});await target.click();assert((await target.getAttribute('class')).includes('on'));return{mask,scrollLeft:await row.evaluate(e=>e.scrollLeft),filter:'Giao hàng selected'};});await shot(p,device,1,'delivery-filter','Boss 360px: vuốt ngang tới Giao hàng, bộ lọc đã chọn.');await c.close();
  }
 }finally{
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({shots,checks,errors,environment:'Chrome emulated viewports and touch; isolated in-memory DB; OS dark, apps light'},null,2));
  const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const cards=shots.sort((a,b)=>a.device.localeCompare(b.device)||a.file.localeCompare(b.file)).map(s=>`<article><a href="${s.file}"><img loading="lazy" src="${s.file}" alt="${escape(s.description)}"></a><p><b>${escape(s.device)}</b> · ${escape(s.description)}</p><a href="${s.file}">${s.file}</a></article>`).join('\n');
  fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ảnh kiểm tra POS và Boss</title><style>body{font:16px/1.5 system-ui;margin:24px;background:#f4f8fc;color:#17324d}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}article{padding:12px;background:white;border:1px solid #d8e5f0;border-radius:12px}img{width:100%;max-height:560px;object-fit:contain;object-position:top}a{color:#2563eb}p{margin:8px 0}</style><h1>Ảnh kiểm tra POS và Boss</h1><p>${shots.length} ảnh chụp trình duyệt giả lập, dữ liệu thử riêng; không phải ảnh từ điện thoại thật. Mọi ảnh dùng hệ thống giả lập tối nhưng app luôn sáng. QR dùng tài khoản thử, không chuyển tiền.</p><main>${cards}</main></html>`);
  await browser.close();await new Promise(r=>server.close(r));db.close();
 }
 if(checks.some(c=>!c.ok)||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
