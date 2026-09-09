'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const chromium=process.env.CHROMIUM_EXECUTABLE;
if(!chromium)throw Error('Set CHROMIUM_EXECUTABLE to a Chromium executable');
for(const mode of ['classic','native'])test(mode+': actual browser reload retains local draft and rearms restored Session',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voxspark-page-reload-'));
 try{
 const runtime=fs.readFileSync(root+(mode==='classic'?'/public/voxspark-surface-host-runtime.js':'/frontend/native/voxspark-surface-host-runtime.mjs'),'utf8');
 const store=fs.readFileSync(root+'/public/draft-store.js','utf8');
 const page=`<!doctype html><meta charset="utf-8"><div id="messageInput" contenteditable="true"></div><pre id="result">PENDING</pre><script>${store}</script>${mode==='classic'?'<script>'+runtime+'</script>':''}<script type="module">
 ${mode==='native'?`await import('data:text/javascript;base64,${Buffer.from(runtime).toString('base64')}');`:''}
 const $=id=>document.getElementById(id),input=$('messageInput'),check=(x,m)=>{if(!x)throw Error(m);};
 try{
 const store=CodexDraftStore.createDraftStore({storage:localStorage}),key=store.keyForThread('fixture-session');
 const restored=localStorage.getItem('reload-stage')==='1';let session='fixture-session';
 if(restored){check(store.getTargetKey()===key,'lost target');input.textContent=store.readMap()[key]?.text||'';}
 const replies=[];const host=CodexVoxSparkSurfaceHostRuntime.createVoxSparkSurfaceHostRuntime({document,window,$,clientId:restored?'after-reload':'before-reload',bridgeUrl:'ws://127.0.0.1:8790/host',currentComposerThreadId:()=>session,composerTargetThread:()=>({id:session,name:session}),composerText:()=>input.textContent,setComposerText:t=>input.textContent=t,relay:async p=>{replies.push(p);return {ok:true,connected:true,commands:[],service_epoch:'fixture-service'};}});
 host.start();
 // A classic script can run before Chromium grants the reloaded document focus.
 // Observe the ordinary focus event/500 ms relay rather than asserting after two microtasks.
 if(restored){for(let attempt=0;attempt<25&&!replies.some(p=>p.context.session.id===session&&p.context.composer.focused);attempt++)await new Promise(resolve=>setTimeout(resolve,50));}

 if(!restored){input.textContent='Manual draft + synthetic voice';store.writeMap({[key]:{text:input.textContent,updatedAt:Date.now()}});store.setTargetKey(key);localStorage.setItem('reload-stage','1');host.stop();location.reload();}
 else{check(input.textContent==='Manual draft + synthetic voice','draft lost on reload');check(document.activeElement!==input,'test unexpectedly focused composer');check(replies.some(p=>p.context.session.id===session&&p.context.composer.focused),'restored target not armed');host.stop();$('result').textContent='PASS real reload, browser-local draft persistence, restored target armed without focus';}
 }catch(e){$('result').textContent='FAIL '+e.message;}
 </script>`;
 const file=path.join(dir,'fixture.html');fs.writeFileSync(file,page);
 const output=execFileSync(chromium,['--no-sandbox','--disable-gpu','--user-data-dir='+path.join(dir,'profile'),'--dump-dom','--timeout=5000','--virtual-time-budget=2000',pathToFileURL(file).href],{encoding:'utf8',timeout:12000,maxBuffer:2e6,stdio:['ignore','pipe','pipe']});
 const result=output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];assert.ok(result?.startsWith('PASS'),result||'missing result');console.log(result);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
