// 轻量截图器：起 headless Chrome → 登录态 → 打开页面 → 落图
//   node qa/cap.cjs <端口> <路由> <输出文件> [进入页面后执行的 JS]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9350 + Math.floor(Math.random() * 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , webPort = "5297", hash = "home", outFile = "qa/shot.png", after = ""] = process.argv;
const BASE = `http://127.0.0.1:${webPort}`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cap-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (v) { ready = true; break; }
    } catch {}
    await sleep(200);
  }
  if (!ready) throw new Error("chrome 未就绪");

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? `EX ${JSON.stringify(r.exceptionDetails).slice(0, 240)}` : r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1200);
  await ev(
    process.env.QA_ANON
      ? `localStorage.removeItem('dorm.token'); 'anon'`
      : `localStorage.setItem('dorm.token','mock-token'); 'ok'`,
  );
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=${hash}#${hash}` });
  await sleep(2800);

  if (after) {
    const r = await ev(after);
    if (r && String(r).startsWith("EX")) console.log("after:", r);
    await sleep(1500);
  }

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const dest = path.resolve(process.cwd(), outFile);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(shot.data, "base64"));
  console.log("saved", dest);

  ws.close();
  chrome.kill();
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
