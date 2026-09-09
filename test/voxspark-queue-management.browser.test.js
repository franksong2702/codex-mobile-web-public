"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

for (const mode of ["classic", "native-esm"]) for (const theme of ["dark", "light"]) test(`${mode}/${theme}: Queue management preserves Session ownership, unknown outcomes, focus and narrow layout`, {
  skip: !process.env.CHROMIUM_EXECUTABLE,
}, () => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-queue-browser-"));
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
        let session='session-a', clock=1000, activeTurn="turn-a", tick, online=true, hold, delayed, holdRelay, lateRelay, verified=false;
        const item=(id,status,s='session-a')=>({queue_id:id,action_id:id,session_id:s,draft_revision:1,status,created_at:1000,text:"<img src=x onerror=alert(1)> 原始草稿 "+"长正文".repeat(220)+" 末尾可见"});
        let entries=[item('waiting','queued'), item('failed','failed'), item('unknown','unknown')];
        const operations=[]; let sends=0; const sent=[];
        const runtime=CodexVoxSparkSurfaceHostRuntime.createVoxSparkSurfaceHostRuntime({document,window,$,clientId:'browser-a',
          bridgeUrl:'ws://127.0.0.1:8790/host', currentComposerThreadId:()=>session,
          composerTargetThread:()=>({id:session,name:session}),composerTargetActiveTurnId:()=>activeTurn,composerText:()=>input.textContent,
          now:()=>clock,setInterval:callback=>{tick=callback;return 1;},clearInterval(){},
          sendDraft:async draft=>{sends++;sent.push(draft);},
          relay:async()=>{if(!online) throw Error('offline');const result={ok:true,connected:true,commands:[],queue:entries.filter(e=>e.session_id===session).map(e=>({...e}))};if(holdRelay){holdRelay=false;return new Promise(resolve=>{lateRelay=()=>resolve(result);});}return result;},
          queueRequest:async(operation,payload)=>{
            operations.push([operation,payload]);
            if(hold){hold=false;return new Promise(resolve=>{delayed=resolve;});}
            const entry=entries.find(e=>e.queue_id===payload.queue_id&&e.session_id===payload.session_id);
            if(!entry) return {ok:false};
            if(operation==='cancel'){entries=entries.filter(e=>e!==entry);return {ok:true,queue:{...entry,status:'cancelled'}};}
            if(operation==='claim'){if(entry.status!=='queued')return {ok:false};entry.status='leased';return {ok:true,queue:{...entry},text:entry.text,lease_token:'lease-'+entry.queue_id,client_submission_id:'voxspark-'+entry.queue_id};}
            if(operation==='complete'){entry.status=payload.outcome==='succeeded'?'submitted':payload.outcome;if(payload.outcome==='succeeded')entry.text='';}
            if(operation==='retry') entry.status='queued';
            if(operation==='reconcile'&&verified) entry.status='submitted';
            return {ok:true,queue:{...entry},preview:'<img src=x onerror=alert(1)> 原始草稿',truncated:false};
          }});
        const settle=async()=>{for(let i=0;i<30;i++) await Promise.resolve();};
        const button=(id,action)=>document.querySelector('[data-queue-id="'+id+'"][data-queue-action="'+action+'"]');
        runtime.start();await settle();
        check(!$('voxsparkQueue').hidden&&$('voxsparkQueue').open,'queue body not open by default');
        check($('voxsparkQueueSummary').textContent.includes('3'),'queue count');
        check($('voxsparkQueueItems').textContent.includes('末尾可见')&&!document.querySelector('[data-queue-action=inspect]'),'body requires inspection or is truncated');
        input.focus();const selection=getSelection();selection.selectAllChildren(input);selection.collapseToEnd();
        const stableButton=button('waiting','cancel');tick();await settle();
        check(document.activeElement===input&&input.textContent==='保留的草稿'&&selection.isCollapsed,'poll changed draft or caret');
        check(stableButton===button('waiting','cancel'),'poll replaced controls');
        check(button('unknown','retry').hidden&&button('unknown','cancel').hidden,'unknown permits replay or cancellation');
        check($('voxsparkQueueItems').textContent.includes('原始草稿')&&!$('voxsparkQueueItems').querySelector('img'),'preview unsafe or missing');
        button('waiting','cancel').click();await settle();
        check(!button('waiting','cancel')&&$('voxsparkQueueSummary').textContent.includes('2'),'cancel retained item or lost neighbors');
        button('failed','retry').click();await settle();
        check(button('failed','retry').hidden&&button('failed','cancel')&&!button('failed','cancel').hidden,'retry not queued');
        button('unknown','reconcile').click();await settle();
        check($('voxsparkQueueNotice').textContent.includes('仍无法确认')&&sends===0,'unknown resubmitted');
        hold=true;button('unknown','reconcile').click();await settle();
        holdRelay=true;tick();await settle();
        entries.find(e=>e.queue_id==='unknown').status='submitted';
        delayed({ok:true,queue:item('unknown','submitted')});await settle();
        online=false;lateRelay();await settle();
        check(button('unknown','reconcile').hidden,'old poll rolled back confirmed mutation');
        online=true;tick();await settle();
        check($('voxsparkQueueNotice').textContent.includes('已核实')&&button('unknown','reconcile').hidden,'receipt did not converge');
        clock+=3100;online=false;tick();await settle();
        check(button('failed','cancel').disabled,'offline actions enabled');
        online=true;tick();await settle();check(!button('failed','cancel').disabled,'actions did not recover');
        check(!button('failed','steer').disabled,'running Queue cannot steer');
        button('failed','steer').click();await settle();
        check(sends===1&&sent[0].mode==='steer'&&sent[0].activeTurnId==='turn-a'&&sent[0].strictSteer&&sent[0].preserveComposerDraft,'steer contract');
        check(button('failed','steer').hidden&&input.textContent==='保留的草稿','steer left replay or cleared draft');
        tick();await settle();activeTurn='';tick();await settle();
        check(sends===1,'successful steer resent at idle');
        entries.push(item('late','queued'));activeTurn='turn-a';tick();await settle();
        hold=true;button('late','steer').click();await settle();
        document.querySelector('[data-thread]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        session='session-b';entries.push(item('b-failed','failed','session-b'));runtime.syncContext();await settle();
        check($('voxsparkQueue').open&&$('voxsparkQueueSummary').textContent.includes('1'),'new Session body not visible');
        delayed({ok:true,queue:item('late','leased'),text:'A only private preview',lease_token:'late-lease',client_submission_id:'voxspark-late'});await settle();
        check(!$('voxsparkQueueItems').textContent.includes('A only')&&!button('late','steer'),'late A response affected B');
        button('b-failed','retry').click();await settle();
        check(operations.at(-1)[1].session_id==='session-b','action target changed');
        const bounds=$('voxsparkQueue').getBoundingClientRect();
        check($('fixture').scrollWidth<=340&&bounds.width>=250&&bounds.bottom<=input.getBoundingClientRect().top+1,'narrow layout overlaps or squeezes Composer');
        check($('voxsparkVoiceStatus').getBoundingClientRect().bottom<=bounds.top+1,'queue overlaps voice status');
        check(sends===1&&input.textContent==='保留的草稿','management submitted or destroyed manual draft');
        runtime.stop();check($('voxsparkQueue').hidden&&!$('voxsparkQueueItems').textContent,'stop retained private preview');
        $('result').textContent='PASS visible full body, safe text, steer once, late target blocked, cancel, retry, reconcile, offline, stable controls, caret, narrow layout';
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
