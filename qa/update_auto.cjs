/* 自动更新检测回归（生产构建 + 本地预览，跨域分支等同原生壳）
   用法: node qa/update_auto.cjs [port]
   1) 干净存储 + 清单 2.0.8(21) → 不做任何操作，6s 内应自动弹更新层
   2) 预置「稍后再说」记录(21) + 清单 2.0.8 → 自动不弹；手动检查应弹并清掉记录
   3) 首检返回 500 → 12s 兜底重试应发出第二次请求
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9500 + Math.floor(Math.random() * 300);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5295}/`;
const OUT = path.join(__dirname, "live");
const API = "https://175.24.230.58";
const USER = "qacheck_1793717807", PASS = "Qa123456";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = JSON.stringify({
  version: "2.0.8", versionCode: 21,
  url: `${API}/update/dorm-sign-2.0.7-release.apk`,
  size: "3.4 MB", force: false, publishedAt: "2026-11-06",
  notes: ["自动更新检测回归（模拟）"],
});

(async () => {
  const tokRes = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const token = (await tokRes.json())?.data?.token || "";
  if (!token) { console.log("LOGIN_FAILED"); process.exit(1); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "au-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  if (!up) { console.log("CHROME_FAILED"); process.exit(2); }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pend = new Map();
  const errs = [];
  let mode = "none";   // none | fake | fail
  let hits = [];

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (request.url.includes("/update/version.json")) {
        hits.push({ at: Date.now() - t0, url: request.url.slice(0, 60) });
        if (mode === "fake") {
          send("Fetch.fulfillRequest", {
            requestId, responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/json; charset=utf-8" },
              { name: "Access-Control-Allow-Origin", value: "*" },
            ],
            body: Buffer.from(FAKE, "utf8").toString("base64"),
          }).catch(() => {});
          return;
        }
        if (mode === "fail") {
          send("Fetch.fulfillRequest", {
            requestId, responseCode: 500,
            responseHeaders: [{ name: "Access-Control-Allow-Origin", value: "*" }],
            body: Buffer.from("{}", "utf8").toString("base64"),
          }).catch(() => {});
          return;
        }
      }
      send("Fetch.continueRequest", { requestId }).catch(() => {});
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails.exception?.description || "").slice(0, 160));
    }
  };

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
  };
  const sheet = async () => JSON.parse(await evalJs(`(() => {
    const all = [...document.querySelectorAll(".sheet")];
    const s = all.pop();
    const uv = document.querySelector(".update__v--new");
    return JSON.stringify({
      open: !!s,
      updateOpen: !!uv,
      titles: all.map(x => x.querySelector(".sheet__title")?.innerText || ""),
      title: s?.querySelector(".sheet__title")?.innerText || "",
      vers: [...document.querySelectorAll(".update__v")].map(v => v.innerText),
      toast: document.querySelector(".toast__text")?.innerText || "",
    });
  })()`));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/update/version.json*" }] });

  const seed = (extra = "") =>
    send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try{localStorage.setItem("dorm.token","${token}");${extra}}catch(e){}`,
    });

  /* ---------- 1) 干净存储：应该自动弹 ---------- */
  await seed(`localStorage.removeItem("dorm.update.snoozed");`);
  mode = "fake";
  let t0 = Date.now();
  await send("Page.navigate", { url: WEB });
  await sleep(6500);
  const r1 = await sheet();
  console.log("AUTO_PROMPT", JSON.stringify(r1));
  console.log("AUTO_HITS", JSON.stringify(hits));
  await shot("11-auto-prompt-390x844.png");
  const autoOk = r1.updateOpen && r1.vers.includes("v2.0.8");
  hits = [];

  /* ---------- 2) 有「稍后再说」记录：自动不弹，手动弹 ---------- */
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await seed(`localStorage.setItem("dorm.update.snoozed", JSON.stringify({code:21, at:Date.now()}));`);
  mode = "fake";
  t0 = Date.now();
  await send("Page.navigate", { url: WEB });
  await sleep(7000);
  const r2auto = await sheet();
  console.log("SNOOZE_AUTO", JSON.stringify(r2auto));

  // 手动：我的 → 关于 → 检查更新
  await evalJs(`(() => { document.querySelector('.scrim')?.click(); const n=[...document.querySelectorAll(".nav__item")].find(x=>x.getAttribute("aria-label")==="我的"); n?.click(); return 1; })()`);
  await sleep(900);
  await evalJs(`(() => { document.querySelector('[data-key="about"] .listrow__value')?.click(); return 1; })()`);
  await sleep(700);
  await evalJs(`(() => {
    const s=[...document.querySelectorAll(".sheet")].pop();
    [...(s?.querySelectorAll(".sheet__btn")||[])].find(x=>(x.innerText||"").trim()==="检查更新")?.click();
    return 1;
  })()`);
  await sleep(2500);
  const r2manual = await sheet();
  const snoozeLeft = await evalJs(`localStorage.getItem("dorm.update.snoozed")`);
  console.log("SNOOZE_MANUAL", JSON.stringify(r2manual), "snoozeAfter=", snoozeLeft);
  await shot("12-manual-prompt-390x844.png");

  /* ---------- 3) 首检失败 → 12s 兜底重试 ---------- */
  await send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await seed(`localStorage.removeItem("dorm.update.snoozed");`);
  mode = "fail";
  hits = [];
  t0 = Date.now();
  await send("Page.navigate", { url: WEB });
  await sleep(15000);
  const hitCount = hits.length;
  console.log("RETRY_HITS", JSON.stringify(hits));
  console.log("RETRY_COUNT", hitCount);
  const r3 = await sheet();
  console.log("RETRY_SHEET", JSON.stringify(r3));
  console.log("ERRORS", errs.length ? errs.slice(0, 3).join(" / ") : "none");
  console.log("VERDICT", JSON.stringify({
    auto: autoOk,
    snoozeAutoSilent: !r2auto.updateOpen,
    manualWorks: r2manual.updateOpen && r2manual.vers.includes("v2.0.8"),
    snoozeCleared: !snoozeLeft,
    retried: hitCount >= 2,
  }));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
