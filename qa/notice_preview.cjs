// 公告预览：把 deploy/notice.json 通过 CDP 注入，截「收起 / 展开」两张图
//   QA_PORT=5299 node qa/notice_preview.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9820 + Math.floor(Math.random() * 30);
const WEB = Number(process.env.QA_PORT || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const OUT = path.resolve(__dirname, "fbx");
const NOTICE = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../deploy/notice.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const d2 = (n) => String(n).padStart(2, "0");
const now = new Date();
const stamp = (day, h, mi) => `${now.getFullYear()}-${d2(now.getMonth() + 1)}-${d2(day)} ${d2(h)}:${d2(mi)}:05`;
const LOC = { id: 2, name: "3 号公寓 · 502", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
const TASK = { id: 37, sign_time: "23:30", mode: "daily", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: true, status: "waiting" };
const LOGS = [1, 2, 4].map((d, i) => ({ id: 900 + i, schedule_id: 37, run_at: stamp(d, 23, 30), success: true, detail: "scheduled", msg: "auto · 签到成功" }));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ntp-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--no-proxy-server", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
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
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__jsErr=0;window.addEventListener('error',()=>window.__jsErr++);" });

  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }, { urlPattern: "*://*/update/*", requestStage: "Request" }] });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== "Fetch.requestPaused") return;
    const p = m.params;
    const u = new URL(p.request.url);
    const cors = [
      { name: "Access-Control-Allow-Origin", value: p.request.headers.Origin || "*" },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
      { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
      { name: "Access-Control-Max-Age", value: "600" },
      { name: "Content-Type", value: "application/json; charset=utf-8" },
    ];
    if (p.request.method === "OPTIONS") {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" }).catch(() => {});
      return;
    }
    let payload = null;
    if (u.pathname === "/update/notice.json") payload = NOTICE;
    if (u.pathname === "/update/version.json") { send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 404, responseHeaders: cors, body: "{}" }).catch(() => {}); return; }
    if (u.pathname === "/api/schedules") payload = { success: true, msg: "ok", data: [TASK] };
    if (u.pathname === "/api/logs") payload = { success: true, msg: "ok", data: LOGS };
    if (u.pathname === "/api/locations") payload = { success: true, msg: "ok", data: [LOC] };
    if (payload) {
      send("Fetch.fulfillRequest", {
        requestId: p.requestId, responseCode: 200, responseHeaders: cors,
        body: Buffer.from(JSON.stringify(payload)).toString("base64"),
      }).catch(() => {});
    } else {
      send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
    }
  });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1300);
  const tok = await ev(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }) });
      const j = await r.json();
      return (j && j.data && j.data.token) || "";
    } catch (e) { return ""; }
  })()`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok || "")}); localStorage.removeItem('dorm.notice.seen'); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=home#home` });
  for (let i = 0; i < 20; i++) {
    if (await ev(`!!document.querySelector('.notice')`)) break;
    await sleep(400);
  }
  await sleep(1800);
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(400);
  }
  await sleep(400);

  const info = await ev(`(() => {
    const n = document.querySelector('.notice');
    const title = n && n.querySelector('.notice__title');
    const body = n && n.querySelector('.notice__body');
    return {
      top: n && Math.round(n.getBoundingClientRect().top),
      h: n && Math.round(n.getBoundingClientRect().height),
      title: title && title.textContent.trim(),
      titleClipped: title && title.scrollWidth > title.clientWidth + 1,
      open: n && n.getAttribute('data-open'),
      bodyH: body && Math.round(body.getBoundingClientRect().height),
      items: [...n.querySelectorAll('.notice__list li')].map((li) => li.textContent.trim().length),
      tipLen: (n.querySelector('.notice__tip span') || {}).textContent ? n.querySelector('.notice__tip span').textContent.trim().length : 0,
      jsErr: window.__jsErr || 0,
    };
  })()`);
  console.log("公告:", JSON.stringify(info));

  // 视口滚动到公告可见处再截
  await shot("notice-new-expanded");
  await ev(`document.querySelector('.notice__head').click(); 'ok'`);
  await sleep(900);
  await shot("notice-new-collapsed");
  console.log("收起后:", JSON.stringify(await ev(`(() => { const n = document.querySelector('.notice'); return { open: n.getAttribute('data-open'), h: Math.round(n.getBoundingClientRect().height) }; })()`)));

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
})();
