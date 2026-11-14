/* 线上更新检测验收（https://175.24.230.58）
   1) 清单与客户端同为 2.0.9 → 手动检查应提示「已是最新」
   2) 拦截 /update/version.json 返回 2.1.0 / 23 → 启动自动检测应弹更新层
   用法: node qa/live_update.cjs */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9391;
const BASE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "live");
const USER = "qacheck_1793717807", PASS = "Qa123456";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = JSON.stringify({
  version: "2.1.0", versionCode: 23,
  url: "https://175.24.230.58/update/dorm-sign-2.0.9-release.apk",
  size: "3.4 MB", force: false, publishedAt: "2026-11-05",
  notes: ["线上更新链路验收（模拟）"],
});

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lvu-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map(); const errs = [];
  let fakeManifest = false;

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (fakeManifest && request.url.includes("/update/version.json")) {
        send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json; charset=utf-8" },
            { name: "Cache-Control", value: "no-store" },
          ],
          body: Buffer.from(FAKE, "utf8").toString("base64"),
        }).catch(() => {});
      } else {
        send("Fetch.continueRequest", { requestId }).catch(() => {});
      }
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
  const sheetDump = async () => JSON.parse(await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({
      open: !!s,
      title: s?.querySelector(".sheet__title")?.innerText || "",
      vers: [...(s?.querySelectorAll(".update__v") || [])].map(v => v.innerText),
      btns: [...(s?.querySelectorAll(".sheet__btn") || [])].map(b => b.innerText.trim()),
      toast: document.querySelector(".toast__text")?.innerText || "",
    });
  })()`));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  // 登录拿 token 后注入
  const token = await evalJs(`(async () => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
    const j = await r.json(); return j?.data?.token || "";
  })()`);
  if (!token) { console.log("LOGIN_FAILED"); process.exit(1); }
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("dorm.token","${token}");localStorage.removeItem("dorm.update.snoozed")}catch(e){}`,
  });
  await send("Page.navigate", { url: BASE });
  await sleep(5200);

  // 首屏：清单 2.0.2 = 本地 2.0.2，不应弹更新
  console.log("FIRST_SCREEN", JSON.stringify(await sheetDump()));

  // 关掉自动绑定层
  await evalJs(`(() => { const b=[...document.querySelectorAll("button")].find(x=>(x.innerText||"").trim()==="取消"); b?.click(); return 1; })()`);
  await sleep(600);

  // 我的 → 关于 → 检查更新
  await evalJs(`(() => { const n=[...document.querySelectorAll(".nav__item")].find(x=>x.getAttribute("aria-label")==="我的"); n?.click(); return 1; })()`);
  await sleep(800);
  await evalJs(`(() => { const b=document.querySelector('[data-key="about"] .listrow__value'); b?.click(); return 1; })()`);
  await sleep(800);
  const about = await sheetDump();
  console.log("ABOUT", JSON.stringify(about));

  await evalJs(`(() => {
    const s=[...document.querySelectorAll(".sheet")].pop();
    const b=[...(s?.querySelectorAll(".sheet__btn")||[])].find(x=>(x.innerText||"").trim().startsWith("检查更新"));
    b?.click(); return 1;
  })()`);
  await sleep(2200);
  console.log("LATEST_CHECK", JSON.stringify(await sheetDump()));
  await shot("04-live-latest-390x844.png");

  // 关掉关于层，开启拦截，重载验证「发现新版本」
  await evalJs(`(() => {
    const s=[...document.querySelectorAll(".sheet")].pop();
    [...(s?.querySelectorAll(".sheet__btn")||[])].find(x=>(x.innerText||"").trim()==="知道了")?.click();
    return 1;
  })()`);
  await sleep(500);

  fakeManifest = true;
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/update/version.json*" }] });
  await send("Page.reload");
  await sleep(5200);
  console.log("FAKE_PROMPT", JSON.stringify(await sheetDump()));
  await shot("05-live-new-version-390x844.png");

  console.log("DIAG", await evalJs(`(() => {
    const t = (localStorage.getItem("dorm.token") || "");
    return JSON.stringify({ tokenTail: t.slice(-6), hasNav: !!document.querySelector(".nav"),
      loginShown: document.querySelector(".login-layer")?.dataset.show,
      hash: location.hash, bootSplash: !!document.querySelector("#boot-splash") });
  })()`));
  console.log("SNOOZE", await evalJs(`localStorage.getItem("dorm.update.snoozed")`));
  console.log("ERRORS", errs.length ? errs.slice(0, 4).join(" / ") : "none");
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
