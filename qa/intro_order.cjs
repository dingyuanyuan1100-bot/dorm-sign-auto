// 冷启动时序验收：首页内容（含公告）必须在 Logo 起飞前就位，落位后页面不再移动
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = process.env.QA_ANON === "1" ? 9394 : 9393;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, process.env.QA_ANON === "1" ? "intro-anon" : "intro");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "io-"));
  const child = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" }
  );

  for (let i = 0; i < 90; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      break;
    } catch {
      await sleep(200);
    }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pend.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evalJs = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  const ANON = process.env.QA_ANON === "1";
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      try{
        ${ANON ? "localStorage.removeItem('dorm.token');" : "localStorage.setItem('dorm.token','qa-token');"}
        localStorage.removeItem('dorm.notice.seen');
      }catch(e){}
      window.__samples = [];
      const tick = () => {
        const g = (s) => document.querySelector(s);
        const n = g('.notice');
        const h = g('.hero');
        const hi = g('.home__hi');
        const bd = g('.home__body');
        window.__samples.push({
          t: Math.round(performance.now()),
          splash: !!g('#boot-splash'),
          noticeH: n ? Math.round(n.getBoundingClientRect().height) : null,
          heroTop: h ? Math.round(h.getBoundingClientRect().top) : null,
          heroOpacity: h ? +(getComputedStyle(h).opacity) : null,
          hiOpacity: hi ? +(getComputedStyle(hi).opacity) : null,
          bodyShift: bd ? Math.round(new DOMMatrix(getComputedStyle(bd).transform).m42) : null,
        });
        if (window.__samples.length < 120) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    `,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  await sleep(1250);
  await shot("02-mid-flight");
  await sleep(2950);
  await shot("01-home-after-boot");

  const probe = await evalJs(`(() => ({
    prime: window.__tPrime || 0,
    notice: window.__noticeAt || 0,
    land: window.__tLand || 0,
    pend: window.__tPend || 0,
    run: window.__tRun || 0,
    samples: window.__samples,
  }))()`);

  const { prime, notice, land, samples } = probe;
  const near = (t) => samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a), samples[0]);
  const atPrime = near(prime);
  const atLand = near(land);
  const last = samples[samples.length - 1];

  // 落位之后是否还有位移/透明度变化
  const after = samples.filter((s) => s.t > land + 30);
  // 公告落位后到 Logo 落位前：这段时间页面也不该动
  const mid = notice > 0 ? samples.filter((s) => s.t > notice + 80 && s.t < land - 20) : [];
  const moved = {
    heroTop: new Set(after.map((s) => s.heroTop)).size,
    heroOpacity: Math.max(...after.map((s) => s.heroOpacity || 0)) - Math.min(...after.map((s) => s.heroOpacity || 0)),
    noticeH: new Set(after.map((s) => s.noticeH)).size,
    bodyShift: new Set(after.map((s) => s.bodyShift)).size,
  };

  const report = {
    timeline: { prime, notice, land, gapNoticeToLand: land - notice, gapPrimeToLand: land - prime },
    // 关键：公告与入场都在 Logo 落位前完成
    noticeBeforeLand: notice > 0 && notice < land,
    introSettledBeforeLand: prime > 0 && land - prime >= 588,
    stableAfterLand: moved,
    stableBeforeLand: {
      frames: mid.length,
      heroTop: new Set(mid.map((s) => s.heroTop)).size,
      heroOpacity: mid.length ? Math.max(...mid.map((s) => s.heroOpacity || 0)) - Math.min(...mid.map((s) => s.heroOpacity || 0)) : null,
      noticeH: new Set(mid.map((s) => s.noticeH)).size,
      bodyShift: new Set(mid.map((s) => s.bodyShift)).size,
    },
    atPrime,
    atLand,
    last,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "samples.json"), JSON.stringify(samples));
  console.log(JSON.stringify({ ...report, samples: samples.length }, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
})();
