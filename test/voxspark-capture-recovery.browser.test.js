"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

for (const mode of ["classic", "native-esm"]) for (const theme of ["dark", "light"]) test(`${mode}/${theme}: failed recording recovery preserves drafts, ownership, expiry, duplicate requests and layout`, {
  skip: !process.env.CHROMIUM_EXECUTABLE,
}, () => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-recovery-browser-"));
  try {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const composer = html.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
    const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    const source = fs.readFileSync(path.join(root, mode === "classic" ? "public/voxspark-surface-host-runtime.js" : "frontend/native/voxspark-surface-host-runtime.mjs"), "utf8");
    const page = `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>${css}</style>
      <style>body{display:block;padding:8px}#fixture{width:340px;max-width:100%}#messageInput{outline:1px solid gray}</style>
      <div id="fixture">${composer}</div>
      <button data-thread="session-b">B</button><pre id="result">PENDING</pre>
      ${mode === "classic" ? `<script>${source}</script>` : ""}<script type="module">
      ${mode === "native-esm" ? `await import('data:text/javascript;base64,${Buffer.from(source).toString("base64")}');` : ""}
      try {
        const $=id=>document.getElementById(id), input=$('messageInput');
        input.contentEditable='true';input.textContent='保留的草稿';
        const check=(ok,message)=>{ if(!ok) throw Error(message); };
        Object.defineProperty(document,'hasFocus',{value:()=>true});
        let session='session-a', clock=1000, tick, online=true, held, release, epoch='bridge-c2';
        const requests=[]; let sends=0;
        let captures=[{capture_id:'failed-a',session_id:'session-a',state:'failed',duration_ms:2400,
          recovery:{revision:1,retryable:true,expires_at:901000}}];
        const runtime=CodexVoxSparkSurfaceHostRuntime.createVoxSparkSurfaceHostRuntime({document,window,$,clientId:'browser-a',
          bridgeUrl:'ws://127.0.0.1:8790/host',currentComposerThreadId:()=>session,
          composerTargetThread:()=>({id:session,name:session}),composerText:()=>input.textContent,
          now:()=>clock,setInterval:fn=>{tick=fn;return 1;},clearInterval(){},sendMessage:async()=>{sends++;},
          relay:async()=>{if(!online)throw Error('offline');return {ok:true,connected:true,service_epoch:'mobile-c2',commands:[],
            voice:{reason:'ready',snapshot:{bridge_epoch:epoch,sequence:1,target:{session_id:session,title:session},captures:captures.map(x=>({...x,recovery:{...x.recovery}}))}}};},
          captureRequest:async(action,payload)=>{requests.push({action,payload});if(held)return new Promise(r=>release=r);return {ok:false,code:'capture_outcome_unknown'};}
        });
        const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
        const button=action=>document.querySelector('[data-capture-action="'+action+'"]');
        input.focus();runtime.start();await settle();tick();await settle();
        check(!$('voxsparkRecovery').hidden&&!button('retry').disabled,'recovery unavailable');
        check($('voxsparkRecoveryItems').textContent.includes('剩余 15 分钟'),'TTL absent');
        const selection=getSelection();selection.selectAllChildren(input);selection.collapseToEnd();
        const stable=button('retry');tick();await settle();
        check(stable===button('retry')&&document.activeElement===input&&selection.isCollapsed,'poll changed focus/controls');
        button('retry').click();await settle();button('retry').click();await settle();
        check(requests.length===2&&requests[0].payload.request_id===requests[1].payload.request_id,'unknown used a new request');
        check(input.textContent==='保留的草稿'&&sends===0,'recovery modified Composer');
        captures[0].recovery.revision=2;tick();await settle();button('retry').click();await settle();
        check(requests[2].payload.request_id!==requests[0].payload.request_id,'new failure reused request');
        const bounds=$('voxsparkRecovery').getBoundingClientRect();
        check(bounds.width>=250&&$('fixture').scrollWidth<=340&&bounds.bottom<=input.getBoundingClientRect().top+1,'recovery overlaps or squeezes Composer');
        check($('voxsparkVoiceStatus').getBoundingClientRect().bottom<=bounds.top+1,'recovery overlaps voice status');
        online=false;clock+=3100;tick();await settle();check(button('retry')?.disabled!==false,'offline controls enabled');
        online=true;tick();await settle();check(!button('retry').disabled,'reconnect blocked');
        clock=902000;tick();await settle();check(button('retry').disabled&&!button('discard').disabled,'expired recovery actions');
        check($('voxsparkRecoveryItems').textContent.includes('无法恢复'),'expiry invisible');
        held=true;button('discard').click();await settle();check(button('discard').disabled,'concurrent click enabled');
        document.querySelector('[data-thread]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        session='session-b';runtime.syncContext();await settle();release({ok:true});await settle();
        check($('voxsparkRecovery').hidden,'late response leaked into another Session');
        check(input.textContent==='保留的草稿'&&sends===0,'draft lost');
        session='session-a';input.focus();runtime.syncContext();await settle();
        epoch='bridge-restarted';captures=[];tick();await settle();
        check($('voxsparkRecoveryNotice').textContent.includes('Bridge 已重启')&&!button('retry'),'restart lost recording hint');
        runtime.stop();check($('voxsparkRecovery').hidden,'stop retained panel');
        $('result').textContent='PASS recovery controls, request identity, generations, TTL, offline, Session isolation, stable caret, draft preservation and narrow layout';
      }catch(e){$('result').textContent='FAIL '+e.message;}
      </script>`;
    const file=path.join(dir,'fixture.html');fs.writeFileSync(file,page);
    const output=execFileSync(process.env.CHROMIUM_EXECUTABLE,['--no-sandbox','--disable-gpu',`--user-data-dir=${path.join(dir,'profile')}`,
      '--window-size=390,844','--dump-dom','--timeout=5000','--virtual-time-budget=2000',pathToFileURL(file).href],
      {encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
    const result=output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert.ok(result?.startsWith('PASS '),result||'no result'); console.log(`${mode}/${theme}: ${result}`);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
