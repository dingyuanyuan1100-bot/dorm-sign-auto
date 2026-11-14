/* 启动接力验收 v3（M3 / 澎湃 motion token）
   —— 针对用户提的三点逐条量化：
      1) 「晚寝签到」四个字是否全程不消失，且落位后与 .login__title 逐字重合
         → 飞行窗口内 word 的 opacity 必须恒为 1；落位时文本矩形中心/宽度误差
      2) Logo 是否还「变淡再出现」
         → 目标 logo 的 opacity 序列里不允许出现 0<x<1 的中间帧
      3) 速度曲线是否 M3 emphasized（先加速、后减速、峰值在中前段）
         → 分段速度先升后降，峰值位置落在 15%~55%
   用法: QA_PORT=5296 node qa/splash_m3.cjs [login|home]
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const MODE = process.argv[2] === "home" ? "home" : "login";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const OUT = path.join(__dirname, "live", "intro");
const TARGET = MODE === "home" ? '.pane[data-active="true"] .home__avatar svg' : ".login__logo svg";
const USER = "qacheck_1793717807", PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const SAMPLER = `
window.__m3 = [];
(function () {
  var TG = ${JSON.stringify(TARGET)};
  function box(n) {
    if (!n) return null;
    var b = n.getBoundingClientRect();
    return [+b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)];
  }
  function txt(n) {
    if (!n) return null;
    try {
      var r = document.createRange();
      r.selectNodeContents(n);
      var b = r.getBoundingClientRect();
      if (b && b.width > 0) return [+b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)];
    } catch (e) {}
    return box(n);
  }
  // 实际看到的不透明度：自身 × 全部祖先。只看自身会漏掉 .login-layer 之类的淡入
  function eff(n) {
    var a = 1;
    for (var p = n; p && p.nodeType === 1; p = p.parentElement) {
      var o = parseFloat(getComputedStyle(p).opacity);
      if (isFinite(o)) a *= o;
      if (a < 0.995) return a;
    }
    return a;
  }
  function op(sel) {
    var n = document.querySelector(sel);
    return n ? +getComputedStyle(n).opacity : null;
  }
  var iv = setInterval(function () {
    var st = document.querySelector(".stage");
    var lg = document.getElementById("bs-logo");
    var wd = document.querySelector(".bs-word");
    var tg = document.querySelector(TG);
    var ti = document.querySelector(".login__title");
    var wcs = wd ? getComputedStyle(wd) : null;
    window.__m3.push({
      t: Math.round(performance.now() * 10) / 10,
      splash: !!document.getElementById("boot-splash"),
      logo: box(lg),
      logoVis: lg ? getComputedStyle(lg).visibility : null,
      word: box(wd),
      wordTxt: txt(wd),
      wordOp: wcs ? +wcs.opacity : null,
      wordVis: wcs ? wcs.visibility : null,
      wordEff: wd ? +eff(wd).toFixed(3) : null,
      wordLs: wcs ? parseFloat(wcs.letterSpacing) : null,
      title: ti ? +getComputedStyle(ti).opacity : null,
      titleEff: ti ? +eff(ti).toFixed(3) : null,
      titleTxt: txt(ti),
      tgOp: tg ? +getComputedStyle(tg).opacity : null,
      tgEff: tg ? +eff(tg).toFixed(3) : null,
      tg: box(tg),
      // 飞行层是 body 直属，祖先链上只有 html/body，eff 必须恒为 1
      logoEff: lg ? +eff(lg).toFixed(3) : null,
      flyAlive: !!document.getElementById("bs-fly"),
      handoff: document.documentElement.dataset.handoff || "",
      veilOp: op("#boot-splash .bs-veil"),
      splashOp: op("#boot-splash"),
      layerOp: op(".login-layer"),
      layerEff: (function () {
        // 量「当前可见的那个页面容器」：登录页是 .login-layer，已登录是 .app
        var n = document.querySelector(".login-layer[data-show='true'], .app[data-show='true']");
        return n ? +eff(n).toFixed(3) : null;
      })(),
      layerWhich: (function () {
        var n = document.querySelector(".login-layer[data-show='true'], .app[data-show='true']");
        return n ? (n.className || "").split(" ")[0] : null;
      })(),
      intro: st ? (st.dataset.intro || "") : "none"
    });
    if (window.__m3.length > 900) clearInterval(iv);
  }, 8);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "m3-"));
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
  // 接力 1150ms 开始、1650ms 落位
  await sleep(1150); await shot(`${MODE}-m3-a.png`);
  await sleep(120);  await shot(`${MODE}-m3-b.png`);
  await sleep(120);  await shot(`${MODE}-m3-c.png`);
  await sleep(120);  await shot(`${MODE}-m3-d.png`);
  await sleep(160);  await shot(`${MODE}-m3-e.png`);
  await sleep(600);  await shot(`${MODE}-m3-f.png`);
  await sleep(1400);

  const s = JSON.parse((await evalJs("JSON.stringify(window.__m3 || [])")) || "[]");
  if (!s.length) { console.log("NO_SAMPLES"); process.exit(4); }
  // DOMRect 直接序列化成 {}，在页面里拍平成数组再取
  const land = JSON.parse((await evalJs(`(() => {
    const f = (b) => (b ? [b.left, b.top, b.width, b.height] : null);
    const t = document.querySelector(".login__title");
    let tb = null;
    if (t) {
      const sp = t.querySelector("span");
      if (sp) tb = f(sp.getBoundingClientRect());
      else {
        const r = document.createRange();
        r.selectNodeContents(t);
        tb = f(r.getBoundingClientRect());
      }
    }
    return JSON.stringify({ w: f(window.__wordLand), tb: tb, t: f(t) });
  })()`)) || "{}");

  const ctr = (r) => (r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null);
  const dist = (a, b) => (a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(2) : null);

  // 飞行窗口：data-intro 出现（dismissSplash 开跑）→ 闪屏被移除
  const startIdx = s.findIndex((x) => x.intro === "pending");
  const endIdx = s.findIndex((x, i) => i > startIdx && !x.splash);
  const flight = s.slice(startIdx, endIdx > 0 ? endIdx : s.length).filter((x) => x.logo && x.logoVis === "visible");

  // 1) 文字连续性
  const wordOps = flight.map((x) => x.wordOp).filter((v) => v != null);
  const wordVisibleFrames = flight.filter((x) => x.wordVis === "visible" && x.word).length;

  // 2) 目标 logo 显隐：0 → 1 之间不允许有中间值
  const tgVals = s.map((x) => x.tgOp).filter((v) => v != null);
  const tgPartial = tgVals.filter((v) => v > 0.02 && v < 0.98);
  // 只看飞行窗口：飞行前登录页本来就已经渲染好了（被闪屏整层盖着），不算重影
  const everBoth = s
    .slice(startIdx, endIdx > 0 ? endIdx : s.length)
    .some((x) => x.splash && x.logoVis === "visible" && x.tgOp > 0.02);

  /* 2b) 「实际看到的不透明度」——用户真正看到的淡入淡出都在这一层：
         祖先（.login-layer / .app / .pane）淡入时，元素自身仍是 1。
         · tgEffPartial：目标在屏幕上出现过半透明中间态 → 就是「Logo 淡一下又出现」
         · veilOverTarget：目标已显形、底板却还没淡完 → 像蒙了一层青柠，同样发白 */
  const tgEffVals = s.map((x) => x.tgEff).filter((v) => v != null);
  const tgEffPartial = s.slice(startIdx >= 0 ? startIdx : 0).filter((x) => x.tgEff > 0.02 && x.tgEff < 0.98);
  const veilOverTarget = s
    .slice(startIdx >= 0 ? startIdx : 0)
    .filter((x) => x.tgEff > 0.02 && x.veilOp != null && x.veilOp > 0.02);
  const veilZeroAt = (() => {
    const f = s.find((x) => x.veilOp != null && x.veilOp <= 0.02);
    return f && flight[0] ? +(f.t - flight[0].t).toFixed(0) : null;
  })();
  const titleEffPartial = s.slice(startIdx >= 0 ? startIdx : 0).filter((x) => x.titleEff > 0.02 && x.titleEff < 0.98);
  const veilAtLand = await evalJs("window.__veilAtLand == null ? null : window.__veilAtLand");

  /* 2c) 飞行层是否真的脱离了 #root：
         · logoEffMin 必须是 1 —— 飞行中 Logo 的实际不透明度，含全部祖先
         · layerPartialInFlight 必须是 0 —— 页面容器在飞行窗口内出现过半透明
         · handoffHeld 必须为 true —— 整段飞行期间「不做容器淡入」的标记都还在 */
  const logoEffInFlight = flight.map((x) => x.logoEff).filter((v) => v != null);
  const layerPartialInFlight = flight.filter((x) => x.layerEff != null && x.layerEff < 0.98);
  const handoffHeld = flight.length > 0 && flight.every((x) => x.handoff === "1");

  // 3) 速度：用 logo 中心位移，按飞行窗口等分 6 段
  const segs = [];
  for (let k = 0; k < 6; k++) {
    const lo = Math.floor((flight.length * k) / 6);
    const hi = Math.min(flight.length - 1, Math.floor((flight.length * (k + 1)) / 6) - 1);
    if (hi <= lo) { segs.push(null); continue; }
    const a = flight[lo], b = flight[hi];
    const dt = b.t - a.t;
    const d = Math.hypot(ctr(b.logo)[0] - ctr(a.logo)[0], ctr(b.logo)[1] - ctr(a.logo)[1]);
    segs.push(dt > 0 ? +(d / dt * 16).toFixed(1) : null);
  }
  const valid = segs.filter((v) => v != null);
  const peak = Math.max(...valid);
  const peakAt = valid.indexOf(peak);
  const monoUp = valid.slice(0, peakAt + 1).every((v, i) => i === 0 || v >= valid[i - 1] * 0.9);
  // 注意：slice 之后的下标是切片内的，比较必须回到 valid 上取 peakAt + i - 1
  const monoDown = valid.slice(peakAt).every((v, i) => i === 0 || v <= valid[peakAt + i - 1] * 1.12);
  const travel = dist(ctr(flight[0].logo), ctr(flight[flight.length - 1].logo));

  // 文字落位误差：探针记录的 word 文本矩形 vs 页面上 title 的文本矩形
  const wordLandDelta = land.w && land.tb ? dist(ctr(land.w), ctr(land.tb)) : null;
  const wordLandWidthDiff = land.w && land.tb ? +Math.abs(land.w[2] - land.tb[2]).toFixed(2) : null;

  const report = {
    mode: MODE,
    flightStartMs: flight[0]?.t,
    flightEndMs: flight[flight.length - 1]?.t,
    flightDurationMs: flight.length ? +(flight[flight.length - 1].t - flight[0].t).toFixed(0) : null,
    travelPx: travel,
    // 1) 文字
    wordOpacityMin: wordOps.length ? Math.min(...wordOps) : null,
    wordVisibleFrames,
    wordFramesExpected: flight.length,
    wordLetterSpacingStart: flight[0]?.wordLs,
    wordLetterSpacingEnd: flight[flight.length - 1]?.wordLs,
    wordLandCenterDeltaPx: wordLandDelta,
    wordLandWidthDiffPx: wordLandWidthDiff,
    wordEffectiveMin: flight.map((x) => x.wordEff).filter((v) => v != null).length
      ? Math.min(...flight.map((x) => x.wordEff).filter((v) => v != null))
      : null,
    landRaw: land,
    fontLoaded: await evalJs(`document.fonts.check('700 30px "Alimama ShuHeiTi"')`),
    // 2) Logo 交接
    targetOpacitySamples: [...new Set(tgVals.map((v) => +v.toFixed(2)))].slice(0, 12),
    targetPartialFrames: tgPartial.length,
    everBothVisible: everBoth,
    splashRemoved: !s[s.length - 1].splash,
    // 2b) 实际观感（含祖先 opacity 与底板遮盖）
    targetEffectiveSamples: [...new Set(tgEffVals.map((v) => +v.toFixed(2)))].slice(0, 12),
    targetEffectivePartialFrames: tgEffPartial.length,
    targetPartialAtMs: tgEffPartial.slice(0, 6).map((x) => `${x.t}/${x.tgEff.toFixed(2)}`),
    titleEffectivePartialFrames: titleEffPartial.length,
    veilOverTargetFrames: veilOverTarget.length,
    veilOverTargetAtMs: veilOverTarget.slice(0, 6).map((x) => `${x.t}/veil${x.veilOp.toFixed(2)}`),
    veilReachesZeroMs: veilZeroAt,
    veilOpacityAtLanding: veilAtLand,
    // 2c) 飞行层独立性
    flyLayerDetached: flight.every((x) => x.flyAlive),
    logoEffectiveMinInFlight: logoEffInFlight.length ? +Math.min(...logoEffInFlight).toFixed(3) : null,
    layerPartialFramesInFlight: layerPartialInFlight.length,
    layerPartialAtMs: layerPartialInFlight.slice(0, 6).map((x) => `${x.t}/${x.layerEff.toFixed(2)}`),
    handoffHeldThroughFlight: handoffHeld,
    layerOpacityAtStart: flight[0]?.layerEff,
    layerWhich: flight[0]?.layerWhich,
    // 3) 速度
    segmentSpeedPxPerFrame: segs,
    peakSegment: peakAt,
    peakPosPct: flight.length ? +(peakAt / valid.length * 100).toFixed(0) : null,
    acceleratesThenDecelerates: monoUp && monoDown,
    endSpeedRatio: valid.length ? +(valid[valid.length - 1] / peak).toFixed(2) : null,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
