// 在真实 Chromium 里跑 netdiag.html，抓 Network 层的失败原因（CORS / ERR_*）
// node qa/netdiag.cjs <token> <idleSec> <n>
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9357;
const PAGE = `http://127.0.0.1:${process.env.DIAG_PORT || 5288}/netdiag.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.argv[2] || "";
const IDLE = process.argv[3] || "0";
const N = process.argv[4] || "1";

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "netdiag-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Network.requestWillBeSent") {
      const r = m.params.request;
      if (r.url.includes(":8805")) events.push(`→ ${r.method} ${r.url.replace("http://47.116.135.24:8805", "")}`);
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.url.includes(":8805")) events.push(`← ${r.status} ${r.url.replace("http://47.116.135.24:8805", "")} [${m.params.type}]`);
    }
    if (m.method === "Network.loadingFailed") {
      events.push(`✗ FAILED ${m.params.type} ${m.params.errorText} blocked=${m.params.blockedReason || "-"} cors=${JSON.stringify(m.params.corsErrorStatus || null)}`);
    }
    if (m.method === "Log.entryAdded" && /CORS|Mixed|net::/.test(m.params.entry.text)) {
      events.push(`! ${m.params.entry.text.slice(0, 220)}`);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Log.enable");
  await send("Page.navigate", { url: `${PAGE}?t=${encodeURIComponent(TOKEN)}&idle=${IDLE}&n=${N}` });

  let result = null;
  for (let i = 0; i < 120 && !result; i++) {
    await sleep(500);
    const r = await send("Runtime.evaluate", { expression: "window.__RESULT", returnByValue: true });
    result = r.result.value;
  }
  console.log("=== page log ===");
  console.log(result || "(timeout)");
  console.log("=== network ===");
  console.log(events.join("\n"));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
