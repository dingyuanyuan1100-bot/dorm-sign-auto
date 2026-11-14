/* 接力飞行的逐帧录像采样
   —— screencast 的每一帧都带真实时间戳，能准确切出飞行过程中的画面，
      用来做「是不是真的一帧一帧滑过去」的视觉证据。
   用法: node qa/flight_frames.cjs login|home [port]
   产物: qa/live/flight/frames-<mode>/frame-XXX.png + index.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const MODE = process.argv[2] === "home" ? "home" : "login";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9990 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5298}/`;
const OUT = path.join(__dirname, "live", "flight", `frames-${MODE}`);
const USER = "qacheck_1793717807", PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ff-"));
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

  const frames = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Page.screencastFrame") {
      const n = frames.length;
      const file = `frame-${String(n).padStart(3, "0")}.png`;
      fs.writeFileSync(path.join(OUT, file), Buffer.from(m.params.data, "base64"));
      frames.push({ file, ts: m.params.metadata.timestamp });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  if (MODE === "home") {
    await send("Page.navigate", { url: WEB });
    await sleep(2200);
    const token = (await send("Runtime.evaluate", {
      expression: `(async () => {
        const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
        const t = (await r.json())?.data?.token || "";
        localStorage.setItem("dorm.token", t);
        localStorage.removeItem("dorm.update.snoozed");
        return t;
      })()`, awaitPromise: true, returnByValue: true,
    })).result.value;
    if (!token) { console.log("LOGIN_FAILED"); process.exit(3); }
    await sleep(200);
  }

  await send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
  await send("Page.navigate", { url: WEB });
  await sleep(2600);
  await send("Page.stopScreencast").catch(() => {});

  const t0 = frames.length ? frames[0].ts : 0;
  const list = frames.map((f) => ({ file: f.file, ms: Math.round((f.ts - t0) * 1000) }));
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(list, null, 2));
  console.log("FRAMES", list.length, "dir", OUT);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
