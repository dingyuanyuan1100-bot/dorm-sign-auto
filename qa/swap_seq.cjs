/* 登录成功 → 首页 转场验收（fade-through 版）
   ------------------------------------------------------------
   想证明两件事（都是用户真机截图挑出来的）：
   1. 中途没有「整页发白 / Logo 变灰」的混色帧：登录内容还看得见的时候，
      它必须在**完全不透明**的青柠底板上（layer opacity = 1），
      而白色 .app 也必须已经是 1 —— 两个半透明层叠在一起才是灰。
   2. 底板褪完时页面已经有内容：不能出现「只剩头像的纯白空窗」。
   用法: node qa/swap_seq.cjs [port]
   产物: qa/live/swap/frame-XXX.png + report.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9710 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/?native=1`;
const OUT = path.join(__dirname, "live", "swap");
const USER = process.env.QA_USER || "qacheck_1793717807";
const PASS = process.env.QA_PASS || "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 不清空目录：Windows 回收站在帧数多时可能抛「Some operations were aborted」。
   帧从 frame-000 起顺序覆盖，index.json 只引用本轮写入的那些，
   目录里多出来的旧帧不参与验收。 */
fs.mkdirSync(OUT, { recursive: true });

const SAMPLER = `
window.__sw = [];
(function () {
  var q = function (s) { return document.querySelector(s); };
  var op = function (n) { return n ? +getComputedStyle(n).opacity : null; };
  var t = setInterval(function () {
    var st = document.querySelector(".stage");
    var layer = q(".login-layer"), app = q(".app"), logo = q(".login__logo"),
        card = q(".login__card"), hi = q(".home__hi"), hero = q(".hero");
    var fly = document.querySelector("#swap-fly svg");
    var dst = q('.pane[data-active="true"] .home__avatar svg');
    var src = q(".login__logo svg");
    var chip = q('.pane[data-active="true"] .home__avatar');
    var blob = q(".login__blob");
    var plateEl = q(".login");
    var fr = fly ? fly.getBoundingClientRect() : null;
    var dr = dst ? dst.getBoundingClientRect() : null;
    var lr = plateEl ? plateEl.getBoundingClientRect() : null;
    var cr = chip ? chip.getBoundingClientRect() : null;
    var pcs = plateEl ? getComputedStyle(plateEl) : null;
    var pm = pcs && pcs.transform && pcs.transform !== "none" ? new DOMMatrixReadOnly(pcs.transform) : null;
    var ccs = chip ? getComputedStyle(chip) : null;
    var rect = function (r) { return r ? [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10,
                                          Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] : null; };
    window.__sw.push({
      t: Math.round(performance.now()),
      intro: st ? (st.dataset.intro || "") : "none",
      swap: st ? (st.dataset.swap || "") : "none",
      layer: op(layer), app: op(app), logo: op(logo), card: op(card),
      hi: op(hi), hero: op(hero),
      fly: rect(fr), dst: rect(dr), plate: rect(lr), chip: rect(cr),
      blob: op(blob),
      plateOp: plateEl ? +getComputedStyle(plateEl).opacity : null,
      radiusX: pcs ? parseFloat(pcs.borderTopLeftRadius) || 0 : null,
      plateSx: pm ? Math.sqrt(pm.a * pm.a + pm.b * pm.b) : null,
      plateSy: pm ? Math.sqrt(pm.c * pm.c + pm.d * pm.d) : null,
      chipRadius: ccs ? parseFloat(ccs.borderTopLeftRadius) || 0 : null,
      dstVis: dst ? getComputedStyle(dst).visibility : null,
      srcVis: src ? getComputedStyle(src).visibility : null,
      vis: getComputedStyle(layer).visibility,
      appVis: getComputedStyle(app).visibility
    });
    if (window.__sw.length > 400) clearInterval(t);
  }, 16);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sw-"));
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

  const evalJs = async (e) => (await send("Runtime.evaluate", {
    expression: e, returnByValue: true, awaitPromise: true,
  })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
  /* QA 账号没绑定晚寝账号时会弹一层灰色蒙层，挡住转场本身。
     只在 QA_HIDE_SHEET=1 时隐藏，正式验收数值不受影响。 */
  if (process.env.QA_HIDE_SHEET)
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `var s=document.createElement('style');s.textContent='.scrim,.sheet{display:none!important}';document.documentElement.appendChild(s);`,
    });
  await send("Page.navigate", { url: WEB });
  await sleep(900);
  await evalJs(`localStorage.clear()`);
  await send("Page.reload");
  await sleep(3000);

  await send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });

  const fired = await evalJs(`(function(){
    var set = function(el, v){ var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    var u = document.querySelector('#lg-user'), p = document.querySelector('#lg-pwd');
    if (!u || !p) return 'NO_INPUT';
    set(u, '${USER}'); set(p, '${PASS}');
    var b = document.querySelector('.login__submit');
    if (!b) return 'NO_BTN';
    window.__clickAt = Math.round(performance.now());
    b.click();
    return 'CLICKED';
  })()`);
  await sleep(1800);
  await send("Page.stopScreencast").catch(() => {});

  const s = JSON.parse((await evalJs("JSON.stringify(window.__sw || [])")) || "[]");
  const clickAt = await evalJs("window.__clickAt || 0");
  const plateLand = JSON.parse(
    (await evalJs(`(function(){
      var r = window.__plateLand;
      return JSON.stringify(r ? {
        rect: [Math.round(r.left*100)/100, Math.round(r.top*100)/100,
               Math.round(r.width*100)/100, Math.round(r.height*100)/100],
        radius: window.__plateRadius || null,
        matrix: window.__plateScale || null
      } : null);
    })()`)) || "null",
  );
  const after = s.filter((x) => x.t >= clickAt);

  /* ---- 判据 ---- */
  // 灰帧判据：登录内容还看得见（0.04~0.98）时，
  // 底板与 .app 必须都已经是完全不透明 —— 两个半透明层叠加才会混出灰。
  const dirty = after.filter((x) => {
    const ink = (x.layer ?? 1) * (x.srcVis === "hidden" ? 0 : (x.logo ?? 1));
    const seen = ink > 0.04 && ink < 0.98;
    return seen && !(x.layer >= 0.98 && x.app >= 0.98);
  });

  // 底板开始褪的时刻：layer 首次 < 0.98；褪完：layer < 0.02
  const fadeStart = after.find((x) => x.layer < 0.98);
  const fadeEnd = after.find((x) => x.layer < 0.02);
  const swapOn = after.findIndex((x) => x.swap);
  const firstContent = after.slice(swapOn < 0 ? 0 : swapOn).find((x) => x.hi != null && x.hi > 0.02);

  /* ---- Logo 飞行判据 ---- */
  const withFly = after.filter((x) => x.fly);
  const lastFly = withFly[withFly.length - 1] || null;
  const flyStartMs = withFly.length ? withFly[0].t - clickAt : null;
  const flyEndMs = lastFly ? lastFly.t - clickAt : null;
  const landErr = lastFly && lastFly.dst
    ? Math.max(...[0, 1, 2, 3].map((i) => Math.abs(lastFly.fly[i] - lastFly.dst[i])))
    : null;
  // 落位那一帧：dst 已经可见，且飞行物已被移除
  const landIdx = after.findIndex((x, i) => i > 0 && !x.fly && after[i - 1].fly);
  const landed = landIdx > 0 ? after[landIdx] : null;
  // 起点、终点同时可见的帧（会出现两份图标）
  const doubleFrames = after.filter((x) => x.fly && x.srcVis === "visible").length;
  const dstEarlyFrames = after.filter((x) => x.fly && x.dstVis === "visible").length;

  /* ---- 底板收缩判据 ----
     看三件事：①底板确实从整屏收到头像大小、且单调（不来回弹）；
     ②收缩开始时登录内容已经看不见（不能出现文字浮在缩小的底板外）；
     ③落位后的那 70ms 淡出，必须发生在底板已经与头像同矩形之后
       —— 否则就是「一大块半透明青柠」，那才会混色。 */
  const plateSamples = after.filter((x) => x.plate);
  const fullW = plateSamples.length ? Math.max(...plateSamples.map((x) => x.plate[2])) : 0;
  const chipRect = (plateSamples.find((x) => x.chip) || {}).chip || null;
  const chipW = chipRect ? chipRect[2] : 0;
  const shrinkStart = plateSamples.find((x) => x.plate[2] < fullW - 1) || null;
  let plateGrow = 0;
  for (let i = 1; i < plateSamples.length; i++)
    if (plateSamples[i].swap && plateSamples[i - 1].swap &&
        plateSamples[i].plate[2] > plateSamples[i - 1].plate[2] + 0.3) plateGrow++;
  /* 只在「底板还在台上、正在收」的帧里判：收完后元素复位成 375，
     opacity 也归 0，那之后的采样不该算作重叠。 */
  const contentOverShrink = after.filter(
    (x) =>
      x.swap === "shrink" &&
      x.plate && x.plate[2] < fullW - 2 &&
      (x.plateOp ?? 0) > 0.01 &&
      Math.max(x.logo ?? 0, x.card ?? 0) > 0.04,
  );
  // 半透明底板的帧：现在是「落位后直接切」，一帧都不该有
  const semiFrames = after.filter((x) => x.layer != null && x.layer > 0.01 && x.layer < 0.98);
  /* 真正的落位值（transition 走完那一刻，由页面探针记下）：
     与底块的矩形、圆角都要一模一样，否则摘掉底板那一帧会跳。 */
  const plateLandErr = plateLand && chipRect
    ? Math.max(...[0, 1, 2, 3].map((i) => Math.abs(plateLand.rect[i] - chipRect[i])))
    : null;
  const landRadiusVis = (() => {
    if (!plateLand || !plateLand.radius) return null;
    const m = /matrix\(([^)]+)\)/.exec(plateLand.matrix || "");
    const sx = m ? Math.abs(parseFloat(m[1].split(",")[0])) : 1;
    return Math.round(parseFloat(plateLand.radius) * sx * 100) / 100;
  })();
  const chipRadius = (plateSamples.find((x) => x.chipRadius > 0) || {}).chipRadius || null;
  const chipRadiusVis = chipRadius;
  // 最后一帧还看得见底板时，它是否整个人落在头像底块里（切掉才看不见）
  const lastPlate = [...plateSamples].reverse().find((x) => x.swap) || null;
  const plateInsideChip = lastPlate && chipRect
    ? lastPlate.plate[0] >= chipRect[0] - 0.5 &&
      lastPlate.plate[1] >= chipRect[1] - 0.5 &&
      lastPlate.plate[0] + lastPlate.plate[2] <= chipRect[0] + chipRect[2] + 0.5 &&
      lastPlate.plate[1] + lastPlate.plate[3] <= chipRect[1] + chipRect[3] + 0.5
    : null;

  const report = {
    fired,
    flyStartMs, flyEndMs, landErrPx: landErr,
    landDstVisible: landed ? landed.dstVis === "visible" : null,
    landFlyGone: landed ? landed.fly === null : null,
    doubleFrames, dstEarlyFrames,
    flyPath: withFly.filter((_, i) => i % 3 === 0).map((x) => `${x.t - clickAt}:${x.fly[0]},${x.fly[1]},w${x.fly[2]}`),
    samples: after.length,
    timeline: after.filter((_, i) => i % 2 === 0).map(
      (x) => `${x.t - clickAt}:${x.swap || "-"}${x.intro ? "/" + x.intro : ""}:L${(x.layer ?? 0).toFixed(2)}:A${(x.app ?? 0).toFixed(2)}:W${(x.plate ? x.plate[2] : 0).toFixed(0)}:logo${(x.logo ?? 0).toFixed(2)}:card${(x.card ?? 0).toFixed(2)}:hi${(x.hi ?? 0).toFixed(2)}:hero${(x.hero ?? 0).toFixed(2)}`,
    ),
    fadeStartMs: fadeStart ? fadeStart.t - clickAt : null,
    fadeEndMs: fadeEnd ? fadeEnd.t - clickAt : null,
    heroStartMs: firstContent ? firstContent.t - clickAt : null,
    appMinOpacity: after.reduce((m, x) => Math.min(m, x.app ?? 1), 1),
    dirtyFrames: dirty.map((x) => `${x.t - clickAt}:L${(x.layer ?? 0).toFixed(2)}:A${(x.app ?? 0).toFixed(2)}`),
    cleanCount: after.length - dirty.length,
    plateFullW: fullW, plateChipW: chipW,
    shrinkStartMs: shrinkStart ? shrinkStart.t - clickAt : null,
    plateEndMs: lastPlate ? lastPlate.t - clickAt : null,
    plateGrowFrames: plateGrow,
    contentOverShrinkFrames: contentOverShrink.length,
    plateSemiFrames: semiFrames.length,
    landPlateRect: plateLand ? plateLand.rect : null,
    landPlateErrPx: plateLandErr,
    landRadiusVis,
    chipRadiusVis,
    contentOverShrinkAt: contentOverShrink.slice(0, 6).map((x) => `${x.t - clickAt}:logo${(x.logo ?? 0).toFixed(2)}/card${(x.card ?? 0).toFixed(2)}/W${x.plate[2].toFixed(0)}`),
    plateInsideChipLastFrame: plateInsideChip,
    plateLastRect: lastPlate ? lastPlate.plate : null,
    chipRect,
    blobFadedBy: (() => {
      const b = after.filter((x) => x.blob != null && x.blob < 0.05)[0];
      return b ? b.t - clickAt : null;
    })(),
    platePath: plateSamples.filter((_, i) => i % 3 === 0).map(
      (x) => `${x.t - clickAt}:${x.plate[0]},${x.plate[1]},w${x.plate[2]}`,
    ),
    layerMono: (() => {
      const arr = after.map((x) => x.layer ?? 0);
      let bad = 0;
      for (let i = 1; i < arr.length; i++) if (arr[i] > arr[i - 1] + 0.02) bad++;
      return bad;
    })(),
    raw: after.map((x) => `${x.t - clickAt}|${x.swap || "-"}|L${(x.layer ?? 0).toFixed(2)}|W${x.plate ? x.plate[2] : 0}|R${((x.radiusX || 0) * (x.plateSx || 1)).toFixed(1)}|A${(x.app ?? 0).toFixed(2)}|logo${(x.logo ?? 0).toFixed(2)}|card${(x.card ?? 0).toFixed(2)}|${x.vis}`),
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...report, frames: frames.length }, null, 2));

  const t0 = frames.length ? frames[0].ts : 0;
  const list = frames.map((f) => ({ file: f.file, ms: Math.round((f.ts - t0) * 1000) }));
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(list, null, 2));

  console.log(JSON.stringify({ ...report, frameCount: frames.length }, null, 2));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
