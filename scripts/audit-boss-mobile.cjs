const { chromium } = require('C:/Users/Gigabyte/AppData/Local/uv/cache/archive-v0/roZSF26akPqd4dAl/Lib/site-packages/playwright/driver/package');
const fs=require('node:fs');const path=require('node:path');
const out=path.resolve(process.env.BOSS_AUDIT_OUT||'output/boss-audit');fs.mkdirSync(out,{recursive:true});
(async()=>{
  const {openDb}=await import('../apps/server/src/db.ts');
  const {seedIfEmpty}=await import('../apps/server/src/seed.ts');
  const {importMenu}=await import('../apps/server/src/menu.ts');
  const {createApp}=await import('../apps/server/src/app.ts');
  const db=openDb(':memory:');seedIfEmpty(db);importMenu(db,fs.readFileSync('../product/z.product','utf8'),{sampleStock:true});
  const server=createApp({db}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const root=`http://127.0.0.1:${server.address().port}`;
  const session=await(await fetch(root+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'chu',password:'chu123456'})})).json();
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const reports=[];
  try {
    for(const width of [360,390,430])for(const colorScheme of ['light','dark']) {
      const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,colorScheme});
      await context.addInitScript(({root,session})=>{
        localStorage.setItem('shopflow.boss.session',JSON.stringify(session));localStorage.setItem('shopflow.boss.url',JSON.stringify(root));localStorage.setItem('shopflow.boss.installHint','hidden');
      },{root,session});
      const p=await context.newPage();p.setDefaultTimeout(4000);
      const errors=[];p.on('pageerror',e=>errors.push(e.message));
      await p.goto(root+'/boss/');await p.locator('.tabbar').waitFor();
      for(const [index,tab]of ['Tổng quan','Báo cáo','Hoạt động','Kho','Thêm'].entries()) {
        const record={width,colorScheme,tab,issues:[],errors};reports.push(record);
        try {
          await p.locator('.tabbar .tab').nth(index).click();await p.waitForTimeout(200);
          if(tab==='Kho')await p.locator('.segmented').getByRole('tab',{name:'Nhập hàng',exact:true}).click();
          record.metrics=await p.evaluate(()=>{
            const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom};};
            return{viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,scheme:getComputedStyle(document.documentElement).colorScheme,bg:getComputedStyle(document.body).backgroundColor,nav:rect(document.querySelector('.tabbar')),chips:[...document.querySelectorAll('.chips')].map(rect),seg:[...document.querySelectorAll('.seg.on')].map(e=>({text:e.textContent,color:getComputedStyle(e).color,whiteSpace:getComputedStyle(e).whiteSpace}))};
          });
          const m=record.metrics;const rgb=m.bg.match(/\d+/g).slice(0,3).map(Number);
          if(m.scheme.includes('dark')||rgb.reduce((a,b)=>a+b,0)<600)record.issues.push('Light-only requirement violated: '+m.bg+' / '+m.scheme);
          if(m.scrollWidth>width)record.issues.push('Horizontal page overflow');
          if(m.nav.bottom>845)record.issues.push('Navigation outside viewport');
          if(m.chips.some(r=>r.h<38))record.issues.push('Filter rows squeezed');
          if(tab==='Kho'&&m.seg.some(s=>s.color!=='rgb(255, 255, 255)'||s.whiteSpace!=='nowrap'))record.issues.push('Purchase tab text color/wrapping');
          record.screenshot=`${width}-${colorScheme}-${index}.png`;
          await p.screenshot({path:path.join(out,record.screenshot)});
        }catch(e){record.issues.push(e.message);}
        console.log(width,colorScheme,tab,record.issues.length?'FAIL':'PASS');
        fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(reports,null,2));
      }
      await context.close();
    }
  }finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(reports,null,2));await browser.close();await new Promise(r=>server.close(r));db.close();}
  if(reports.some(r=>r.issues.length||r.errors.length))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
