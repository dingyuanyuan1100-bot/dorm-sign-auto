// 验收本轮 4 个视觉问题：
//   1) 日历铅笔不再模糊（资源 4x、naturalWidth 256）
//   2) 反馈详情标题/正文不再重复（见 fb_detail.cjs detail 模式）
//   3) 上传截图压缩档位 720→1600
//   4) 反馈记录标题靠左
//   QA_PORT=5299 node qa/fix4.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9710 + Math.floor(Math.random() * 30);
const WEB = Number(process.env.QA_PORT || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const USER = "qacheck_1793717807";
const PASS = "Qa123456";
const UP = path.resolve(__dirname, "assets/upload-1440x3200.png");
const OUT = path.resolve(__dirname, "fbx");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let pass = 0;
let fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "fx4-"));
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
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__jsErr=0;window.addEventListener('error',()=>window.__jsErr++);" });

  /* 首页要看到日历卡才有铅笔：QA 账号没有任务，用固定样本补一条任务 + 两条日志 */
  const d2 = (n) => String(n).padStart(2, "0");
  const nowD = new Date();
  const stamp = (day, h, mi) => `${nowD.getFullYear()}-${d2(nowD.getMonth() + 1)}-${d2(day)} ${d2(h)}:${d2(mi)}:05`;
  const LOC = { id: 2, name: "3 号公寓 · 502", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
  const TASK = { id: 37, sign_time: "23:30", mode: "daily", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: true, status: "waiting" };
  const LOGS = [1, 2].map((d, i) => ({ id: 900 + i, schedule_id: 37, run_at: stamp(d, 23, 30), success: true, detail: "scheduled", msg: "auto · 签到成功" }));
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }] });
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
    if (process.env.QA_DEBUG) console.log("paused", p.request.method, u.pathname);
    if (p.request.method === "OPTIONS") {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" }).catch(() => {});
      return;
    }
    let payload = null;
    if (u.pathname === "/api/schedules") payload = { success: true, msg: "ok", data: [TASK] };
    if (u.pathname === "/api/logs") payload = { success: true, msg: "ok", data: LOGS };
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

  /* ---------- 1) 日历铅笔 ---------- */
  if (process.env.QA_DEBUG) console.log("token?", (await ev(`!!localStorage.getItem('dorm.token')`)));
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=home#home` });
  for (let i = 0; i < 20; i++) {
    if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(600);
  }
  await sleep(2200);

  const pen = await ev(`(() => {
    const img = document.querySelector('.signcal__art');
    if (!img) return null;
    const cs = getComputedStyle(img);
    const card = document.querySelector('.signcal');
    const r = img.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return { nw: img.naturalWidth, nh: img.naturalHeight, fit: cs.objectFit,
      x: Math.round(r.left - cr.left), y: Math.round(r.top - cr.top), w: Math.round(r.width), h: Math.round(r.height),
      dpr: window.devicePixelRatio };
  })()`);
  rec("铅笔资源按 4x 导出（256×231）", pen && pen.nw === 256 && pen.nh === 231, pen ? `${pen.nw}×${pen.nh}` : "找不到 .signcal__art");
  rec("铅笔按 contain 放进 64 框、位置 270/138", pen && pen.fit === "contain" && pen.x === 270 && pen.y === 138 && pen.w === 64 && pen.h === 64,
    pen ? `fit=${pen.fit} ${pen.x}/${pen.y} ${pen.w}×${pen.h}` : "-");
  rec("2x 屏幕上用的像素数 ≥128", pen && pen.nw >= 128 && pen.dpr >= 2, pen ? `DPR=${pen.dpr} 源宽=${pen.nw}` : "-");
  await shot("home-pencil");

  /* ---------- 4) 记录卡标题靠左 ---------- */
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=me#me` });
  for (let i = 0; i < 20; i++) {
    if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(600);
  }
  await sleep(1600);
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(400);
  }
  await ev(`(() => { const b = document.querySelector('.listrow[data-key="feedback"] .listrow__value'); b && b.click(); return !!b; })()`);
  await sleep(1000);
  await ev(`(document.querySelector('.fb__record') || { click() {} }).click(); 'ok'`);
  for (let i = 0; i < 12; i++) {
    if ((await ev(`document.querySelectorAll('.fb__rec').length`)) > 0) break;
    await sleep(600);
  }
  const rows = await ev(`(() => {
    const card = document.querySelector('.fb__rec');
    if (!card) return null;
    const cr = card.getBoundingClientRect();
    const title = card.querySelector('.fb__rtitle');
    const tag = card.querySelector('.fb__tag');
    const t = title.getBoundingClientRect(), g = tag.getBoundingClientRect();
    return {
      titleX: Math.round(t.left - cr.left), tagX: Math.round(g.left - cr.left),
      titleW: Math.round(t.width), tagW: Math.round(g.width),
      align: getComputedStyle(title).textAlign, recAlign: getComputedStyle(card).textAlign,
      text: title.textContent.trim(),
    };
  })()`);
  rec("记录卡标题左对齐到 18（与类型标签同列）", rows && rows.titleX === 18 && rows.tagX === 18,
    rows ? `标题=${rows.titleX} 标签=${rows.tagX}` : "没有记录卡");
  rec("记录卡文本不再居中", rows && rows.align === "left" && rows.recAlign === "left",
    rows ? `title=${rows.align} card=${rows.recAlign}` : "-");
  await shot("records-left");

  /* ---------- 3) 上传截图压缩档位 ---------- */
  // 记录页点返回回到表单，附件输入就在当前文档里
  await ev(`(document.querySelector('.fb__back') || { click() {} }).click(); 'ok'`);
  await sleep(1000);
  rec("反馈表单已打开", (await ev(`!!document.querySelector('.fb__upload input[type="file"]')`)) === true, "");

  let fileSet = false;
  for (let k = 0; k < 3 && !fileSet; k++) {
    try {
      const doc = await send("DOM.getDocument", { depth: -1 });
      const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
      if (!q.nodeId) { await sleep(500); continue; }
      await send("DOM.setFileInputFiles", { nodeId: q.nodeId, files: [UP] });
      fileSet = true;
    } catch (e) {
      await sleep(600);
    }
  }
  rec("找到附件文件输入并选中样图", fileSet, fileSet ? path.basename(UP) : "设置失败");
  for (let i = 0; i < 20; i++) {
    if ((await ev(`document.querySelectorAll('.fb__shot img').length`)) > 0) break;
    await sleep(400);
  }
  const up = await ev(`(() => {
    const img = document.querySelector('.fb__shot img');
    if (!img) return null;
    return { nw: img.naturalWidth, nh: img.naturalHeight, len: img.src.length, head: img.src.slice(0, 22) };
  })()`);
  rec("1440×3200 截图压到 1600 长边（720×1600）", up && up.nw === 720 && up.nh === 1600,
    up ? `${up.nw}×${up.nh}（旧版是 324×720）` : "没有缩略图");
  rec("单张 base64 体积在预算内", up && up.len > 20000 && up.len < 900000, up ? `${Math.round(up.len / 1024)} KB` : "-");
  await shot("upload-hi");

  rec("本轮没有 JS 异常", (await ev(`window.__jsErr || 0`)) === 0, `jsErr=${await ev(`window.__jsErr || 0`)}`);

  console.log(results.join("\n"));
  console.log(`\n${pass}/${pass + fail} 通过`);

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
