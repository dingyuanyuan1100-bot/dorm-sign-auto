// 新版前端（dist）真实浏览器验收：确认 API 请求打向备案域名且能登录
//   node qa/bundle_smoke.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DIST = path.resolve(__dirname, "..", "dorm-app", "dist");
const PORT = 5277;
const CDP = 9910 + Math.floor(Math.random() * 30);
const BASE = "https://www.wuxianshitu.icu";
const QA_USER = "qacheck_1793717807", QA_PASS = "Qa123456";
const DOMAIN = "https://www.wuxianshitu.icu";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`);
};

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

(async () => {
  // 1) 本地静态服务，serve 刚构建的 dist（SPA fallback）
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    let f = path.join(DIST, p === "/" ? "index.html" : p);
    if (!f.startsWith(DIST)) f = path.join(DIST, "index.html");
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream",
                         "Cache-Control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  // 2) 取真实登录态
  const lr = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  });
  const lj = await lr.json();
  const token = lj?.data?.token || "";
  rec("域名登录拿到 token", lr.status === 200 && !!token, "HTTP " + lr.status);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "bnd-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--no-proxy-server", "--ignore-certificate-errors", `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  const apiReqs = [], apiResp = {}, errs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Network.requestWillBeSent") {
      const u = m.params.request.url;
      if (u.includes("/api/")) apiReqs.push(u);
    }
    if (m.method === "Network.responseReceived") {
      const u = m.params.response.url;
      if (u.includes("/api/")) apiResp[u] = m.params.response.status;
    }
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description || "exception");
    if (m.id && wait.has(m.id)) { const q = wait.get(m.id); wait.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const until = async (expr, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(200); }
    return false;
  };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  rec("新版前端渲染登录卡", await until(`document.querySelector('.login') !== null || document.body.innerText.includes('晚寝签到')`));

  // 注入真实 token 后重载，触发 warmLink /api/auth/me
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(token)}); true`);
  await send("Page.reload", { ignoreCache: true });
  await until(`document.readyState === 'complete'`);
  await sleep(2500);

  rec("产生了 /api 请求", apiReqs.length > 0, apiReqs.length + " 个");
  const wrong = apiReqs.filter((u) => !u.startsWith(DOMAIN + "/api/"));
  rec("所有 API 请求指向备案域名", wrong.length === 0,
    wrong.length ? wrong.slice(0, 2).join(" | ") : apiReqs[0]);
  const okResp = Object.entries(apiResp).filter(([u, s]) => u.startsWith(DOMAIN + "/api/") && s === 200);
  rec("域名接口返回 200", okResp.length > 0, okResp.length + " 个 200");
  rec("没有残留 IP 直连", !apiReqs.some((u) => u.includes("175.24.230.58")));
  rec("无 JS 异常", errs.length === 0, errs.slice(0, 2).join(" | "));

  console.log(`验收结果：${pass}/${pass + fail} 通过`);
  ws.close(); chrome.kill(); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
