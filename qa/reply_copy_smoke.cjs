// 2.0.15-beta2 文案验收：反馈详情「官方回复」卡片底部小字
//   node qa/reply_copy_smoke.cjs
// 用本地 dist + 真 token，只拦截 /api/feedback 返回一条 pending 样本，
// 其余接口放行到线上，保证是真实登录态下的真实渲染。不写任何线上数据。
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const DIST = path.resolve(__dirname, "..", "dorm-app", "dist");
const PORT = 5288;
const CDP = 9940 + Math.floor(Math.random() * 30);
const BASE = "https://www.wuxianshitu.icu";
const QA_USER = "qacheck_1793717807", QA_PASS = "Qa123456";
const NEW_COPY = "回复后可在反馈记录里查看";
const OLD_COPY = "处理结果会推送到站内消息";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PENDING_REC = {
  id: 901,
  code: "FB-20261112-0901",
  type: "功能异常",
  content: "签到记录日历看不了上个月的记录，切月之后还是本月。",
  image_count: 0,
  status: "pending",
  reply: null,
  created_at: "2026-11-12 21:03:00",
  replied_at: null,
  images: [],
};

let pass = 0, fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`);
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

(async () => {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    let f = path.join(DIST, p === "/" ? "index.html" : p);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const lr = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  });
  const lj = await lr.json();
  const token = lj?.data?.token || "";
  rec("域名登录拿到真 token", lr.status === 200 && !!token, "HTTP " + lr.status);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "rcp-"));
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
     `--user-data-dir=${prof}`, `--remote-debugging-port=${CDP}`, "about:blank"],
    { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  const errs = [];
  const intercepted = [];

  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails?.exception?.description || "exception");
    if (d.method === "Fetch.requestPaused") onPaused(d.params);
    if (d.id && wait.has(d.id)) {
      const q = wait.get(d.id); wait.delete(d.id);
      d.error ? q.rej(new Error(JSON.stringify(d.error))) : q.res(d.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const until = async (expr, ms = 9000) => {
    for (let i = 0; i < ms / 150; i++) { if (await ev(expr)) return true; await sleep(150); }
    return false;
  };

  function onPaused(p) {
    const origin = p.request.headers.Origin || p.request.headers.origin || "*";
    const cors = [
      { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
      { name: "Access-Control-Max-Age", value: "600" },
    ];
    if (p.request.method === "OPTIONS") {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" });
      return;
    }
    const pathname = new URL(p.request.url).pathname;
    const isList = pathname === "/api/feedback";
    const isDetail = /^\/api\/feedback\/\d+$/.test(pathname);
    const payload = isList
      ? { success: true, msg: "ok", data: { total: 1, pending: 1, items: [PENDING_REC] } }
      : { success: true, msg: "ok", data: PENDING_REC };
    const body = Buffer.from(JSON.stringify(isList || isDetail ? payload : { success: true, msg: "ok", data: {} })).toString("base64");
    intercepted.push(p.request.method + " " + pathname);
    send("Fetch.fulfillRequest", {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [...cors, { name: "Content-Type", value: "application/json; charset=utf-8" }],
      body,
    });
  }

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://www.wuxianshitu.icu/api/feedback*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?flat=1` });
  await until(`document.readyState === 'complete'`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(token)}); 'ok'`);
  await send("Page.reload", { ignoreCache: true });
  rec("登录态主界面挂载", await until(`document.querySelector('.app')?.getAttribute('data-show') === 'true'`));
  await sleep(900);
  // QA 账号未绑定晚寝账号时会自动弹绑定层，会盖住详情下半屏；先关掉再验收视觉
  await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return 'closed'; } return 'none'; })()`);
  await sleep(300);

  const opened = await ev(`(() => { const row = document.querySelector('.listrow[data-key="feedback"]'); const b = row && row.querySelector('.listrow__value'); if (b) b.click(); return !!b; })()`);
  rec("打开意见反馈浮层", opened && await until(`!!document.querySelector('.fb')`), String(opened));

  await ev(`document.querySelector('.fb__record')?.click(); 'ok'`);
  rec("进入反馈记录列表", await until(`document.querySelectorAll('.fb__rec').length > 0`));
  await ev(`document.querySelector('.fb__rec')?.click(); 'ok'`);
  rec("进入反馈详情（未回复态）", await until(`document.querySelector('.fb')?.getAttribute('data-step') === 'detail' && !!document.querySelector('.fbd__card--reply')`));
  await sleep(400);

  const copy = await ev(`document.querySelector('.fbd__replyat')?.textContent.trim()`);
  rec("底部小字为新文案", copy === NEW_COPY, JSON.stringify(copy));
  rec("页面无旧文案残留", !(await ev(`document.body.innerText.includes(${JSON.stringify(OLD_COPY)})`)));
  rec("进度条为待接手 / 待回复", await ev(`(() => { const a=[...document.querySelectorAll('.fbd__step')].map(e=>e.textContent.trim()); return a.some(x=>x.includes('待接手')) && a.some(x=>x.includes('待回复')); })()`));

  const box = await ev(`(() => { const e=document.querySelector('.fbd__replyat'); if(!e) return null; const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); return { w:r.width,h:r.height,left:r.left,top:r.top,scrollW:e.scrollWidth,clientW:e.clientWidth,color:cs.color,fontSize:cs.fontSize,vis:cs.visibility,op:cs.opacity }; })()`);
  rec("小字可见且无横向溢出", !!box && box.vis === "visible" && +box.op > 0 && box.scrollW <= box.clientW + 1 && box.w <= 322, box ? `w=${box.w} scrollW=${box.scrollW} color=${box.color} ${box.fontSize}` : "null");
  rec("小字在回复卡片范围内", !!box && box.top >= 0 && box.top < 844, box ? `top=${box.top}` : "null");
  rec("拦截到反馈列表与详情请求", intercepted.some((x) => x === "GET /api/feedback") && intercepted.some((x) => /GET \/api\/feedback\/\d+/.test(x)), intercepted.join(" | "));
  rec("零 JS 异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, "reply_copy_smoke.png"), Buffer.from(shot.data, "base64"));

  console.log(`\n结果 ${pass}/${pass + fail} 通过`);
  ws.close(); chrome.kill(); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
