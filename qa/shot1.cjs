// 指定路由下按多个时间点截图（用于抓启动页 / 稳定态）
// node qa/shot1.cjs <route> <outPrefix> [d1,d2,...]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9355;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5275}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTE = process.argv[2] || "login";
const OUT = process.argv[3] || "qa/native/login";
const DELAYS = (process.argv[4] || "400,2600").split(",").map(Number);

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "shot1-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  const VW = Number(process.env.QA_W || 412), VH = Number(process.env.QA_H || 915);
  await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 2, mobile: !process.env.NO_CAP });
  if (!process.env.NO_CAP) await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',Plugins:{}};` });
  if (process.env.QA_TOKEN) await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token', ${JSON.stringify(process.env.QA_TOKEN)});` });
  await send("Page.navigate", { url: `${WEB}/?r=${ROUTE}#${ROUTE}` });
  let last = 0;
  for (const d of DELAYS) {
    await sleep(d - last); last = d;
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = `${OUT}@${d}.png`;
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log(file);
  }
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
