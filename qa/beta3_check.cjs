// 2.0.11-beta3 验收：公告栏 / 状态图标 / 页面转场
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9381;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "beta3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b3-"));
  spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });

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
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token')}catch(e){}`,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  const boot = async () => {
    await send("Page.navigate", { url: `${WEB}/?native=1#home` });
    await sleep(4600);
    await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
    await sleep(400);
  };

  const layout = () =>
    evalJs(`(() => {
      const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};
      const cs=(s)=>{const e=document.querySelector(s); return e?getComputedStyle(e).transform:null};
      return {
        notice: r('.notice'), hero: r('.hero'), statA: r('.stat--a'), statB: r('.stat--b'),
        section: r('.section-head'), task1: r('.taskrow'), nav: r('.nav'),
        bodyT: cs('.home__body'), seen: localStorage.getItem('dorm.notice.seen') || '',
        icon: (()=>{const s=document.querySelector('.stat__check'); return s?{fail:s.dataset.fail,empty:s.dataset.empty,rect:r('.stat__check')}:null})(),
      };
    })()`);

  const first = {};
  await boot();
  await shot("01-home-notice");
  first.withNotice = await layout();

  await evalJs("document.querySelector('.notice__main').click(); 'ok'");
  await sleep(620);
  await shot("02-notice-sheet");
  const sheet = await evalJs(
    "(() => { const s=document.querySelector('.sheet'); const b=s&&s.getBoundingClientRect(); return b?[Math.round(b.top),Math.round(b.height)]:null })()",
  );
  await evalJs("[...document.querySelectorAll('.ntc__ok')].map(b=>b.click()); 'ok'");
  await sleep(700);
  await shot("03-home-collapsed");
  first.afterRead = await layout();

  await boot();
  await shot("04-home-revisit");
  first.revisit = await layout();

  // 转场：首页 → 任务
  await evalJs("document.querySelectorAll('.nav__item')[1].click(); 'ok'");
  const frames = [];
  const t0 = Date.now();
  for (const at of [0, 70, 140, 240, 380, 560]) {
    const wait = at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const m = await evalJs(`(() => {
      const p=[...document.querySelectorAll('.pane')].find(e=>e.dataset.active==='true');
      const old=[...document.querySelectorAll('.pane')].filter(e=>e.dataset.active!=='true');
      const out=old.map(e=>{const s=getComputedStyle(e); return s.opacity}).filter(o=>+o>0.01);
      const s=p?getComputedStyle(p):null;
      const kids=[...(p?p.querySelectorAll(':scope > *'):[])].slice(0,3).map(e=>{
        const cs=getComputedStyle(e); return { n:e.className, o:+(+cs.opacity).toFixed(2), t:cs.transform.replace(/matrix\\(|\\)/g,'').split(',').slice(4,6).map(v=>(+v).toFixed(1)).join(',') };
      });
      return { route: location.hash, o:s?+s.opacity:null, t:s?s.transform:null, outro:+out.length, kids };
    })()`);
    frames.push({ at, ...m });
    await shot(`05-trans-${at}`);
  }

  await sleep(500);
  await shot("06-tasks");
  const tasksLayout = await layout();

  ws.close();
  fs.writeFileSync(
    path.join(OUT, "report.json"),
    JSON.stringify({ layout: first, sheet, frames, tasksLayout }, null, 2),
  );
  console.log(JSON.stringify({ layout: first, sheet, frames, tasksLayout }, null, 2));
  process.exit(0);
})();
