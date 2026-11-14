// 点击穿透检查：问候语/头像/滚动容器 的命中顺序
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9387;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "hit-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('dorm.token','qa-token')}catch(e){}` });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  await sleep(4800);
  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(600);

  const hit = (x, y) => evalJs(`(() => { const e=document.elementFromPoint(${x},${y}); const c=(n)=>{ if(!n) return ''; const k=typeof n.className==='string'?n.className:(n.getAttribute&&n.getAttribute('class'))||''; return n.tagName+(k?'['+k+']':'') };
      return c(e)+' < '+c(e&&e.parentElement)+' < '+c(e&&e.parentElement&&e.parentElement.parentElement) })()`);
  console.log("greeting  (140,108):", await hit(140, 108));
  console.log("avatar    (344,96) :", await hit(344, 96));
  console.log("hero      (60,250) :", await hit(60, 250));
  console.log("notice    (200,150):", await hit(200, 150));

  console.log("login-layer:", await evalJs("(()=>{const e=document.querySelector('.login-layer'); const c=e&&getComputedStyle(e); return e? {show:e.dataset.show, vis:c.visibility, pe:c.pointerEvents, op:c.opacity, z:c.zIndex} : null})()"));
  console.log("app data-show:", await evalJs("document.querySelector('.app')?.dataset.show"));
  console.log("notice rect:", await evalJs("(()=>{const b=document.querySelector('.notice')?.getBoundingClientRect(); return b?[Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]:null})()"));
  await evalJs("document.querySelector('.home__avatar').click(); 'ok'");
  await sleep(700);
  console.log("after avatar click hash:", await evalJs("location.hash"));

  ws.close();
  process.exit(0);
})();
