// 探针 4：滚轮上到底盖着什么元素 + 滚轮事件能不能滚
//   node qa/probe_wheel4.cjs [端口]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9620 + Math.floor(Math.random() * 30);
const WEB = Number(process.argv[2] || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const USER = "qacheck_1793717807";
const PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pwh4-"));
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
    if (r.exceptionDetails) return "EX " + (r.exceptionDetails.exception?.description || "").slice(0, 200);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1400);
  const tok = await ev(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
      const j = await r.json();
      return (j && j.data && j.data.token) || "";
    } catch (e) { return ""; }
  })()`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok || "")}); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=tasks#tasks` });
  for (let i = 0; i < 20; i++) {
    if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(600);
  }
  await sleep(1400);
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(400);
  }
  await ev(`document.querySelector('.addrow').click(); 'ok'`);
  await sleep(900);

  console.log("命中元素:", JSON.stringify(await ev(`(() => {
    const c = document.querySelectorAll('.tw__col')[0];
    const r = c.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    const el = document.elementFromPoint(x, y);
    const chain = [];
    let n = el;
    while (n && chain.length < 6) {
      const cs = getComputedStyle(n);
      chain.push({ tag: n.tagName, cls: n.className && String(n.className).slice(0, 40), ta: cs.touchAction, pe: cs.pointerEvents, ov: cs.overflowY, pos: cs.position });
      n = n.parentElement;
    }
    return { x, y, hit: el && el.tagName + '.' + String(el.className || '').slice(0, 30), chain };
  })()`)));

  // 鼠标滚轮（可信事件）
  for (let k = 1; k <= 3; k++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 148, y: 486, deltaX: 0, deltaY: -120, pointerType: "mouse" });
    await sleep(400);
    console.log(`滚轮${k}:`, JSON.stringify(await ev(`(() => [...document.querySelectorAll('.tw__col')].map((c) => ({ top: Math.round(c.scrollTop), on: c.querySelector('.tw__item[data-on="true"]')?.textContent })))()`)));
  }

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
})();
