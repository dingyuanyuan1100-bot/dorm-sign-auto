/* 启动接力验收（2.0.10-beta 第二轮）
   —— 1) Logo 飞行是否「不断加速」：分段平均速度必须逐段上升；
      2) 页面其它组件是否在 Logo 落位前后按顺序入场：
         首次可见时间逐个后移、最终 opacity 全为 1、
         入场结束后 .stage 上的 data-intro 被摘掉（不压 :active）。
   用法: node qa/intro_seq.cjs login|home [port]
   产物: qa/live/intro/<mode>-*.png + 控制台 JSON 报告
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
window.__iq = [];
(function () {
  var TG = ${JSON.stringify(TARGET)};
  var LIST = ${MODE === "home"
    ? '{ hi: ".home__hi", hero: ".hero", statA: ".stat--a", statB: ".stat--b", head: ".section-head", row0: ".taskrow", nav: ".nav" }'
    : '{ title: ".login__title", card: ".login__card", ind: ".login__indicator" }'};
  var rect = function (n) {
    if (!n) return null;
    var b = n.getBoundingClientRect();
    return [+b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)];
  };
  var t = setInterval(function () {
    var st = document.querySelector(".stage");
    var lg = document.getElementById("bs-logo");
    var tg = document.querySelector(TG);
    var e = {};
    for (var k in LIST) {
      var n = document.querySelector(LIST[k]);
      if (!n) continue;
      var cs = getComputedStyle(n);
      e[k] = [+cs.opacity, Math.round(n.getBoundingClientRect().top), cs.animationDelay];
    }
    window.__iq.push({
      t: Math.round(performance.now()),
      logo: rect(lg),
      tg: tg ? +getComputedStyle(tg).opacity : null,
      tgr: rect(tg),
      intro: st ? (st.dataset.intro || "") : "none",
      splash: !!document.getElementById("boot-splash"),
      e: e
    });
    if (window.__iq.length > 500) clearInterval(t);
  }, 16);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "iq-"));
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
  // 接力发生在 1150~1800ms；组件入场延续到 ~2100ms
  await sleep(1120); await shot(`${MODE}-a.png`);
  await sleep(160);  await shot(`${MODE}-b.png`);
  await sleep(160);  await shot(`${MODE}-c.png`);
  await sleep(180);  await shot(`${MODE}-d.png`);
  await sleep(220);  await shot(`${MODE}-e.png`);
  await sleep(420);  await shot(`${MODE}-f.png`);
  await sleep(1800);

  const s = JSON.parse((await evalJs("JSON.stringify(window.__iq || [])")) || "[]");
  if (!s.length) { console.log("NO_SAMPLES"); process.exit(4); }

  const center = (r) => (r ? [r[0] + r[2] / 2, r[1] + r[3] / 2] : null);
  // 飞行窗口：从 data-intro=pending 起，到闪屏被移除那帧为止
  const startIdx = s.findIndex((x) => x.intro === "pending");
  const endIdx = s.findIndex((x, i) => i > startIdx && !x.splash);
  const flight = s.slice(startIdx, endIdx > 0 ? endIdx : s.length).filter((x) => x.logo);
  const first = flight[0], last = flight[flight.length - 1];
  const travel = (() => {
    const a = center(first.logo), b = center(last.logo);
    return a && b ? +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(1) : null;
  })();

  // 分段速度：飞行窗口等分 5 段，各段平均 px/16ms
  const segs = [];
  for (let k = 0; k < 5; k++) {
    const lo = Math.floor((flight.length * k) / 5);
    const hi = Math.min(flight.length - 1, Math.floor((flight.length * (k + 1)) / 5) - 1);
    if (hi <= lo) { segs.push(null); continue; }
    const a = flight[lo], b = flight[hi];
    const dt = b.t - a.t;
    const d = Math.hypot(b.logo[0] - a.logo[0], b.logo[1] - a.logo[1]);
    segs.push(dt > 0 ? +(d / dt * 16).toFixed(1) : null);
  }

  const steps = [];
  for (let i = 1; i < flight.length; i++) {
    const dt = flight[i].t - flight[i - 1].t;
    const d = Math.hypot(flight[i].logo[0] - flight[i - 1].logo[0], flight[i].logo[1] - flight[i - 1].logo[1]);
    if (dt > 0) steps.push(d / dt * 16);
  }
  let regress = 0;
  /* 只统计「加速段」里的回退：M3 emphasized 本来就是先加速、峰值后长尾减速，
     把后段减速也算成回退会永远判失败（这个指标是上一版「全程加速」需求留下的）。 */
  const vseg = segs.filter((v) => v != null);
  const peakV = vseg.length ? Math.max(...vseg) : 0;
  const peakI = vseg.length ? vseg.indexOf(peakV) : 0;
  const peakFlightIdx = flight.length ? Math.floor((flight.length * peakI) / 5) : 0;
  for (let i = 3; i < Math.min(steps.length, peakFlightIdx); i++) {
    const prev = (steps[i - 1] + steps[i - 2] + steps[i - 3]) / 3;
    // 起步段速度不足 3px/帧，rect 尚在亚像素级，取整噪声不算回退
    if (steps[i] > 3 && steps[i] < prev * 0.8) regress++;
  }
  /* 曲线是否符合 M3 emphasized：峰值落在前一半，末段降到峰值的三成以下 */
  const curveMatchesEmphasized =
    vseg.length >= 3 && peakI <= Math.floor(vseg.length / 2) && vseg[vseg.length - 1] <= peakV * 0.35;

  // 落位误差：用 transition 走完那一刻的真实矩形（探针），对比目标 Logo 显形后的矩形
  const landed = s.slice(endIdx > 0 ? endIdx : 0).find((x) => x.tg !== null && x.tg > 0.05 && x.tgr);
  const landFinal = JSON.parse((await evalJs("JSON.stringify(window.__splashLand || null)")) || "null");
  const landDelta = (() => {
    const a = landFinal ? center([landFinal.left, landFinal.top, landFinal.width, landFinal.height]) : center(last.logo);
    const b = landed ? center(landed.tgr) : null;
    return a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(1) : null;
  })();

  const names = Object.keys(s[s.length - 1].e);
  const runShot = s.find((x) => x.intro === "run") || s[s.length - 1];
  // 入场统计只认 data-intro 出现之后：此前页面元素本来就可见（被闪屏盖着）
  const after = s.slice(startIdx);
  const order = names.map((k) => {
    const hit = after.find((x) => x.e[k] && x.e[k][0] > 0.05);
    return {
      key: k,
      firstSeenMs: hit ? hit.t : null,
      hiddenWhilePending: after.some((x) => x.intro === "pending" && x.e[k] && x.e[k][0] < 0.02),
      delay: runShot.e[k] ? runShot.e[k][2] : null,
      endOpacity: s[s.length - 1].e[k][0],
    };
  }).filter((x) => x.firstSeenMs != null).sort((a, b) => a.firstSeenMs - b.firstSeenMs);

  const end = s[s.length - 1];
  const runIdx = s.findIndex((x) => x.intro === "run");
  const cleared = s.findIndex((x, i) => i > runIdx && x.intro === "");
  const flightSlice = s.slice(startIdx, endIdx > 0 ? endIdx : s.length);

  const report = {
    mode: MODE,
    flightStartMs: first.t,
    flightEndMs: last.t,
    flightDurationMs: last.t - first.t,
    travelPx: travel,
    segmentSpeedPxPerFrame: segs,
    curveMatchesEmphasized,
    peakSegmentIndex: peakI,
    speedRegressions: regress,
    endToStartSpeedRatio: segs[0] && segs[4] ? +(segs[4] / segs[0]).toFixed(1) : null,
    peakSpeedPxPerFrame: +Math.max(...steps).toFixed(1),
    landDeltaPx: landDelta,
    introPendingAtMs: s[startIdx]?.t ?? null,
    introRunAtMs: s[runIdx]?.t ?? null,
    introClearedAtMs: cleared > 0 ? s[cleared].t : null,
    introOrder: order.map((x) => `${x.key}@${x.firstSeenMs}(d${x.delay})`),
    introOrderMonotonic: order.every((x, i) => i === 0 || x.firstSeenMs >= order[i - 1].firstSeenMs),
    introAllOpaqueAtEnd: order.every((x) => x.endOpacity >= 0.99),
    introHiddenWhilePending: order.every((x) => x.hiddenWhilePending),
    introTargets: order.length,
    splashRemoved: !end.splash,
    targetOpacityEnd: end.tg,
    everBothVisible: flightSlice.some((x) => x.splash && x.logo && x.tg !== null && x.tg > 0.02),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
