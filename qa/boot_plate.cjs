/* 启动「已登录直接进首页」路径的容器变换验收
   —— 闪屏的青柠底板（.bs-veil 390×844）应当整体收缩成右上角头像底块，
      终点与底块的矩形 / 圆角一模一样，然后才被摘掉。
   用法: node qa/boot_plate.cjs [port]
   产物: qa/live/bootplate/*.png + report.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/${process.env.QA_QS || ""}`;
const OUT = path.join(__dirname, "live", "bootplate");
const USER = "qacheck_1793717807", PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(OUT, { recursive: true });

const SAMPLER = `
window.__bp = [];
(function () {
  var rect = function (n) {
    if (!n) return null;
    var b = n.getBoundingClientRect();
    return [+b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)];
  };
  var t = setInterval(function () {
    var st = document.querySelector(".stage");
    var veil = document.querySelector(".bs-veil");
    var chip = document.querySelector('.pane[data-active="true"] .home__avatar');
    var cs = veil ? getComputedStyle(veil) : null;
    var m = cs && cs.transform && cs.transform !== "none" ? new DOMMatrixReadOnly(cs.transform) : null;
    var ccs = chip ? getComputedStyle(chip) : null;
    window.__bp.push({
      t: Math.round(performance.now()),
      splash: !!document.getElementById("boot-splash"),
      intro: st ? (st.dataset.intro || "") : "none",
      veil: rect(veil),
      chip: rect(chip),
      chipOp: chip ? +getComputedStyle(chip).opacity : null,
      chipInline: chip ? chip.getAttribute("style") : null,
      veilOp: cs ? +cs.opacity : null,
      radiusX: cs ? parseFloat(cs.borderTopLeftRadius) || 0 : null,
      sx: m ? Math.sqrt(m.a * m.a + m.b * m.b) : null,
      sy: m ? Math.sqrt(m.c * m.c + m.d * m.d) : null,
      chipRadius: ccs ? parseFloat(ccs.borderTopLeftRadius) || 0 : null
    });
    if (window.__bp.length > 600) clearInterval(t);
  }, 16);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bp-"));
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
  /* QA 账号没绑定晚寝账号时会弹一层灰色蒙层，挡住转场本身。
     只在 QA_HIDE_SHEET=1 时隐藏，正式验收数值不受影响。 */
  if (process.env.QA_HIDE_SHEET)
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `var s=document.createElement('style');s.textContent='.scrim,.sheet{display:none!important}';document.documentElement.appendChild(s);`,
    });

  // 先拿一次 token 塞进 localStorage，模拟「已登录启动」
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

  // 正式这一趟：从闪屏开始录
  const shots = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Page.screencastFrame") {
      const f = path.join(OUT, `f-${String(shots.length).padStart(3, "0")}.png`);
      fs.writeFileSync(f, Buffer.from(m.params.data, "base64"));
      shots.push({ file: f, ts: m.params.metadata.timestamp });
      send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
    }
  });
  await send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 390, maxHeight: 844 });
  await send("Page.navigate", { url: WEB });
  await sleep(2600);
  await send("Page.stopScreencast");

  const s = JSON.parse((await evalJs("JSON.stringify(window.__bp || [])")) || "[]");
  const land = JSON.parse((await evalJs(`(function(){
    var r = window.__plateLand;
    return JSON.stringify(r ? {
      rect: [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)],
      radius: window.__plateRadius || null,
      matrix: window.__plateScale || null
    } : null);
  })()`)) || "null");

  if (!s.length) { console.log("NO_SAMPLES"); process.exit(4); }

  const frames = s.filter((x) => x.splash && x.veil);
  const startRect = frames.length ? frames[0].veil : null;
  const fullW = frames.length ? Math.max(...frames.map((x) => x.veil[2])) : 0;
  const shrinkStart = frames.find((x) => x.veil[2] < fullW - 1) || null;
  const chipRect = (frames.find((x) => x.chip) || {}).chip || null;
  const chipRadius = (frames.find((x) => x.chipRadius > 0) || {}).chipRadius || null;

  let grow = 0;
  for (let i = 1; i < frames.length; i++)
    if (frames[i].veil[2] > frames[i - 1].veil[2] + 0.3) grow++;

  const landErr = land && chipRect
    ? Math.max(...[0, 1, 2, 3].map((i) => Math.abs(land.rect[i] - chipRect[i])))
    : null;
  const landRadiusVis = (() => {
    if (!land || !land.radius) return null;
    const m = /matrix\(([^)]+)\)/.exec(land.matrix || "");
    const sx = m ? Math.abs(parseFloat(m[1].split(",")[0])) : 1;
    return Math.round(parseFloat(land.radius) * sx * 100) / 100;
  })();

  /* 收缩开始之后、落位之前，底块不能提前露出来
     （否则中途会看到「一大一小两块青柠」）。收缩前的帧整屏都被 veil 盖着，不算。 */
  const chipVisibleEarly = frames.filter(
    (x) => shrinkStart && x.t >= shrinkStart.t && x.veil[2] > 45 && (x.chipOp ?? 1) > 0.05,
  ).length;

  // 收缩过程中青柠是否一直是实心（不该有半透明底板盖在首页上）
  const semiVeil = frames.filter((x) => x.veilOp != null && x.veilOp > 0.01 && x.veilOp < 0.98).length;

  const report = {
    samples: s.length,
    hasSplashFrames: frames.length,
    startRect,
    chipRect,
    chipRadius,
    shrinkStartMs: shrinkStart ? shrinkStart.t : null,
    landRect: land ? land.rect : null,
    landErrPx: landErr,
    landRadiusVis,
    growFrames: grow,
    semiVeilFrames: semiVeil,
    chipVisibleBeforeLand: chipVisibleEarly,
    chipInlineSample: (frames.find((x) => x.veil[2] < 300) || {}).chipInline || null,
    path: frames.filter((_, i) => i % 4 === 0).map(
      (x) => `${x.t}:${x.veil[0].toFixed(1)},${x.veil[1].toFixed(1)},w${x.veil[2].toFixed(1)}|chip${(x.chipOp ?? 0).toFixed(2)}`,
    ),
  };
  fs.writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify(shots.map((x) => ({ file: path.basename(x.file), ts: x.ts })), null, 2),
  );
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})();
