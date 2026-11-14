// 精确采样页面转场曲线（rAF，无网络往返抖动）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9383;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "beta3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b3m-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      up = true;
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token');localStorage.removeItem('dorm.notice.seen')}catch(e){}`,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `${WEB}/?native=1#home` });
  await sleep(4600);

  const curve = await evalJs(`(async () => {
    const nav = document.querySelectorAll('.nav__item');
    const pick = () => {
      const all = [...document.querySelectorAll('.pane')];
      const act = all.find(e => e.dataset.active === 'true');
      const out = all.filter(e => e.dataset.active !== 'true' && +getComputedStyle(e).opacity > 0.001);
      const c = act ? getComputedStyle(act) : null;
      const kids = act ? [...act.querySelectorAll(':scope > *, :scope > .home__body > *')].slice(0,4).map(e => +(+getComputedStyle(e).opacity).toFixed(3)) : [];
      return {
        o: c ? +(+c.opacity).toFixed(3) : null,
        s: c ? +parseFloat(c.transform.split('(')[1].split(',')[0]).toFixed(3) : null,
        out: out.map(e => +(+getComputedStyle(e).opacity).toFixed(3)),
        kids,
      };
    };
    const t0 = performance.now();
    const samples = [];
    nav[1].click();
    await new Promise(res => {
      const step = () => {
        const t = performance.now() - t0;
        samples.push({ t: Math.round(t), ...pick() });
        if (t < 640) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    return samples;
  })()`);

  const pickAt = (ms) => curve.reduce((a, b) => (Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a));
  const summary = [0, 60, 120, 200, 320, 480, 620].map((ms) => {
    const s = pickAt(ms);
    return { want: ms, t: s.t, opacity: s.o, scale: s.s, outgoing: s.out, kids: s.kids };
  });
  console.log(JSON.stringify(summary, null, 2));

  // 反向：任务 → 首页
  const back = await evalJs(`(async () => {
    const nav = document.querySelectorAll('.nav__item');
    const t0 = performance.now();
    const samples = [];
    nav[0].click();
    await new Promise(res => {
      const step = () => {
        const t = performance.now() - t0;
        const act = [...document.querySelectorAll('.pane')].find(e => e.dataset.active === 'true');
        const c = act ? getComputedStyle(act) : null;
        samples.push({ t: Math.round(t), o: c ? +(+c.opacity).toFixed(3) : null, s: c ? +parseFloat(c.transform.split('(')[1].split(',')[0]).toFixed(3) : null });
        if (t < 560) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    return samples;
  })()`);
  const pickB = (ms) => back.reduce((a, b) => (Math.abs(b.t - ms) < Math.abs(a.t - ms) ? b : a));
  console.log(JSON.stringify([0, 60, 120, 200, 320, 480].map((ms) => ({ want: ms, ...pickB(ms) })), null, 2));

  fs.writeFileSync(path.join(OUT, "motion.json"), JSON.stringify({ forward: curve, back }, null, 2));
  ws.close();
  process.exit(0);
})();
