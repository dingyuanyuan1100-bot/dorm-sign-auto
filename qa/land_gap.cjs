/* 两条进首页路径的「落位 → 组件入场」间隔验收
   ------------------------------------------------------------
   用法:
     node qa/land_gap.cjs boot   启动已登录、闪屏直接进首页
     node qa/land_gap.cjs login  登录页提交成功进首页
     node qa/land_gap.cjs both

   用 CDP 每 ~30ms 轮询一次（页面内 setInterval 在 headless 下会被节流，
   之前那个版本采样会断），量的是：
     swapAtMs    转场起跑（boot: 打 data-intro=pending；login: data-swap）
     runAtMs     组件入场起跑（data-intro=run）
     landAtMs    落位（boot: #boot-splash 被摘；login: 底板 opacity 归 0）
     firstAtMs   首个组件真的开始出现（.home__hi 计算 opacity > 0.02）
     gapMs       firstAtMs - landAtMs —— 负值表示内容和落位叠着走，没有空窗
     heroAtMs    主卡开始出现；navAtMs 底栏开始出现
     platePath   底板宽度轨迹，用来确认单调收缩、没有中途回弹
   产物: qa/live/landgap/<path>-report.json
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = process.env.QA_USER || "qacheck_1793717807";
const PASS = process.env.QA_PASS || "Qa123456";
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const OUT = path.join(__dirname, "live", "landgap");
fs.mkdirSync(OUT, { recursive: true });

const SNAP = `(function(){
  var st = document.querySelector('.stage'), l = document.querySelector('.login-layer');
  var veil = document.querySelector('.bs-veil');
  var hi = document.querySelector('.pane[data-active="true"] .home__hi');
  var hero = document.querySelector('.pane[data-active="true"] .hero');
  var nav = document.querySelector('.pane[data-active="true"] .nav');
  var plate = veil || l;
  var b = plate ? plate.getBoundingClientRect() : null;
  var op = function(n){ return n ? +(+getComputedStyle(n).opacity).toFixed(3) : null; };
  return JSON.stringify({
    t: Math.round(performance.now()) - (window.__t0 || 0),
    splash: !!document.getElementById('boot-splash'),
    swap: st ? st.dataset.swap || '' : '',
    intro: st ? st.dataset.intro || '' : '',
    plateW: b ? Math.round(b.width * 10) / 10 : null,
    plateX: b ? Math.round(b.left * 10) / 10 : null,
    plateOp: op(plate), hi: op(hi), hero: op(hero), nav: op(nav),
    tLand: window.__tLand ? window.__tLand - (window.__t0 || 0) : null
  });
})()`;

async function run(mode) {
  const PORT = 9500 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lg-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=390,844", "about:blank"], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  if (!up) throw new Error("CHROME_FAILED");

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
  const evalJs = async (e) => (await send("Runtime.evaluate", {
    expression: e, returnByValue: true, awaitPromise: true,
  })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // 每个新文档都把 __t0 记成文档起点；login 模式在提交那一刻覆盖成点击时刻
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__t0 = Math.round(performance.now());`,
  });

  if (mode === "boot") {
    await send("Page.navigate", { url: WEB });
    await sleep(2000);
    const token = await evalJs(`(async () => {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "${USER}", password: "${PASS}" }) });
      return (await r.json())?.data?.token || "";
    })()`);
    if (!token) throw new Error("LOGIN_FAILED");
    await evalJs(`localStorage.setItem("dorm.token", ${JSON.stringify(token)}); localStorage.removeItem("dorm.update.snoozed");`);
    await sleep(200);
    await send("Page.navigate", { url: WEB + "?native=1" });
  } else {
    await send("Page.navigate", { url: WEB + "?native=1" });
    await sleep(900);
    await evalJs(`localStorage.clear()`);
    await send("Page.reload");
    await sleep(3100);
    const fired = await evalJs(`(function(){
      var set = function(el, v){ var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      var u = document.querySelector('#lg-user'), p = document.querySelector('#lg-pwd');
      if (!u || !p) return 'NO_INPUT';
      set(u, '${USER}'); set(p, '${PASS}');
      var b = document.querySelector('.login__submit');
      if (!b) return 'NO_BTN';
      window.__t0 = Math.round(performance.now());
      b.click();
      return 'CLICKED';
    })()`);
    if (fired !== "CLICKED") throw new Error(fired);
  }

  const rows = [];
  const duration = mode === "boot" ? 4800 : 1900;
  const until = Date.now() + duration;
  while (Date.now() < until) {
    const raw = await evalJs(SNAP);
    if (raw) { try { rows.push(JSON.parse(raw)); } catch {} }
    await sleep(24);
  }

  const s = rows.filter((x) => x.t >= -10);
  const swapAt = s.find((x) => (mode === "boot" ? x.intro === "pending" : x.swap !== ""));
  const runAt = s.find((x) => x.intro === "run");
  const landAt = s.find((x) => (mode === "boot" ? !x.splash : x.plateOp != null && x.plateOp < 0.02));
  const tail = s.filter((x) => !swapAt || x.t >= swapAt.t);
  const firstAt = tail.find((x) => x.intro === "run" && x.hi != null && x.hi > 0.02);
  const heroAt = tail.find((x) => x.hero != null && x.hero > 0.02);
  const navAt = tail.find((x) => x.nav != null && x.nav > 0.02);
  const plate = s.filter((x) => x.plateW != null && (!swapAt || x.t >= swapAt.t));
  /* 只在底板还看得见的时候判回弹：落位后它会把 transform 复位回 390px
     并设 opacity:0，那一帧宽度变大但屏幕上完全不可见，不算回弹。 */
  let grow = 0;
  for (let i = 1; i < plate.length; i++)
    if ((plate[i].plateOp ?? 1) > 0.01 && (plate[i - 1].plateOp ?? 1) > 0.01 &&
        plate[i].plateW > plate[i - 1].plateW + 0.6) grow++;

  const report = {
    mode,
    swapAtMs: swapAt ? swapAt.t : null,
    runAtMs: runAt ? runAt.t : null,
    landAtMs: landAt ? landAt.t : null,
    probeLandMs: s.length ? s[s.length - 1].tLand : null,
    firstAtMs: firstAt ? firstAt.t : null,
    gapMs: landAt && firstAt ? firstAt.t - landAt.t : null,
    heroAtMs: heroAt ? heroAt.t : null,
    navAtMs: navAt ? navAt.t : null,
    plateGrowFrames: grow,
    platePath: plate.filter((_, i) => i % 2 === 0).map((x) => `${x.t}:${x.plateW}@${x.plateX}`),
    timeline: s.filter((_, i) => i % 3 === 0).map(
      (x) => `${x.t}:${x.swap || "-"}/${x.intro || "-"}:S${x.splash ? 1 : 0}:W${x.plateW}:hi${x.hi}:hero${x.hero}`,
    ),
  };
  fs.writeFileSync(path.join(OUT, `${mode}-report.json`), JSON.stringify(report, null, 2));
  await send("Browser.close").catch(() => {});
  chrome.kill();
  return report;
}

(async () => {
  const arg = process.argv[2] || "both";
  const modes = arg === "both" ? ["boot", "login"] : [arg];
  const out = {};
  for (const m of modes) {
    out[m] = await run(m);
    console.log(m, JSON.stringify({
      swapAtMs: out[m].swapAtMs, runAtMs: out[m].runAtMs, landAtMs: out[m].landAtMs,
      firstAtMs: out[m].firstAtMs, gapMs: out[m].gapMs,
      heroAtMs: out[m].heroAtMs, navAtMs: out[m].navAtMs,
      plateGrowFrames: out[m].plateGrowFrames,
    }));
  }
  process.exit(0);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
