/* 跨域更新检测验收：模拟原生壳（Capacitor）的 origin 与资源加载方式
   原生壳里页面在 https://localhost，API_BASE 会变成公网绝对地址，
   清单请求因此是跨域请求。这里用 127.0.0.1 打开生产构建复现同一条路径：
   SAME_ORIGIN=false → API_BASE = https://175.24.230.58 → fetch 绝对地址。
   验收点：清单请求 200 且能读到 JSON、手动检查 Toast 正确、无 CORS 报错。
   用法: node qa/update_cross.cjs <token> */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9410 + Math.floor(Math.random() * 40);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5294}`;
const OUT = path.join(__dirname, "live");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = process.argv[2] || "";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "xupd-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  if (!up) { console.log("CHROME_START_FAILED"); process.exit(2); }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map(); const errs = []; const reqs = [];
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.url.includes("/update/version.json")) {
        reqs.push({ url: r.url, status: r.status, from: m.params.type, cors: r.headers["access-control-allow-origin"] });
      }
    }
    if (m.method === "Network.loadingFailed" && (m.params.errorText || "").includes("CORS")) {
      errs.push("CORS: " + m.params.errorText);
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
    const s = [...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({ open: !!s, title: s?.querySelector(".sheet__title")?.innerText || "",
      vers: [...(s?.querySelectorAll(".update__v") || [])].map(v => v.innerText),
      btns: [...(s?.querySelectorAll(".sheet__btn") || [])].map(b => b.innerText.trim()),
      toast: document.querySelector(".toast__text")?.innerText || "" });
  })()`));

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("dorm.token",${JSON.stringify(TOKEN)});localStorage.removeItem("dorm.update.snoozed")}catch(e){}`,
  });

  await send("Page.navigate", { url: WEB });
  await sleep(5000);
  console.log("PAGE_ORIGIN", await evalJs("location.origin"));
  console.log("MANIFEST_REQ", JSON.stringify(reqs));
  console.log("BOOT_SHEET", JSON.stringify(await sheet()));

  // 先关掉「登录后自动弹出的绑定层」，再进我的页
  await evalJs(`(() => { const b=[...document.querySelectorAll("button")].find(x=>(x.innerText||"").trim()==="取消"); b?.click(); return 1; })()`);
  await sleep(700);

  // 我的 → 关于 → 检查更新
  await evalJs(`(() => { const n=[...document.querySelectorAll(".nav__item")].find(x=>x.getAttribute("aria-label")==="我的"); n?.click(); return 1; })()`);
  await sleep(900);
  await evalJs(`(() => { const b=document.querySelector('[data-key="about"] .listrow__value'); b?.click(); return 1; })()`);
  await sleep(800);
  console.log("ABOUT", JSON.stringify(await sheet()));
  await evalJs(`(() => { const s=[...document.querySelectorAll(".sheet")].pop();
    [...(s?.querySelectorAll(".sheet__btn")||[])].find(x=>(x.innerText||"").trim().startsWith("检查更新"))?.click(); return 1; })()`);
  await sleep(1000);
  console.log("LATEST_CHECK", JSON.stringify(await sheet()));
  await shot("06-cross-origin-latest-390x844.png");
  console.log("ERRORS", errs.length ? errs.slice(0, 4).join(" / ") : "none");
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
