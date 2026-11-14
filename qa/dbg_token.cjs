// 调试：token 注入与首屏请求
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9363;
const BASE = process.argv[2] || "http://127.0.0.1:5277";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Network.requestWillBeSent") logs.push("→ " + m.params.request.method + " " + m.params.request.url);
    if (m.method === "Network.loadingFailed") logs.push("✗ " + m.params.errorText);
    if (m.method === "Runtime.consoleAPICalled") logs.push("console " + m.params.args.map(a => a.value).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + JSON.stringify(m.params.exceptionDetails.text) + " " + (m.params.exceptionDetails.exception?.description || "").slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('dorm.token','mock-token');window.__seeded=true;}catch(e){window.__seedErr=String(e)}` });
  await send("Page.navigate", { url: `${BASE}/?r=tasks#tasks` });
  await sleep(2200);
  const r = await send("Runtime.evaluate", { expression: `JSON.stringify({tok: localStorage.getItem('dorm.token'), seeded: window.__seeded, err: window.__seedErr, addrow: !!document.querySelector('.addrow'), hash: location.hash})`, returnByValue: true });
  console.log("eval:", r.result.value);
  console.log(logs.slice(0, 40).join("\n"));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
})();
