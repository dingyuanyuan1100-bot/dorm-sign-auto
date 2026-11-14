// 网络诊断：在真实跨域环境下复现「创建 / 立即签到 → 无法连接服务器」
// 用法: node qa/diag.cjs [baseUrl] [user] [pass]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9337;
const BASE = process.argv[2] || "http://127.0.0.1:5277";
const USER = process.argv[3] || "qa_probe_01";
const PASS = process.argv[4] || "dorm2024";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormdiag-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const reqUrl = new Map();
  const fails = [];
  const consoles = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Network.requestWillBeSent") reqUrl.set(m.params.requestId, m.params.request);
    if (m.method === "Network.loadingFailed") {
      const r = reqUrl.get(m.params.requestId) || {};
      fails.push({
        url: r.url || "?",
        method: r.method || "?",
        type: m.params.type,
        errorText: m.params.errorText,
        blocked: m.params.blockedReason || "",
        cors: (m.params.corsErrorStatus || {}).corsError || "",
      });
    }
    if (m.method === "Runtime.consoleAPICalled") {
      consoles.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
    if (m.method === "Log.entryAdded") consoles.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJS = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  const HELPERS = `
    window.__t = {
      set(el, v){ const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; d.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); },
      byText(sel, txt){ return [...document.querySelectorAll(sel)].find(e=>e.textContent.trim()===txt); },
    }; 'ok'`;

  const toast = async () => (await evalJS("(document.querySelector('.toast')||{}).innerText||''")).trim();
  // 吐司只存活 2.4s，轮询抓第一次出现的非空文案
  const grabToast = async (ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = await toast();
      if (t) return t;
      await sleep(120);
    }
    return "";
  };
  const waitFor = async (sel, ms = 12000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evalJS(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await sleep(200); }
    return false;
  };

  console.log(`BASE = ${BASE}`);
  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(1200);
  await evalJS("localStorage.clear();'ok'");
  await send("Page.navigate", { url: BASE + "/?flat=1&r=login#login" });
  await sleep(1800);
  await evalJS(HELPERS);

  // 登录
  await evalJS(`(()=>{const i=document.querySelectorAll('.login__field input');
    __t.set(i[0], '${USER}'); __t.set(i[2], '${PASS}'); })(); 'ok'`);
  await evalJS("document.querySelector('.login__submit').click(); 'ok'");
  const atHome = await waitFor(".hero");
  console.log(`登录进入总览: ${atHome}   toast=${JSON.stringify(await toast())}`);

  // 位置页：创建
  await send("Page.navigate", { url: BASE + "/?flat=1&r=locations#locations" });
  await waitFor(".head-btn");
  await evalJS(HELPERS);
  const before = await evalJS("document.querySelectorAll('.loc').length");
  await evalJS("document.querySelector('.head-btn').click(); 'ok'");
  await sleep(600);
  await evalJS(`(()=>{const f=document.querySelectorAll('.sheet__field input');
    __t.set(f[0], 'DIAG 诊断点'); __t.set(f[1], '31.7100'); __t.set(f[2], '118.5100'); })(); 'ok'`);
  await evalJS(`__t.byText('.sheet__btn','保存').click(); 'ok'`);
  const tLoc = await grabToast();
  const after = await evalJS("document.querySelectorAll('.loc').length");
  console.log(`创建位置: ${before} -> ${after}   toast=${JSON.stringify(tLoc)}`);

  // 任务页：创建
  await send("Page.navigate", { url: BASE + "/?flat=1&r=tasks#tasks" });
  await waitFor(".addrow");
  await evalJS(HELPERS);
  await evalJS("document.querySelector('.addrow').click(); 'ok'");
  await sleep(700);
  await evalJS(`__t.byText('.sheet__btn','创建').click(); 'ok'`);
  const tTask = await grabToast();
  console.log(`创建任务 toast=${JSON.stringify(tTask)}`);

  // 立即签到（若任务卡存在）
  const hasCard = await evalJS("!!document.querySelector('.taskcard')");
  if (hasCard) {
    await evalJS(`(()=>{const b=[...document.querySelectorAll('.taskcard__btn')][0]; if(b) b.click();})(); 'ok'`);
    const tRun = await grabToast(8000);
    console.log(`立即签到 toast=${JSON.stringify(tRun)}`);
  } else {
    console.log("立即签到: 跳过（无任务卡）");
  }

  console.log("\n--- 失败请求 ---");
  if (!fails.length) console.log("(无)");
  fails.forEach((f) => console.log(`${f.errorText.padEnd(26)} ${f.method} ${f.url}${f.blocked ? "  blocked=" + f.blocked : ""}${f.cors ? "  cors=" + f.cors : ""}`));
  console.log("\n--- 控制台 ---");
  if (!consoles.length) console.log("(无)");
  consoles.slice(-12).forEach((c) => console.log("  " + c));

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
