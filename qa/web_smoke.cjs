// 线上网页端冒烟：直接打开 https://175.24.230.58/（自签证书，忽略校验）
//   node qa/web_smoke.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9860 + Math.floor(Math.random() * 30);
const SITE = process.env.QA_SITE || "https://175.24.230.58/";
const OUT = path.resolve(__dirname, "fbx");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--no-proxy-server", "--ignore-certificate-errors", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  const errs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description || "exception");
    if (m.method === "Network.loadingFailed") errs.push(`netfail ${m.params.errorText} ${m.params.blockedReason || ""}`);
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
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: SITE });
  await sleep(2600);

  const basic = await ev(`(() => ({
    title: document.title,
    loginCard: !!document.querySelector('.login__card'),
    dog: !!document.querySelector('.login__dog'),
    stage: !!document.querySelector('.stage'),
    titleText: (document.querySelector('.login__title') || {}).textContent || null,
  }))()`);
  rec("网页端能起来（登录卡渲染）", basic && basic.loginCard === true && basic.dog === true, JSON.stringify(basic));

  // 登录一次，确认接口链路通
  const login = await ev(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }) });
      const j = await r.json();
      return { ok: r.status, hasToken: !!(j && j.data && j.data.token) };
    } catch (e) { return { err: String(e && e.message || e) }; }
  })()`);
  rec("线上 /api 可用", login && login.hasToken === true, JSON.stringify(login));

  const ver = await ev(`(async () => {
    const r = await fetch("/update/version.json", { cache: "no-store" });
    const j = await r.json();
    return { version: j.version, code: j.versionCode, notes: (j.notes || []).length };
  })()`);
  rec("网页端能读到新版本清单", ver && ver.version === "2.0.14" && ver.code === 55, JSON.stringify(ver));

  const notice = await ev(`(async () => {
    const r = await fetch("/update/notice.json", { cache: "no-store" });
    const j = await r.json();
    return { id: j.id, items: (j.items || []).length, title: j.title };
  })()`);
  rec("公告已是新版", notice && notice.id === "20261107a" && notice.items === 6, JSON.stringify(notice));

  rec("页面没有 JS 异常/资源加载失败", errs.length === 0, errs.slice(0, 2).join(" | "));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "web-live.png"), Buffer.from(shot.data, "base64"));

  console.log(`\n${pass}/${pass + fail} 通过`);
  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
