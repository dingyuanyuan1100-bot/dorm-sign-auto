// 反馈记录列表「已回复」卡片：长回复横向溢出复现 / 修复验收
//   node qa/reply_list_overflow.cjs
// 本地 dist + 真 token，只拦 /api/feedback 列表返回一条 replied 样本（用线上 id 26 的真实回复文案）
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const DIST = path.resolve(__dirname, "..", "dorm-app", "dist");
const PORT = 5291;
const CDP = 9970 + Math.floor(Math.random() * 25);
const BASE = "https://www.wuxianshitu.icu";
const QA_USER = "qacheck_1793717807", QA_PASS = "Qa123456";
const REPLY = "已收到你的反馈，内容与截图我们已查看。这条记录暂未描述具体问题，若使用中遇到异常，麻烦补充出现问题的页面、操作步骤和现象，我们会尽快核实处理。";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEMS = [
  { id: 26, code: "FB-20261112-0001", type: "功能异常", content: "测试111", image_count: 1,
    status: "replied", reply: REPLY, created_at: "2026-11-12 17:58:26", replied_at: "2026-11-12 17:59:49" },
  { id: 18, code: "FB-20261107-0018", type: "功能异常", content: "测试45454", image_count: 3,
    status: "pending", reply: null, created_at: "2026-11-07 22:08:04", replied_at: null },
];
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
  const token = (await lr.json())?.data?.token || "";
  rec("域名登录拿到真 token", lr.status === 200 && !!token);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "rlo-"));
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
     `--user-data-dir=${prof}`, `--remote-debugging-port=${CDP}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map(); const errs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") errs.push(d.params.exceptionDetails?.exception?.description || "exception");
    if (d.method === "Fetch.requestPaused") onPaused(d.params);
    if (d.id && wait.has(d.id)) { const q = wait.get(d.id); wait.delete(d.id); d.error ? q.rej(new Error(JSON.stringify(d.error))) : q.res(d.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const until = async (expr, ms = 9000) => { for (let i = 0; i < ms / 150; i++) { if (await ev(expr)) return true; await sleep(150); } return false; };

  function onPaused(p) {
    const origin = p.request.headers.Origin || p.request.headers.origin || "*";
    const cors = [
      { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
    ];
    if (p.request.method === "OPTIONS") {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" });
      return;
    }
    const pathname = new URL(p.request.url).pathname;
    const isList = pathname === "/api/feedback";
    const payload = isList
      ? { success: true, msg: "ok", data: { total: 2, pending: 1, items: ITEMS } }
      : { success: true, msg: "ok", data: ITEMS[0] };
    send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200,
      responseHeaders: [...cors, { name: "Content-Type", value: "application/json; charset=utf-8" }],
      body: Buffer.from(JSON.stringify(payload)).toString("base64") });
  }

  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://www.wuxianshitu.icu/api/feedback*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?flat=1` });
  await until(`document.readyState === 'complete'`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(token)}); 'ok'`);
  await send("Page.reload", { ignoreCache: true });
  rec("登录态主界面挂载", await until(`document.querySelector('.app')?.getAttribute('data-show') === 'true'`));
  await sleep(800);
  await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) b.click(); return 'ok'; })()`);
  await sleep(250);
  await ev(`(() => { const row = document.querySelector('.listrow[data-key="feedback"]'); const b = row && row.querySelector('.listrow__value'); if (b) b.click(); return !!b; })()`);
  await until(`!!document.querySelector('.fb')`);
  await ev(`document.querySelector('.fb__record')?.click(); 'ok'`);
  rec("进入反馈记录列表", await until(`document.querySelectorAll('.fb__rec').length === 2`));
  await sleep(400);

  const m = await ev(`(() => {
    const card = document.querySelector('.fb__rec');
    const e = document.querySelector('.fb__rreply');
    if (!card || !e) return null;
    const cr = card.getBoundingClientRect(), er = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      cardW: cr.width, cardRight: cr.right,
      boxW: er.width, boxLeft: er.left, boxRight: er.right,
      scrollW: e.scrollWidth, clientW: e.clientWidth,
      whiteSpace: cs.whiteSpace, overflow: cs.overflow, textOverflow: cs.textOverflow,
      docScrollW: document.documentElement.scrollWidth, viewport: window.innerWidth,
      text: e.textContent.trim().slice(0, 18),
    };
  })()`);
  console.log("\n实测：", JSON.stringify(m, null, 2), "\n");

  rec("回复文本被单行省略号裁剪", !!m && m.overflow === "hidden" && m.textOverflow === "ellipsis" && m.whiteSpace === "nowrap",
    m ? `overflow=${m.overflow} textOverflow=${m.textOverflow} whiteSpace=${m.whiteSpace}` : "null");
  rec("回复盒子不超出卡片", !!m && m.boxRight <= m.cardRight - 10, m ? `boxRight=${m.boxRight} cardRight=${m.cardRight}` : "null");
  rec("页面无横向滚动", !!m && m.docScrollW <= m.viewport + 1, m ? `doc=${m.docScrollW} viewport=${m.viewport}` : "null");
  rec("处理中卡片仍显示「预计 1 个工作日内回复」", await ev(`[...document.querySelectorAll('.fb__rwait')].some(e => e.textContent.includes('预计 1 个工作日内回复'))`));
  rec("零 JS 异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, "reply_list_overflow.png"), Buffer.from(shot.data, "base64"));
  console.log(`\n结果 ${pass}/${pass + fail} 通过`);
  ws.close(); chrome.kill(); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
