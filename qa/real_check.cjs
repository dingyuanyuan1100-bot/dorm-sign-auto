// 用正式包直连真实后端：验证读正常、写返回业务错误时不误判为「连不上」
// node qa/real_check.cjs <token> [base]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9371;
const BASE = process.argv[3] || "http://127.0.0.1:5280";
const TOKEN = process.argv[2] || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rc-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const ev = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Network.responseReceived" && m.params.response.url.includes("8805")) ev.push(`${m.params.response.status} ${m.params.response.url.replace(/^http:\/\/[^/]+/, "")}`);
    if (m.method === "Network.loadingFailed") ev.push(`✗ ${m.params.errorText}`);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const js = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token', ${JSON.stringify(TOKEN)});` });
  await send("Page.navigate", { url: `${BASE}/?r=tasks#tasks` });
  await sleep(2500);
  console.log("首屏:", await js(`JSON.stringify({cards:document.querySelectorAll('.taskcard').length, netbar:document.querySelector('.netbar')?1:0, addrow:!!document.querySelector('.addrow')})`));
  await js(`document.querySelector('.addrow').click(); 1`);
  await sleep(500);
  console.log("弹层位置行:", await js(`document.querySelectorAll('.sheet__row').length`));
  await js(`document.querySelector('.sheet__btn--primary').click(); 1`);
  await sleep(1800);
  console.log("创建后:", await js(`JSON.stringify({toast: document.querySelector('.toast') ? document.querySelector('.toast').innerText.replace(/\\n/g,' ') : null, netbar: document.querySelector('.netbar') ? document.querySelector('.netbar').innerText.replace(/\\n/g,' ') : null, cards: document.querySelectorAll('.taskcard').length})`));
  console.log("--- 后端响应 ---\n" + ev.join("\n"));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
})();
