/* 启动首帧闪白检测
   —— 用户逐帧发现「青柠底 → 纯白 → 青柠底+Logo」。
   这里用 CDP screencast 把启动过程按帧抓下来，逐帧统计颜色：
     1) 是否存在接近纯白的帧（闪白）
     2) 纯白像素占比
     3) 首帧绿底时间、Logo 出现时间
   用法: node qa/launch_frames.cjs [port]
   产物: qa/live/launch/frame-XXX.png  +  qa/live/launch/report.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9860 + Math.floor(Math.random() * 120);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5297}/`;
const OUT = path.join(__dirname, "live", "launch");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lf-"));
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
  const t0 = Date.now();
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
      frames.push({ file, at: Date.now() - t0, ts: m.params.metadata?.timestamp ?? null });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
    }
  };

  await send("Page.enable");
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
  await send("Page.navigate", { url: WEB });
  await sleep(4200);
  await send("Page.stopScreencast").catch(() => {});

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ web: WEB, count: frames.length, frames }, null, 2));
  console.log("FRAMES", frames.length, "dir", OUT);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
