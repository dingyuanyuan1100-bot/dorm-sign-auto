// 探针：新建签到任务的滚轮到底能滚到哪
//   node qa/probe_wheel.cjs [端口]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9500 + Math.floor(Math.random() * 40);
const WEB = Number(process.argv[2] || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const USER = "qacheck_1793717807";
const PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pwh-"));
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
  await sleep(1500);
  // 关掉可能的绑定面板
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(400);
  }
  console.log("A 打开新建:", await ev(`(() => { const a = document.querySelector('.addrow'); if (!a) return 'no addrow'; a.click(); return 'ok'; })()`));
  await sleep(900);

  console.log("B 结构:", JSON.stringify(await ev(`(() => {
    const tw = document.querySelector('.tw');
    const cols = [...document.querySelectorAll('.tw__col')];
    const sheet = document.querySelector('.sheet');
    return {
      tw: tw && { h: Math.round(tw.getBoundingClientRect().height), cls: tw.className },
      sheet: sheet && { h: Math.round(sheet.getBoundingClientRect().height), scrollH: sheet.scrollHeight, clientH: sheet.clientHeight },
      cols: cols.map((c) => ({
        clientH: c.clientHeight, scrollH: c.scrollHeight, padTop: getComputedStyle(c).paddingTop,
        items: c.querySelectorAll('.tw__item').length,
        itemH: Math.round(c.querySelector('.tw__item').getBoundingClientRect().height),
        on: c.querySelector('.tw__item[data-on="true"]')?.textContent,
        overflowY: getComputedStyle(c).overflowY,
      })),
    };
  })()`)));

  console.log("C 到底:", JSON.stringify(await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[0];
    c.scrollTop = 99999;
    await new Promise(r => setTimeout(r, 400));
    return { scrollTop: Math.round(c.scrollTop), maxScroll: c.scrollHeight - c.clientHeight,
      on: c.querySelector('.tw__item[data-on="true"]')?.textContent };
  })()`)));

  console.log("D 到顶:", JSON.stringify(await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[0];
    c.scrollTop = 0;
    await new Promise(r => setTimeout(r, 400));
    return { scrollTop: Math.round(c.scrollTop), on: c.querySelector('.tw__item[data-on="true"]')?.textContent };
  })()`)));

  console.log("E 分钟列:", JSON.stringify(await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[1];
    c.scrollTop = 99999;
    await new Promise(r => setTimeout(r, 400));
    const a = { max: Math.round(c.scrollTop), on: c.querySelector('.tw__item[data-on="true"]')?.textContent };
    c.scrollTop = 0;
    await new Promise(r => setTimeout(r, 400));
    return { ...a, top: Math.round(c.scrollTop), onTop: c.querySelector('.tw__item[data-on="true"]')?.textContent,
      scrollH: c.scrollHeight, clientH: c.clientHeight };
  })()`)));

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
})();
