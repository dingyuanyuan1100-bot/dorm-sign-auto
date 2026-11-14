/* 旧服务器关闭影响面实测
   —— 把 47.116.135.24 解析到黑洞地址（等同它已关机/不可达），跑完整启动 + 自动更新检查
   —— 统计全部网络请求，确认没有任何一条打到旧地址
   用法: node qa/oldserver_check.cjs */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9600 + Math.floor(Math.random() * 200);
const BASE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "live");
const USER = "qacheck_1793717807", PASS = "Qa123456";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const real = await (await fetch(`${BASE}update/version.json?t=${Date.now()}`)).json();
  const FAKE = JSON.stringify({ ...real, version: "2.0.8", versionCode: 21 });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "os-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
    // 旧服务器「关机」：解析到 127.0.0.1 的未监听端口，连接必失败
    "--host-resolver-rules=MAP 47.116.135.24 127.0.0.1",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

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
  const reqs = [];
  const failed = [];
  let fake = true;

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
    if (m.method === "Network.requestWillBeSent") {
      reqs.push(m.params.request.url);
    }
    if (m.method === "Network.loadingFailed") {
      failed.push(m.params.errorText);
    }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (fake && request.url.includes("/update/version.json")) {
        send("Fetch.fulfillRequest", {
          requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" },
            { name: "Access-Control-Allow-Origin", value: "*" }],
          body: Buffer.from(FAKE, "utf8").toString("base64"),
        }).catch(() => {});
      } else send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
  };

  const evalJs = async (expr) =>
    (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/update/version.json*" }] });

  // 先在站内拿 token（about:blank 上相对路径 fetch 会失败），再注入并重载
  await send("Page.navigate", { url: BASE });
  await sleep(2500);
  const token = await evalJs(`(async () => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
    return (await r.json())?.data?.token || "";
  })()`);
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("dorm.token","${token}");localStorage.removeItem("dorm.update.snoozed")}catch(e){}`,
  });
  await send("Page.reload");
  reqs.length = 0;
  await sleep(7000);

  const sheet = await evalJs(`(() => {
    const uv = document.querySelector(".update__v--new");
    return JSON.stringify({
      updateOpen: !!uv,
      vers: [...document.querySelectorAll(".update__v")].map(v => v.innerText),
      nav: !!document.querySelector(".nav"),
      toast: document.querySelector(".toast__text")?.innerText || "",
    });
  })()`);

  // 点「立即更新」，看实际打开的下载地址解析到哪
  const dl = await evalJs(`(() => {
    const b=[...document.querySelectorAll(".sheet__btn")].find(x=>(x.innerText||"").trim()==="立即更新");
    if(!b) return "NO_BTN";
    b.click();
    return "clicked";
  })()`);
  await sleep(1200);

  const oldHits = reqs.filter((u) => /47\.116\.135\.24|:8805/.test(u));
  const hosts = [...new Set(reqs.map((u) => {
    try { return new URL(u).host; } catch { return u.slice(0, 30); }
  }))].sort();

  console.log("SHEET", sheet);
  console.log("DL", dl);
  console.log("REQ_TOTAL", reqs.length);
  console.log("HOSTS", JSON.stringify(hosts));
  console.log("OLD_SERVER_HITS", oldHits.length ? JSON.stringify(oldHits.slice(0, 5)) : "none");
  console.log("FAILED", failed.length ? JSON.stringify([...new Set(failed)].slice(0, 4)) : "none");

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "22-oldserver-off-390x844.png"), Buffer.from(shot.data, "base64"));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
