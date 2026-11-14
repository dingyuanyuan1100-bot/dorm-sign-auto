// 检查线上页面在「浏览器可用区域比设计稿更矮更宽」时是否出现左右底色留白
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.QA_URL || "https://175.24.230.58/";
const SIZES = (process.env.QA_SIZES || "426x829,390x844,412x915,393x760").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(size, tag) {
  const PORT = 9400 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fill-"));
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const [w, h] = size.split("x").map(Number);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setUserAgentOverride", {
    userAgent: "Mozilla/5.0 (Linux; Android 14; 23127PN0CC Build/UKQ1.230804.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.6261.120 Mobile Safari/537.36 MicroMessenger/8.0.49",
  });
  await send("Page.navigate", { url: URL });
  await sleep(4200);

  const probe = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const vp = document.querySelector(".viewport");
      const stage = document.querySelector(".stage");
      const sr = stage.getBoundingClientRect();
      const cs = getComputedStyle(stage);
      // 舞台左右/上下各留了多少底色
      const gaps = {
        left: Math.round(sr.left),
        right: Math.round(window.innerWidth - sr.right),
        top: Math.round(sr.top),
        bottom: Math.round(window.innerHeight - sr.bottom),
      };
      const bg = getComputedStyle(vp).backgroundColor;
      return JSON.stringify({
        vw: window.innerWidth, vh: window.innerHeight,
        stageW: Math.round(sr.width), stageH: Math.round(sr.height),
        gaps, viewportBg: bg, transform: cs.transform,
        cls: vp.className + " | " + stage.className,
      });
    })()`,
  });
  const png = await send("Page.captureScreenshot", { format: "png" });
  const out = path.join(__dirname, "fill");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `login-${tag}.png`), Buffer.from(png.data, "base64"));

  ws.close(); proc.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  return probe.result.value;
}

(async () => {
  for (const s of SIZES) {
    const tag = s.replace("x", "-");
    const r = await run(s, tag);
    console.log(s, r);
  }
  process.exit(0);
})();
