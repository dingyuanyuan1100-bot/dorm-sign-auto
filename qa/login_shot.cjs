// 登录页（原生铺满）截图：确认青柠底铺满、底部无浅灰缝
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9377;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "fix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "login-"));
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
  await send("Page.enable"); await send("Runtime.enable");
  const size = (process.argv[2] || "412x915").split("x").map(Number);
  await send("Emulation.setDeviceMetricsOverride", { width: size[0], height: size[1], deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.clear()}catch(e){}" });
  await send("Page.navigate", { url: `${WEB}/?native=1#home` });
  await sleep(4200);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `login-native-${size[0]}x${size[1]}.png`), Buffer.from(r.data, "base64"));
  const info = await evalJs(`(() => {
    const lg=document.querySelector('.login')?.getBoundingClientRect();
    const st=document.querySelector('.stage')?.getBoundingClientRect();
    return { loginBottom: lg?Math.round(lg.bottom):null, stageBottom: st?Math.round(st.bottom):null };
  })()`);
  console.log(JSON.stringify(info));
  ws.close(); process.exit(0);
})();
