/* 更新弹层文案截图（线上资源 + 拦截清单，仅用于确认「更新说明」不再暴露内部细节）
   用法: node qa/sheet_notes.cjs */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9800 + Math.floor(Math.random() * 150);
const BASE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "live");
const USER = "qacheck_1793717807", PASS = "Qa123456";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const real = await (await fetch(`${BASE}update/version.json?t=${Date.now()}`)).json();
  const FAKE = JSON.stringify({ ...real, version: "2.0.8", versionCode: 21 });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sn-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
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
      if (request.url.includes("/update/version.json")) {
        send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" },
            { name: "Access-Control-Allow-Origin", value: "*" }],
          body: Buffer.from(FAKE, "utf8").toString("base64"),
        }).catch(() => {});
      } else send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  };
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/update/version.json*" }] });

  const token = await evalJs(`(async () => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
    return (await r.json())?.data?.token || "";
  })()`);
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("dorm.token","${token}");localStorage.removeItem("dorm.update.snoozed")}catch(e){}`,
  });
  await send("Page.navigate", { url: BASE });
  await sleep(5600);
  // 先关掉「绑定晚寝账号」自动弹层（「取消」），只留更新层
  await evalJs(`(() => { [...document.querySelectorAll(".sheet__btn")].find(x=>(x.innerText||"").trim()==="取消")?.click(); return 1; })()`);
  await sleep(500);
  const dump = await evalJs(`(() => {
    const s=[...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({
      title: s?.querySelector(".sheet__title")?.innerText || "",
      desc: s?.querySelector(".sheet__desc")?.innerText || "",
      notes: [...document.querySelectorAll(".update__notes li")].map(x=>x.innerText.trim()),
      vers: [...document.querySelectorAll(".update__v")].map(v=>v.innerText),
    });
  })()`);
  console.log("SHEET", dump);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "21-notes-390x844.png"), Buffer.from(shot.data, "base64"));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
