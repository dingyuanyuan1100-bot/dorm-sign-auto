// 立即签到：死连接/回包丢失时是否一次点击就成功（不弹「连不上」）
// node qa/run_e2e.cjs [base] [mock]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9373;
const BASE = process.argv[2] || "http://127.0.0.1:5282";
const MOCK = process.argv[3] || "http://127.0.0.1:8806";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (m2, p = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m2, params: p })); });
  const js = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  const ui = `JSON.stringify({ toast: document.querySelector('.toast')?.innerText.replace(/\\n/g,' ') || null, netbar: document.querySelector('.netbar')?.innerText.replace(/\\n/g,' ') || null, busy: !!document.querySelector('.taskcard__btn .spinner') })`;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token','mock-token');` });
  await send("Page.navigate", { url: `${BASE}/#tasks` });
  await sleep(2000);
  console.log("初始:", await js(ui));
  console.log("任务卡片数:", await js(`document.querySelectorAll('.taskcard').length`));

  await js(`document.querySelector('.taskcard__btn').click(); 1`);
  await sleep(250); console.log("点击后 250ms:", await js(ui));
  await sleep(800); console.log("点击后 1s:", await js(ui));
  await sleep(1200); console.log("点击后 2.2s:", await js(ui));

  const s = await (await fetch(`${MOCK}/api/__stats`)).json();
  console.log("服务端统计:", JSON.stringify(s.data.stats));

  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
