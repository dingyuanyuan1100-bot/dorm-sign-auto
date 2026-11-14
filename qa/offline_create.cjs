// 真断网下的新建：应假不了成功、要给「连不上 + 重试」；恢复后点重试只建 1 条
// node qa/offline_create.cjs [base] [mock]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9365;
const BASE = process.argv[2] || "http://127.0.0.1:5278";
const MOCK = process.argv[3] || "http://127.0.0.1:8806";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "off-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const snap = async () => JSON.parse(await js(`JSON.stringify({
    cards: document.querySelectorAll('.taskcard').length,
    toast: document.querySelector('.toast') ? document.querySelector('.toast').innerText.replace(/\\n/g,' | ') : null,
    netbar: document.querySelector('.netbar') ? document.querySelector('.netbar').innerText.replace(/\\n/g,' ') : null,
    retryBtn: document.querySelector('.toast__action') ? document.querySelector('.toast__action').innerText : null,
  })`));

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token','mock-token');` });
  await send("Page.navigate", { url: `${BASE}/?r=tasks#tasks` });
  await sleep(1800);

  // 断网
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await js(`document.querySelector('.addrow').click(); 1`);
  await sleep(400);
  await js(`document.querySelector('.sheet__btn--primary').click(); 1`);
  await sleep(2000);
  console.log("断网后:", JSON.stringify(await snap()));

  // 恢复网络，点吐司上的「重试」
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await js(`(() => { const b = document.querySelector('.toast__action'); if (b) { b.click(); return 1; } return 0; })()`);
  await sleep(2200);
  console.log("重试后:", JSON.stringify(await snap()));
  const m = await (await fetch(MOCK + "/api/__stats")).json();
  console.log("服务端:", JSON.stringify({ n: m.data.n, stats: m.data.stats }));

  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
})();
