// 弹层/页面细节截图：位置库「添加位置」、我的页、登录页（原生铺满比例）
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9371;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "fix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.argv[2] || "";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sheets-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('dorm.token',${JSON.stringify(TOKEN)})}catch(e){}` });
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: `${WEB}/?native=1&r=locations#locations` });
  await sleep(3800);
  // 关掉「登录后自动弹出」的绑定提示，避免挡住页面
  await evalJs("document.querySelector('.scrim')?.click(); document.querySelector('.sheet__btn')?.click(); 'ok'");
  await sleep(600);
  await shot("locations-clean-412x915");

  await evalJs("(() => { const p=[...document.querySelectorAll('.pane')].find(x=>x.dataset.active==='true'); p?.querySelector('.addrow')?.click(); return 'ok'; })()");
  await sleep(800);
  const desc = await evalJs("document.querySelector('.sheet__desc')?.textContent || ''");
  await shot("sheet-location-412x915");

  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(500);
  await send("Page.navigate", { url: `${WEB}/?native=1&r=me#me` });
  await sleep(2200);
  await evalJs("document.querySelector('.scrim')?.click(); document.querySelector('.sheet__btn')?.click(); 'ok'");
  await sleep(500);
  await shot("me-412x915");
  const logout = await evalJs("(() => { const b=document.querySelector('.logout')?.getBoundingClientRect(); const n=document.querySelector('.nav')?.getBoundingClientRect(); return b&&n ? { gap: Math.round(n.top - b.bottom) } : null; })()");

  // 登录页（清掉 token）
  await send("Page.navigate", { url: `${WEB}/?native=1#home` });
  await sleep(800);
  await evalJs("localStorage.clear(); 'ok'");
  await send("Page.reload");
  await sleep(3200);
  await shot("login-412x915");

  console.log(JSON.stringify({ locationSheetDesc: desc, logout }));
  ws.close(); process.exit(0);
})();
