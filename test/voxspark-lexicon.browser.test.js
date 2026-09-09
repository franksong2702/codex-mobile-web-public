"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

for (const mode of ["classic", "native-esm"]) for (const theme of ["dark", "light"]) test(`${mode}/${theme}: personal lexicon controls and conflict recovery`, {skip: !process.env.CHROMIUM_EXECUTABLE}, () => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-lexicon-browser-"));
  try {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const dialog = html.match(/<dialog id="voxsparkLexiconDialog"[\s\S]*?<\/dialog>/)[0];
    const entry = html.match(/<button[^>]*id="voxsparkLexiconOpen"[^>]*>[\s\S]*?<\/button>/)[0];
    const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    const source = fs.readFileSync(path.join(root, mode === "classic" ? "public/voxspark-lexicon-runtime.js" : "frontend/native/voxspark-lexicon-runtime.mjs"), "utf8");
    const page = `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style>
      ${entry}${dialog}<pre id="result">PENDING</pre>
      ${mode === "classic" ? `<script>${source}</script>` : ""}<script type="module">
      ${mode === "native-esm" ? `await import('data:text/javascript;base64,${Buffer.from(source).toString("base64")}');` : ""}
      const $=id=>document.getElementById(id);
      try {
        const check=(ok,msg)=>{if(!ok)throw Error(msg)}, settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
        let doc={schema:1,revision:0,entries:[]}, fault='', hold=false, release;
        const calls=[], reply=()=>({ok:true,bridge_epoch:'epoch-a',document:structuredClone(doc)});
        const runtime=CodexVoxSparkLexiconRuntime.createVoxSparkLexiconRuntime({document,$,requestPrefix:'fixture',request:async(action,payload)=>{
          calls.push({action,payload}); if(action==='list')return fault==='offline'?{ok:false,code:'lexicon_disconnected'}:reply();
          if(hold)return new Promise(r=>release=r);
          if(fault){const code=fault;fault='';return {ok:false,code};}
          check(payload.expected_revision===doc.revision&&payload.bridge_epoch==='epoch-a','missing concurrency fence');
          let item=doc.entries.find(x=>x.text===payload.text);
          if(action==='add'){if(!item){item={text:payload.text,aliases:[],enabled:true,updatedAt:1};doc.entries.push(item);}item.aliases.push(...payload.aliases);item.enabled=true;}
          if(action==='disable'||action==='enable')item.enabled=action==='enable';
          if(action==='unalias')item.aliases=item.aliases.filter(x=>x!==payload.alias);
          if(action==='remove')doc.entries=doc.entries.filter(x=>x!==item);
          doc.revision++;return reply();
        }});
        runtime.initialize();check(calls.length===0,'loaded before opening');
        $('voxsparkLexiconOpen').click();await settle();check($('voxsparkLexiconDialog').open&&!$('voxsparkLexiconEmpty').hidden,'empty/open state');
        const submit=(text,alias='')=>{$('voxsparkLexiconTerm').value=text;$('voxsparkLexiconAlias').value=alias;$('voxsparkLexiconForm').dispatchEvent(new Event('submit',{cancelable:true}));};
        const action=label=>Array.from($('voxsparkLexiconItems').querySelectorAll('button')).find(b=>b.textContent===label);
        submit('VoxSpark','错写词');await settle();check(doc.entries.length===1&&$('voxsparkLexiconTerm').value===''&&$('voxsparkLexiconStatus').textContent.includes('已保存'),'save state');
        action('停用').click();await settle();check(!doc.entries[0].enabled,'disable');
        action('启用').click();await settle();check(doc.entries[0].enabled,'enable');
        action('补充错写').click();check($('voxsparkLexiconTerm').value==='VoxSpark'&&document.activeElement===$('voxsparkLexiconAlias'),'alias focus');
        action('移除').click();await settle();check(doc.entries[0].aliases.length===0,'unalias');
        $('voxsparkLexiconSearch').value='不存在';$('voxsparkLexiconSearch').dispatchEvent(new Event('input'));check(!$('voxsparkLexiconEmpty').hidden,'filter');
        $('voxsparkLexiconSearch').value='';$('voxsparkLexiconSearch').dispatchEvent(new Event('input'));
        action('删除').click();check(doc.entries.length===1&&action('确认删除'),'deleted without confirmation');action('取消').click();check(!action('确认删除'),'cancel');
        action('删除').click();action('确认删除').click();await settle();check(doc.entries.length===0,'remove');
        const literal='<img src=x onerror=alert(1)>';submit(literal);await settle();check(!$('voxsparkLexiconItems').querySelector('img')&&$('voxsparkLexiconItems').textContent.includes(literal),'unsafe text rendering');
        doc.entries.push({text:'别处新增',aliases:[],enabled:true,updatedAt:2});doc.revision++;fault='lexicon_revision_conflict';
        submit('冲突草稿');await settle();check($('voxsparkLexiconItems').textContent.includes('别处新增')&&$('voxsparkLexiconTerm').value==='冲突草稿'&&$('voxsparkLexiconStatus').textContent.includes('别处修改'),'conflict overwrote draft or document');
        fault='lexicon_outcome_unknown';const before=calls.length;submit('待核对');await settle();check(calls.length===before+2&&calls.at(-1).action==='list'&&$('voxsparkLexiconStatus').textContent.includes('未确认'),'unknown retried mutation');
        hold=true;submit('旧请求');await settle();check($('voxsparkLexiconSave').disabled,'busy save enabled');
        $('voxsparkLexiconTerm').value='新草稿';release(reply());await settle();check($('voxsparkLexiconTerm').value==='新草稿','overwrote newer input');
        submit('关闭前请求');await settle();const late=release;runtime.close();runtime.open();await settle();late({ok:true,bridge_epoch:'old',document:{schema:1,revision:99,entries:[]}});await settle();
        check($('voxsparkLexiconItems').textContent.includes('别处新增'),'late response changed reopened dialog');
        const d=$('voxsparkLexiconDialog');check(d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth,'horizontal overflow');
        runtime.close();hold=false;fault='offline';runtime.open();await settle();check($('voxsparkLexiconSave').disabled&&$('voxsparkLexiconEmpty').hidden&&$('voxsparkLexiconStatus').textContent.includes('连接'),'offline shown as empty');
        $('result').textContent='PASS management, confirmation, safe rendering, CAS refresh, unknown outcome, form preservation, generations, offline and layout';
      }catch(e){$('result').textContent='FAIL '+e.message;}
      </script>`;
    const file=path.join(dir,'fixture.html');fs.writeFileSync(file,page);
    const output=execFileSync(process.env.CHROMIUM_EXECUTABLE,['--no-sandbox','--disable-gpu',`--user-data-dir=${path.join(dir,'profile')}`,'--window-size=390,844','--dump-dom','--timeout=5000','--virtual-time-budget=2000',pathToFileURL(file).href],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
    const result=output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];assert.ok(result?.startsWith('PASS '),result||'no result');console.log(`${mode}/${theme}: ${result}`);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
