const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9397;
const WEB = "http://127.0.0.1:5292";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-"));
  const child = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.consoleAPICalled") logs.push("LOG " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("ERR " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('dorm.token','qa-token');localStorage.removeItem('dorm.update.snoozed');}catch(e){}\nwindow.__t0=performance.now();` });
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  for (const t of [1500, 3000, 5000, 8000]) {
    await sleep(t === 1500 ? 1500 : 2000);
    const s = await evalJs(`JSON.stringify({boot:document.querySelector('.stage')?.dataset.boot||null, intro:document.querySelector('.stage')?.dataset.intro||null, splash:!!document.querySelector('#boot-splash'), panes:[...document.querySelectorAll('.pane')].map(p=>p.dataset.active), sheets:document.querySelectorAll('.sheet').length, text:(document.body.innerText||'').replace(/\\n+/g,' | ').slice(0,160)})`);
    console.log(t, s);
  }
  console.log(logs.slice(-10).join("\n"));
  ws.close(); child.kill(); process.exit(0);
})();
