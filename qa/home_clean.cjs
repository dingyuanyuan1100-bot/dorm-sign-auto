// 首页/我的：关掉自动弹出的绑定提示后截图，确认底部导航贴底、无拉伸
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9373;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "fix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.argv[2] || "";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
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
  const size = (process.argv[3] || "412x915").split("x").map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: `${WEB}/?native=1#home` });
  await sleep(4200);
  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(700);
  await shot(`home-clean-${size[0]}x${size[1]}`);
  const m = await evalJs(`(() => {
    const nav=document.querySelector('.nav')?.getBoundingClientRect();
    const hero=document.querySelector('.hero')?.getBoundingClientRect();
    return { navBottomGap: nav ? Math.round(innerHeight-nav.bottom) : null, navH: nav?Math.round(nav.height):null, heroAspect: hero ? +(hero.width/hero.height).toFixed(3) : null };
  })()`);
  console.log(JSON.stringify(m));
  ws.close(); process.exit(0);
})();
