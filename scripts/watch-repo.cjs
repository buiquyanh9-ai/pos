// Local 20-minute QA watcher. All browser audits use isolated in-memory databases.
// Stop gracefully by creating output/repo-watch/STOP. No code fixes, Git writes or deployments.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'), workspace=path.dirname(repo);
const dir=path.join(repo,'output','repo-watch');fs.mkdirSync(dir,{recursive:true});
const stateFile=path.join(dir,'state.json'),lock=path.join(dir,'running.pid'),stop=path.join(dir,'STOP');
const stamp=()=>new Date().toLocaleString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).replace(' ','T');
const append=(file,text)=>fs.appendFileSync(path.join(workspace,file),`\n[${stamp()}] Codex QA tự động: ${text}\n`,'utf8');
function files(folder){if(!fs.existsSync(folder))return[];return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(folder,e.name)):[path.join(folder,e.name)]);}
const inputs=()=>[
 ...['apps/pos/src','apps/pos/test','apps/boss/src','apps/boss/test','apps/server/src','apps/server/test','packages/shared/src'].flatMap(d=>files(path.join(repo,d))),
 ...['package.json','package-lock.json','apps/pos/package.json','apps/boss/package.json','apps/server/package.json'].map(p=>path.join(repo,p)),path.join(workspace,'product','z.product')
].filter(p=>fs.existsSync(p)).sort();
function snapshot(){
 const source=inputs();const hash=crypto.createHash('sha256');for(const file of source)hash.update(path.relative(repo,file)).update(fs.readFileSync(file));
 const builds=['pos','boss'].map(app=>{
   const index=path.join(repo,'apps',app,'dist','index.html');const built=fs.existsSync(index)?fs.statSync(index).mtimeMs:0;
   const relevant=[...files(path.join(repo,'apps',app,'src')),...files(path.join(repo,'packages','shared','src'))];
   const latest=Math.max(0,...relevant.map(f=>fs.statSync(f).mtimeMs));
   const distHash=crypto.createHash('sha256');for(const f of files(path.join(repo,'apps',app,'dist')))distHash.update(fs.readFileSync(f));
   return{app,fresh:built>=latest,hash:distHash.digest('hex')};
 });
 const git=spawnSync('git',['-c',`safe.directory=${repo.replaceAll('\\','/')}`,'status','--short'],{cwd:repo,encoding:'utf8',windowsHide:true});
 return{sourceHash:hash.digest('hex'),builds,status:git.stdout||git.stderr||''};
}
function run(name,exe,args,env={}){
 const log=path.join(dir,`${stamp().replaceAll(':','-')}-${name}.log`),fd=fs.openSync(log,'w');
 let r;try{r=spawnSync(exe,args,{cwd:repo,env:{...process.env,...env},stdio:['ignore',fd,fd],timeout:300000,windowsHide:true});}finally{fs.closeSync(fd);}
 return{name,ok:r.status===0,status:r.status,error:r.error?.message,log:path.relative(workspace,log)};
}
function cycle(snapshotOnly=false){
 const before=snapshot();let previous={};try{previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{}
 fs.writeFileSync(path.join(dir,'latest-git-status.txt'),before.status);
 const chat=fs.readFileSync(path.join(workspace,'z_chat'),'utf8');
 const claude=chat.split(/(?=\[\d{4}-\d{2}-\d{2}T)/).filter(x=>/^\[[^\]]+\] Claude:/.test(x)).at(-1)||'';
 const claudeHash=crypto.createHash('sha256').update(claude).digest('hex');
 if(claude&&claudeHash!==previous.claudeHash){
   fs.writeFileSync(path.join(dir,'latest-claude-request.json'),JSON.stringify({seenAt:stamp(),hash:claudeHash,status:'NEEDS_CODEX_REVIEW',message:claude,note:'Only read and queued; no claim that the requested work is complete.'},null,2));
   append('z_log','ĐÃ ĐỌC TIN CLAUDE MỚI; chờ Codex xem/xử lý nếu chưa có kết quả. Nội dung lưu output/repo-watch/latest-claude-request.json. '+claude.slice(0,5000));
 }
 const changed=before.sourceHash!==previous.testedSource||JSON.stringify(before.builds)!==JSON.stringify(previous.testedBuilds);
 const results=[];let note='';
 if(snapshotOnly)note='Đã chụp trạng thái ban đầu; chưa chạy lại bộ test trong snapshot này.';
 else if(!changed)note='Không có thay đổi source/bản build so với vòng kiểm tra trước; không lặp lại test.';
 else{
   append('z_log','Bắt đầu vòng kiểm tra: có thay đổi repo hoặc chưa có kết quả nền. POS ưu tiên laptop + kiểm tra điện thoại, Boss ưu tiên mobile; luôn sáng; DB thử riêng.');
   const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
   results.push(run('typecheck',process.execPath,[npm,'run','typecheck']));
   results.push(run('tests',process.execPath,[npm,'test']));
   const tag=stamp().replaceAll(':','-');
   if(before.builds.find(b=>b.app==='pos').fresh){
     results.push(run('pos-ui',process.execPath,['scripts/audit-pos.cjs'],{AUDIT_OUT:`output/repo-watch/${tag}-pos`,AUDIT_SIZE:''}));
     results.push(run('pos-offline',process.execPath,['scripts/audit-pos-offline.cjs']));
   }else note+=' POS dist cũ hơn source: bỏ qua browser POS, nhờ Claude build; không kiểm tra nhầm bản cũ.';
   if(before.builds.find(b=>b.app==='boss').fresh)results.push(run('boss-mobile',process.execPath,['scripts/audit-boss-mobile.cjs'],{BOSS_AUDIT_OUT:`output/repo-watch/${tag}-boss`}));
   else note+=' Boss dist cũ hơn source: bỏ qua browser Boss, nhờ Claude build.';
 }
 const after=snapshot();const stable=before.sourceHash===after.sourceHash&&JSON.stringify(before.builds)===JSON.stringify(after.builds);
 if(!stable)note+=' Source/build thay đổi trong lúc kiểm tra: chưa kết luận trên bản mới nhất.';
 const summary=results.map(r=>`${r.name}: ${r.ok?'PASS':'FAIL/chưa hoàn tất'} (${r.log})`).join('; ');
 const message=`Repo ${before.sourceHash.slice(0,12)}; ${summary||'snapshot/không có test mới'}. ${note} Kết quả máy kiểm tra, chưa thay thế review của Codex/Claude. Lần tiếp theo sau tối đa 20 phút từ mốc vòng kiểm tra, nếu máy còn chạy.`;
 append('z_log',message);
 if(results.length||claudeHash!==previous.claudeHash)append('z_chat',message+' Giữ phân công: Claude sửa source POS; Codex QA tự động chỉ chạy scripts/test và ghi log, không tự sửa/đánh dấu bug đã hết.');
 const failed=results.filter(r=>!r.ok);
 const signature=crypto.createHash('sha256').update(before.sourceHash+JSON.stringify(before.builds)+failed.map(x=>x.name).join(',')).digest('hex');
 if(failed.length&&signature!==previous.failureSignature){
   append('z_bug',`[QA-AUTO][CẦN CLAUDE/CODEX XÁC MINH] ${failed.map(x=>`${x.name} chưa đạt, xem ${x.log}`).join('; ')}. Repo ${before.sourceHash.slice(0,12)}. Chưa gán mã lỗi mới/chưa khẳng định đây là bug sản phẩm: có thể là lỗi kịch bản/môi trường. Không đổi trạng thái các bug đã ghi.`);
 }
 const state={...previous,lastCycle:stamp(),pid:process.pid,intervalMinutes:20,claudeHash,sourceHash:before.sourceHash,results,note,stable};
 if(!snapshotOnly&&changed&&stable){state.testedSource=before.sourceHash;state.testedBuilds=before.builds;state.failureSignature=signature;}
 fs.writeFileSync(stateFile,JSON.stringify(state,null,2));console.log(message);
}
function running(){try{const pid=Number(fs.readFileSync(lock,'utf8'));process.kill(pid,0);return true;}catch{return false;}}
if(process.argv.includes('--once')||process.argv.includes('--snapshot')){cycle(process.argv.includes('--snapshot'));}
else{
 if(running()){console.error('Watcher already running');process.exit(1);}
 if(fs.existsSync(stop)){console.error('STOP marker exists; remove it before restarting.');process.exit(1);}
 fs.writeFileSync(lock,String(process.pid));
 const interval=20*60*1000;
 const firstAt=Number(process.argv.find(a=>a.startsWith('--first-at='))?.split('=')[1]);
 const firstDelay=Number.isFinite(firstAt)&&firstAt>Date.now()?firstAt-Date.now():interval;
 append('z_log',`ĐÃ KHỞI ĐỘNG watcher PID ${process.pid}, chu kỳ 20 phút; lần đầu sau ${Math.ceil(firstDelay/60000)} phút. Dừng: tạo shopflow-pos/output/repo-watch/STOP. Chỉ kiểm tra và ghi log; không pull/reset/commit/push/deploy, không sửa source, không dùng DB cửa hàng. Không tự gọi AI hay đánh thức Claude; z_chat là kênh trao đổi kết quả tự động.`);
 let timer,firstTimer;
 const tick=()=>{
   if(fs.existsSync(stop)){clearInterval(timer);clearInterval(stopTimer);fs.unlinkSync(lock);append('z_log','Đã dừng watcher theo STOP marker.');return;}
   try{cycle();}catch(e){append('z_log','Vòng kiểm tra lỗi: '+e.message);}
 };
 firstTimer=setTimeout(()=>{tick();if(!fs.existsSync(stop))timer=setInterval(tick,interval);},firstDelay);
 const stopTimer=setInterval(()=>{
   if(fs.existsSync(stop)){clearTimeout(firstTimer);clearInterval(timer);clearInterval(stopTimer);if(fs.existsSync(lock))fs.unlinkSync(lock);append('z_log','Đã dừng watcher theo STOP marker.');}
 },10000);
}
