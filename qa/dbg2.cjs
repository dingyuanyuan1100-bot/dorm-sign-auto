const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9367;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.argv[2] || "";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbg2-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',Plugins:{}};try{localStorage.setItem('dorm.token',${JSON.stringify(TOKEN)})}catch(e){window.__tokErr=String(e)}` });
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://127.0.0.1:5292/?r=home#home" });
  await sleep(3000);
  const expr = `(async () => {
    const t = (() => { try { return localStorage.getItem('dorm.token') || ''; } catch (e) { return 'ERR ' + e.message; } })();
    let me = '';
    try {
      const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + t } });
      me = r.status + ' ' + (await r.text()).slice(0, 160);
    } catch (e) { me = 'ERR ' + e.message; }
    return JSON.stringify({ tokenTail: t.slice(-10), me, nav: !!document.querySelector('.nav'), login: !!document.querySelector('.login-layer[data-show="true"]'), tokErr: window.__tokErr || '' });
  })()`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(r.result.value || JSON.stringify(r));
  ws.close(); process.exit(0);
})();
