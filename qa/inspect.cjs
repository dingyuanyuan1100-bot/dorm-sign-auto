// 在模拟原生壳下读取关键元素的计算样式，定位黑边来源
// node qa/inspect.cjs [route]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9353;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5275}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROUTE = process.argv[2] || "login";

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "insp-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.Capacitor={isNativePlatform:()=>true,getPlatform:()=>'android',Plugins:{}};` });
  await send("Page.navigate", { url: `${WEB}/?r=${ROUTE}#${ROUTE}` });
  await sleep(2500);
  const expr = `(() => {
    const q = (s) => document.querySelector(s);
    const info = (el) => { if (!el) return null; const c = getComputedStyle(el); const r = el.getBoundingClientRect();
      return { cls: el.className, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        radius: c.borderRadius, shadow: c.boxShadow, bg: c.backgroundColor, pos: c.position, overflow: c.overflow }; };
    return JSON.stringify({
      cap: !!window.Capacitor,
      vw: innerWidth, vh: innerHeight,
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      viewport: info(q('.viewport')), device: info(q('.device')), stage: info(q('.stage')), screen: info(q('.screen')),
      splash: info(q('.splash')),
    }, null, 1);
  })()`;
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(r.result.value);
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
