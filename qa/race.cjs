// 跑 race.html：node qa/race.cjs <idleSec> [warm=0|1] [api]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9359;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDLE = process.argv[2] || "0";
const WARM = process.argv[3] || "0";
const API = process.argv[4] || "http://127.0.0.1:8806";
const PAGE = `http://127.0.0.1:${process.env.DIAG_PORT || 5288}/${process.env.PAGE_NAME || "race.html"}`;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "race-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const ev = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Network.loadingFailed") ev.push(`✗ ${m.params.type} ${m.params.errorText}`);
    if (m.method === "Network.requestWillBeSent") ev.push(`→ ${m.params.request.method} ${m.params.request.url.replace(API, "")}`);
    if (m.method === "Network.responseReceived") ev.push(`← ${m.params.response.status} ${m.params.response.url.replace(API, "")}`);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.navigate", { url: `${PAGE}?idle=${IDLE}&warm=${WARM}&api=${encodeURIComponent(API)}` });
  let result = null;
  for (let i = 0; i < 90 && !result; i++) { await sleep(500); const r = await send("Runtime.evaluate", { expression: "window.__RESULT", returnByValue: true }); result = r.result.value; }
  console.log(result || "(timeout)");
  console.log("--- net ---\n" + ev.join("\n"));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
