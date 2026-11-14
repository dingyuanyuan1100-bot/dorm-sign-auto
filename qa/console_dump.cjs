/* 抓页面控制台错误：node qa/console_dump.cjs [port] */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/?native=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "con-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Runtime.consoleAPICalled") console.log("[console]", m.params.type, m.params.args.map((a) => a.value || a.description).join(" ").slice(0, 400));
    if (m.method === "Runtime.exceptionThrown") console.log("[exception]", (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    if (m.method === "Log.entryAdded") console.log("[log]", m.params.entry.level, m.params.entry.text.slice(0, 300));
  };
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Page.navigate", { url: WEB });
  await sleep(4000);
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.value;
  console.log("bodyText:", (await ev("document.body.innerText || ''")).slice(0, 200));
  console.log("hasLogin:", await ev("!!document.querySelector('.login')"));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
