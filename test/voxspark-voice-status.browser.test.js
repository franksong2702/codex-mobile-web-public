"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

for (const mode of ["classic", "native-esm"]) for (const theme of ["dark", "light"]) test(`${mode}/${theme}: voice status distinguishes other destinations and preserves focus and narrow layout`, {
  skip: !process.env.CHROMIUM_EXECUTABLE,
}, () => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voxspark-voice-browser-"));
  try {
    const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
    const status = html.match(/<div id="voxsparkVoiceStatus"[\s\S]*?<\/div>/)[0];
    const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    const source = fs.readFileSync(path.join(root, mode === "classic" ? "public/voxspark-surface-host-runtime.js" : "frontend/native/voxspark-surface-host-runtime.mjs"), "utf8");
    const page = `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>${css}</style>
      <style>body{display:block;padding:8px}#fixture{width:340px;max-width:100%}.composer-body{display:block}#messageInput{min-height:80px;outline:1px solid gray}</style>
      <div id="fixture"><form class="composer"><div class="composer-body">${status}<div id="messageInput" contenteditable="true">保留的草稿</div></div></form></div>
      <button data-thread="session-b">B</button><pre id="result">PENDING</pre>
      ${mode === "classic" ? `<script>${source}</script>` : ""}
      <script type="module">
      ${mode === "native-esm" ? `await import('data:text/javascript;base64,${Buffer.from(source).toString("base64")}');` : ""}
      try {
        const $ = id => document.getElementById(id); const input = $('messageInput');
        Object.defineProperty(document, 'hasFocus', { value: () => true });
        let session = 'session-a'; let state = 'recording'; let duration = 1200; let connected = true; let tick;
        const targetTitle = '一个很长的语音目标 Session '.repeat(4).slice(0,80).trim();
        let clock = 1000;
        const runtime = CodexVoxSparkSurfaceHostRuntime.createVoxSparkSurfaceHostRuntime({ document, window, $, clientId: 'fixture',
          bridgeUrl: 'ws://127.0.0.1:8790/host', currentComposerThreadId: () => session,
          composerTargetThread: () => ({ id: session, name: session }), composerText: () => input.textContent,
          now: () => clock, setInterval: callback => { tick=callback; return 1; }, clearInterval() {},
          relay: async () => ({ ok:true, connected, commands:[], voice:{reason:'ready', snapshot:{target:{session_id:session,title:session==='session-a'?targetTitle:'B'},
            captures:[{capture_id:'a',session_id:'session-a',session_title:targetTitle,state,duration_ms:duration}]}} }) });
        const settle = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
        runtime.start(); await settle();
        if (document.activeElement === input) throw Error('status opened input focus');
        if (!$('voxsparkVoiceStage').textContent.includes('录音中')) throw Error('missing recording');
        if ($('voxsparkVoiceDuration').textContent !== '0:01') throw Error('wrong duration');
        const bounds = $('voxsparkVoiceStatus').getBoundingClientRect();
        if (bounds.width > 340 || bounds.bottom > input.getBoundingClientRect().top + 1) throw Error('status covers Composer');
        if ($('fixture').scrollWidth > 340) throw Error('narrow layout overflow');
        const ownColor = getComputedStyle($('voxsparkVoiceStatus')).color;
        input.focus(); const selection = getSelection(); selection.selectAllChildren(input); selection.collapseToEnd();
        const button=document.querySelector('button'); button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
        session='session-b'; runtime.syncContext(); await settle();
        if (!$('voxsparkVoiceStage').textContent.includes('BOX 录音中')) throw Error('recording disappeared after switching');
        if ($('voxsparkVoiceStage').textContent.includes('目标是另一个 Session')) throw Error('redundant destination explanation');
        if ($('voxsparkVoiceTarget').textContent !== '语音发送到：'+targetTitle) throw Error('recording relabeled as current Session');
        const elsewhereStyle = getComputedStyle($('voxsparkVoiceStatus'));
        const otherColor = elsewhereStyle.color;
        if (otherColor === ownColor) throw Error('other destination still uses current recording color');
        if (elsewhereStyle.backgroundColor === 'rgba(0, 0, 0, 0)' || parseFloat(elsewhereStyle.borderInlineStartWidth) < 2) throw Error('missing destination visual marker');
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d'); ctx.fillStyle='white'; ctx.fillRect(0,0,1,1);
        const ancestors=[]; for(let el=$('voxsparkVoiceStatus');el;el=el.parentElement) ancestors.unshift(el);
        for(const el of ancestors) { ctx.fillStyle=getComputedStyle(el).backgroundColor; ctx.fillRect(0,0,1,1); }
        const luminance=rgb=>Array.from(rgb).slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
        const bgLum=luminance(ctx.getImageData(0,0,1,1).data);
        ctx.fillStyle=otherColor;ctx.fillRect(0,0,1,1);
        const fgLum=luminance(ctx.getImageData(0,0,1,1).data);
        const contrast=(Math.max(bgLum,fgLum)+0.05)/(Math.min(bgLum,fgLum)+0.05);
        if(contrast<4.5) throw Error('destination contrast below 4.5: '+contrast);
        const otherBounds = $('voxsparkVoiceStatus').getBoundingClientRect();
        if ($('fixture').scrollWidth > 340 || otherBounds.bottom > input.getBoundingClientRect().top + 1) throw Error('destination marker covers or overflows Composer');
        state='transcribing'; tick(); await settle();
        if (!$('voxsparkVoiceStage').textContent.includes('识别中')) throw Error('wrong actual stage');
        state='waitingComposer'; tick(); await settle();
        if ($('voxsparkVoiceStage').textContent.includes('整理')) throw Error('invented Luna stage');
        if (!$('voxsparkVoiceStage').textContent.includes('等待写入')) throw Error('missing background wait');
        state='ready'; tick(); await settle();
        if (document.activeElement !== input || input.textContent !== '保留的草稿' || !selection.isCollapsed) throw Error('focus/draft/caret changed');
        if ($('voxsparkVoiceStage').textContent.includes('已写入')) throw Error('another Session status leaked');
        if (getComputedStyle($('voxsparkVoiceStatus')).color === otherColor) throw Error('other destination color was not cleared');
        clock += 3100; connected=false; tick(); await settle();
        if (!$('voxsparkVoiceStage').textContent.includes('重连')) throw Error('stale connection shown ready');
        runtime.stop(); if (!$('voxsparkVoiceStatus').hidden) throw Error('stopped status visible');
        $('result').textContent='PASS state, bypass, Session, reconnect, focus, caret, draft, narrow layout; contrast='+contrast.toFixed(2);
      } catch(e) { document.getElementById('result').textContent='FAIL '+e.message; }
      </script>`;
    const file = path.join(dir, "fixture.html"); fs.writeFileSync(file, page);
    const output = execFileSync(process.env.CHROMIUM_EXECUTABLE, ["--no-sandbox", "--disable-gpu", `--user-data-dir=${path.join(dir, "profile")}`,
      "--window-size=390,844", "--dump-dom", "--timeout=5000", "--virtual-time-budget=2000", pathToFileURL(file).href],
    { encoding: "utf8", timeout: 15000, maxBuffer: 4*1024*1024, stdio: ["ignore", "pipe", "pipe"] });
    const result = output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
    assert.ok(result?.startsWith("PASS "), result || "no result");
    console.log(`${mode}/${theme}: ${result}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
