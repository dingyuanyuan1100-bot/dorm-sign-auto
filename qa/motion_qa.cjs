// 验收：漏签格叉号 + 登录小狗入场 + 签到记录卡入场
//   QA_PORT=5299 node qa/motion_qa.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9760 + Math.floor(Math.random() * 30);
const WEB = Number(process.env.QA_PORT || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const OUT = path.resolve(__dirname, "fbx");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let pass = 0;
let fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
};

const d2 = (n) => String(n).padStart(2, "0");
const now = new Date();
const stamp = (day, h, mi) => `${now.getFullYear()}-${d2(now.getMonth() + 1)}-${d2(day)} ${d2(h)}:${d2(mi)}:05`;
const LOC = { id: 2, name: "3 号公寓 · 502", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
const TASK = { id: 37, sign_time: "23:30", mode: "daily", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: true, status: "waiting" };
// 今天之前只签了 1、2 号 → 3、4、5… 全是漏签（红格带叉）
const TODAY = now.getDate();
const LOGS = [1, 2].filter((d) => d < TODAY).map((d, i) => ({
  id: 900 + i, schedule_id: 37, run_at: stamp(d, 23, 30), success: true, detail: "scheduled", msg: "auto · 签到成功",
}));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "mot-"));
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

  /* 首页要看到日历卡：拦一层固定样本 */
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
    // 公告会整体下推内容，量尺寸/截图时先关掉
    if (u.pathname.startsWith("/update/")) {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 404, responseHeaders: cors, body: "{}" }).catch(() => {});
      return;
    }
    let payload = null;
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

  /* ---------- 1) 登录页小狗入场 ---------- */
  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(100);
  const dogSamples = [];
  for (let i = 0; i < 14; i++) {
    dogSamples.push(await ev(`(() => {
      const d = document.querySelector('.login__dog');
      const s = document.querySelector('.stage');
      if (!d) return null;
      const cs = getComputedStyle(d);
      return { intro: s && (s.dataset.intro || null), op: Math.round(Number(cs.opacity) * 100) / 100, anim: cs.animationName,
        tf: cs.transform === "none" ? "none" : "matrix", t: Math.round(performance.now()) };
    })()`));
    await sleep(70);
  }
  const dogSeen = dogSamples.filter(Boolean);
  const dogAnim = dogSeen.find((s) => s.anim !== "none");
  const dogMoving = dogSeen.filter((s) => s.anim !== "none" && s.op > 0.05 && s.op < 0.99);
  await sleep(1200);
  const dogEnd = await ev(`(() => { const d = document.querySelector('.login__dog'); const cs = getComputedStyle(d); return { op: Number(cs.opacity), anim: cs.animationName }; })()`);
  rec("小狗在开场时挂上了入场动画", !!dogAnim && dogAnim.anim === "introDrop",
    dogAnim ? `${dogAnim.anim} @t=${dogAnim.t}ms opacity=${dogAnim.op}` : "全程 animation:none");
  rec("小狗是「从上面落下来」而不是直接出现", dogMoving.length >= 1,
    `中途采样到 ${dogMoving.length} 帧透明度在 0~1 之间：${dogMoving.map((s) => s.op).join(" → ") || "无"}`);
  rec("小狗最终完全显示", dogEnd.op === 1, `opacity=${dogEnd.op}`);

  /* ---------- 2) 首页签到记录卡入场 + 漏签叉号 ---------- */
  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1200);
  const tok = await ev(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }) });
      const j = await r.json();
      return (j && j.data && j.data.token) || "";
    } catch (e) { return ""; }
  })()`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok || "")}); 'ok'`);
  // 刷新回首页：这次是「已登录直接进首页」，走 intro 那条链路（data-enter 只在切路由时触发）
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=home#home` });
  await sleep(140);
  const calSamples = [];
  for (let i = 0; i < 16; i++) {
    calSamples.push(await ev(`(() => {
      const c = document.querySelector('.signcal');
      const s = document.querySelector('.stage');
      if (!c) return null;
      const cs = getComputedStyle(c);
      return { intro: s && (s.dataset.intro || null), op: Math.round(Number(cs.opacity) * 100) / 100,
        anim: cs.animationName, delay: cs.animationDelay, t: Math.round(performance.now()) };
    })()`));
    await sleep(70);
  }
  const calSeen = calSamples.filter(Boolean);
  const calAnim = calSeen.find((s) => s.anim !== "none");
  const calMid = calSeen.filter((s) => s.anim !== "none" && s.op > 0.05 && s.op < 0.99);
  rec("签到记录卡有入场动画", !!calAnim && calAnim.anim === "introRise",
    calAnim ? `${calAnim.anim} delay=${calAnim.delay} @t=${calAnim.t}ms` : "全程 animation:none");
  rec("日历卡动画有位移过渡（不是硬切）", calMid.length >= 1,
    `中途 ${calMid.length} 帧：${calMid.map((s) => s.op).join(" → ") || "无"}`);

  await sleep(1600);
  // QA 账号没绑晚寝，boot 会自动弹「绑定晚寝账号」，截图前先关掉
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(420);
  }
  await sleep(400);
  const cells = await ev(`(() => {
    const all = [...document.querySelectorAll('.signcal__day')];
    const miss = all.filter((e) => e.getAttribute('data-miss') === 'true');
    const ok = all.filter((e) => e.getAttribute('data-ok') === 'true');
    const missWithX = miss.filter((e) => {
      const p = e.querySelector('svg path');
      return !!p && (p.getAttribute('d') || '').split('M').length - 1 === 2;
    }).length;
    const missWithCheck = miss.filter((e) => {
      const p = e.querySelector('svg path');
      return !!p && (p.getAttribute('d') || '').includes('11.8 1');
    }).length;
    const board = document.querySelector('.signcal');
    return {
      okN: ok.length, missN: miss.length, missWithX, missWithCheck,
      okWithCheck: ok.filter((e) => !!e.querySelector('svg')).length,
      opCal: Number(getComputedStyle(board).opacity),
      stroke: miss[0] && miss[0].querySelector('svg path') ? getComputedStyle(miss[0].querySelector('svg path')).stroke : null,
    };
  })()`);
  rec("漏签红格都画了叉号", cells.missN > 0 && cells.missWithX === cells.missN,
    `漏签 ${cells.missN} 个 / 带叉 ${cells.missWithX} 个（带勾 ${cells.missWithCheck} 个）`);
  rec("已签绿格仍是勾，没有混进叉", cells.okN > 0 && cells.okWithCheck === cells.okN, `已签 ${cells.okN} / 带勾 ${cells.okWithCheck}`);
  rec("叉号是墨色描边、圆头", /rgb\(26, 26, 26\)|rgb\(0, 0, 0\)/.test(cells.stroke || ""), `stroke=${cells.stroke}`);
  rec("日历卡最终完全显示", cells.opCal === 1, `opacity=${cells.opCal}`);
  await shot("home-miss-x");

  rec("本轮没有 JS 异常", (await ev(`window.__jsErr || 0`)) === 0, `jsErr=${await ev(`window.__jsErr || 0`)}`);

  console.log(results.join("\n"));
  console.log(`\n${pass}/${pass + fail} 通过`);

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
