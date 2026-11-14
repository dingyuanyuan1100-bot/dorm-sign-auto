/* 闪屏 Logo 接力验收
   —— 判定：入场结束后，闪屏 Logo 是否用 CSS transition 平滑落到目标页
      那枚同款 Logo 的位置上，且落位瞬间没有「两个 Logo」叠着。
   采样：页面内每 30ms 记一次 #bs-logo / 目标 Logo 的 rect，结束后比对。
   用法: node qa/logo_flight.cjs login|home [port]
   产物: qa/live/flight/<mode>-*.png + 控制台报告
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const MODE = process.argv[2] === "home" ? "home" : "login";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5298}/`;
const OUT = path.join(__dirname, "live", "flight");
const SEL = MODE === "home" ? '.pane[data-active="true"] .home__avatar svg' : ".login__logo svg";
const USER = "qacheck_1793717807", PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const SAMPLER = `
window.__fl = [];
(function () {
  var SEL = ${JSON.stringify(SEL)};
  var r = function (n) {
    if (!n) return null;
    var b = n.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  };
  var t = setInterval(function () {
    var el = document.getElementById("boot-splash");
    var lg = document.getElementById("bs-logo");
    var tg = document.querySelector(SEL);
    window.__fl.push({
      t: Math.round(performance.now()),
      logo: r(lg),
      target: r(tg),
      splash: !!el,
      cls: el ? el.className : "",
      tgOp: tg ? getComputedStyle(tg).opacity : null,
    });
    if (window.__fl.length > 400) clearInterval(t);
  }, 30);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fl-"));
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
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });

  if (MODE === "home") {
    // 先拿一个可用 token 再重载，重载那次才是被测量的冷启动
    await send("Page.navigate", { url: WEB });
    await sleep(2200);
    const token = await evalJs(`(async () => {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
      return (await r.json())?.data?.token || "";
    })()`);
    if (!token) { console.log("LOGIN_FAILED"); process.exit(3); }
    await evalJs(`localStorage.setItem("dorm.token", ${JSON.stringify(token)}); localStorage.removeItem("dorm.update.snoozed");`);
    await sleep(200);
  }

  await send("Page.navigate", { url: WEB });
  // 飞行 1210→1830ms 附近，按 70~120ms 抽帧，能看清中间过程
  await sleep(1180); await shot(`${MODE}-a.png`);
  await sleep(90);   await shot(`${MODE}-b.png`);
  await sleep(110);  await shot(`${MODE}-c.png`);
  await sleep(140);  await shot(`${MODE}-d.png`);
  await sleep(180);  await shot(`${MODE}-e.png`);
  await sleep(260);  await shot(`${MODE}-f.png`);
  await sleep(700);

  const samples = JSON.parse((await evalJs("JSON.stringify(window.__fl || [])")) || "[]");

  // ---- 分析 ----
  // 只统计飞行阶段（bs-out 之后），入场 pop 的缩放不算位移
  const fly = samples.filter((s) => s.cls && s.cls.indexOf("bs-out") >= 0 && s.logo);
  const withLogo = fly.length ? fly : samples.filter((s) => s.logo);
  const moving = withLogo.filter((s, i) => i > 0 && withLogo[i - 1].logo &&
    (Math.abs(s.logo[0] - withLogo[i - 1].logo[0]) > 0.4 || Math.abs(s.logo[1] - withLogo[i - 1].logo[1]) > 0.4));
  const first = withLogo[0], last = withLogo[withLogo.length - 1];
  const target = (samples.find((s) => s.target) || {}).target;
  const endSample = samples[samples.length - 1];

  const centerOf = (r) => (r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null);
  const cLast = centerOf(last?.logo), cT = centerOf(target);
  const delta = cLast && cT ? +Math.hypot(cLast[0] - cT[0], cLast[1] - cT[1]).toFixed(1) : null;
  const startCenter = centerOf(first?.logo);
  const travel = startCenter && cT ? +Math.hypot(startCenter[0] - cT[0], startCenter[1] - cT[1]).toFixed(1) : null;

  // 单调性：位移方向是否始终一致（无回弹/跳变）
  let jumps = 0, maxStep = 0;
  for (let i = 1; i < withLogo.length; i++) {
    const a = withLogo[i - 1].logo, b = withLogo[i].logo;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > maxStep) maxStep = d;
    if (d > 60) jumps++;   // 单采样周期（30ms）内跳超过 60px = 瞬移
  }

  // 逐点位移表：看是否全程都有可见位移（而不是前段跳、后段停）
  const track = withLogo.filter((_, i) => i % 3 === 0 || i === withLogo.length - 1)
    .map((s) => `${s.t}:y=${s.logo[1]} w=${s.logo[2]}`);
  console.log("TRACK " + track.join("  "));

  console.log(JSON.stringify({
    mode: MODE,
    startRect: first?.logo, targetRect: target, finalRect: last?.logo,
    travelPx: travel, endDeltaPx: delta,
    scaleFromTo: first && last ? +(last.logo[2] / first.logo[2]).toFixed(3) : null,
    moveSamples: moving.length, maxStepPx: Math.round(maxStep), jumps,
    flightStartMs: moving[0]?.t ?? null, flightEndMs: moving[moving.length - 1]?.t ?? null,
    splashRemoved: !endSample.splash,
    targetOpacityEnd: endSample.tgOp,
    everBothVisible: fly.slice(1).some((s) => s.logo && s.tgOp && s.tgOp !== "0"),
    popRect: samples.filter((s) => s.logo && s.cls === "")[0]?.logo ?? null,
  }, null, 2));

  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
