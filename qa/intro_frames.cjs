/* 入场序列逐帧截图
   —— 定距截图（不是 screencast），覆盖「落位完成 → 组件依次淡入向上」这一段，
      用来肉眼确认时序与方向。
   用法: QA_PORT=5296 node qa/intro_frames.cjs login|home
   产物: qa/live/intro/<mode>-iXX.png + index.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const MODE = process.argv[2] === "home" ? "home" : "login";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9800 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const OUT = path.join(__dirname, "live", "intro-frames");
const USER = "qacheck_1793717807", PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "if-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=390,844", "about:blank"], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  if (!up) { console.log("CHROME_FAILED"); process.exit(2); }

  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const evalJs = async (expr) =>
    (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  if (MODE === "home") {
    await send("Page.navigate", { url: WEB });
    await sleep(2200);
    const token = await evalJs(`(async () => {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
      const t = (await r.json())?.data?.token || "";
      localStorage.setItem("dorm.token", t);
      localStorage.removeItem("dorm.update.snoozed");
      return t;
    })()`);
    if (!token) { console.log("LOGIN_FAILED"); process.exit(3); }
    await sleep(200);
  }

  await send("Page.navigate", { url: WEB });
  await sleep(1600); // 越过飞行窗口，从落位附近开始截

  const index = [];
  for (let i = 0; i < 14; i++) {
    const name = `${MODE}-i${String(i).padStart(2, "0")}.png`;
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    const t = await evalJs("Math.round(performance.now())");
    index.push({ file: name, ms: t });
    await sleep(80);
  }

  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
  console.log("FRAMES", index.length, "dir", OUT);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
