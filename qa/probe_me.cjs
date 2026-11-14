// 探针：打开 #me，dump 登录层 / listrow / 反馈浮层状态
//   node qa/probe_me.cjs [端口]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9470 + Math.floor(Math.random() * 40);
const WEB = Number(process.argv[2] || 5297);
const BASE = `http://127.0.0.1:${WEB}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pme-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { const q = wait.get(m.id); wait.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EX " + (r.exceptionDetails.exception?.description || "").slice(0, 300);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1200);
  await ev(`localStorage.setItem('dorm.token','mock-token'); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=me#me` });
  await sleep(2800);

  console.log("A 基础:", JSON.stringify(await ev(`(() => ({
    hash: location.hash,
    search: location.search,
    token: localStorage.getItem('dorm.token'),
    loginShow: document.querySelector('.login-layer')?.getAttribute('data-show'),
    panes: [...document.querySelectorAll('.pane')].map(p => p.getAttribute('data-active')),
    meActive: document.querySelector('.pane[data-route="me"]')?.getAttribute('data-active'),
  }))()`)));

  console.log("B 行:", JSON.stringify(await ev(`(() => {
    const rows = [...document.querySelectorAll('.listrow')];
    return { n: rows.length, keys: rows.map(r => r.getAttribute('data-key')),
      btnCount: document.querySelectorAll('.listrow__value').length,
      texts: rows.map(r => r.textContent.trim().slice(0, 20)) };
  })()`)));

  console.log("C 点反馈:", JSON.stringify(await ev(`(() => {
    const row = document.querySelector('.listrow[data-key="feedback"]');
    if (!row) return { err: 'no row' };
    const b = row.querySelector('.listrow__value');
    if (!b) return { err: 'no btn', html: row.outerHTML.slice(0, 300) };
    b.click();
    return { clicked: true };
  })()`)));
  await sleep(1000);

  console.log("D 点击后:", JSON.stringify(await ev(`(() => ({
    fb: !!document.querySelector('.fb'),
    fbStep: document.querySelector('.fb')?.getAttribute('data-step'),
    fbCls: [...document.querySelectorAll('.fb, .fb-sheet, .fb-layer')].map(e => e.className),
    bodyTail: document.body.innerHTML.slice(-400),
  }))()`)));

  ws.close();
  chrome.kill();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
