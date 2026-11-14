/* 启动闪屏连续性验收
   —— 判定「点击图标后先出现图标、再播一遍入场」是否消失：
   1) 任何时刻页面上只有 1 个闪屏节点（不再有静态层 + React 层两套）
   2) Logo 缩放从 ≈0.6 起步、单调放大到 1，中途不回到起点（没有重播）
   3) boot 就绪 + 入场播完后淡出移除，不会一直挡着
   用法: node qa/splash_cont.cjs [port]
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9850 + Math.floor(Math.random() * 120);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const OUT = path.join(__dirname, "live");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
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

  // 在页面里自采样：每 40ms 记一次节点数 / Logo 缩放 / 闪屏透明度
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__samples = [];
      (function () {
        var t0 = performance.now();
        var timer = setInterval(function () {
          var nodes = document.querySelectorAll("#boot-splash, .splash").length;
          var el = document.getElementById("boot-splash");
          var svg = el && el.querySelector("svg");
          var scale = null, op = null;
          if (svg) {
            var tr = getComputedStyle(svg).transform;
            if (tr && tr !== "none") { var m = tr.match(/matrix\\(([^)]+)\\)/); if (m) scale = parseFloat(m[1].split(",")[0]); }
            else scale = 1;
            op = parseFloat(getComputedStyle(el).opacity);
          }
          window.__samples.push({ t: Math.round(performance.now() - t0), nodes: nodes, has: !!el, scale: scale, op: op });
          if (performance.now() - t0 > 2600) clearInterval(timer);
        }, 40);
      })();`,
  });

  const t0 = Date.now();
  await send("Page.navigate", { url: WEB });

  // 抓两帧：动画中段、动画结束
  await sleep(320);
  const mid = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "31-splash-mid.png"), Buffer.from(mid.data, "base64"));
  await sleep(2600);
  const samples = JSON.parse(await evalJs("JSON.stringify(window.__samples || [])"));
  const fin = JSON.parse(await evalJs(`JSON.stringify({
    splashGone: !document.getElementById("boot-splash"),
    anySplash: document.querySelectorAll("#boot-splash, .splash").length,
    nav: !!document.querySelector(".nav") || !!document.querySelector(".login-layer[data-show='true']"),
  })`));

  const withSplash = samples.filter((s) => s.has);
  const maxNodes = Math.max(...samples.map((s) => s.nodes), 0);
  const scales = withSplash.map((s) => s.scale).filter((v) => typeof v === "number");
  const first = scales[0];
  const peak = Math.max(...scales);
  // 重播判定：已经放大过半后又掉回接近起点
  let restart = false;
  let seenHigh = false;
  for (const v of scales) {
    if (v > 0.85) seenHigh = true;
    if (seenHigh && v < peak - 0.15) { restart = true; break; }
  }
  const goneAt = (samples.find((s) => !s.has) || {}).t ?? null;

  console.log("SAMPLES", samples.length, "withSplash", withSplash.length);
  console.log("FIRST_SCALE", first, "PEAK", peak.toFixed(3), "MAX_NODES", maxNodes);
  console.log("RESTART", restart);
  console.log("GONE_AT_MS", goneAt);
  console.log("FINAL", JSON.stringify(fin));
  console.log("VERDICT", JSON.stringify({
    singleSplash: maxNodes === 1,
    startsSmall: first != null && first < 0.85,
    growsToFull: peak > 0.98,
    noReplay: !restart,
    dismissed: !!fin.splashGone,
  }));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
