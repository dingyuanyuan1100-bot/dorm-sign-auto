// 2.0.11-beta4 验收：公告默认展开 / 点击收起展开 / 双向动画
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9385;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "beta4");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b4-"));
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

  const state = () =>
    evalJs(`(() => {
      const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};
      const n=document.querySelector('.notice');
      const bd=document.querySelector('.notice__body');
      const inner=document.querySelector('.notice__inner');
      const body=document.querySelector('.home__body');
      const sc=document.querySelector('.home__scroll');
      return {
        notice:r('.notice'), open:n?n.dataset.open:null,
        bodyH: bd?Math.round(bd.getBoundingClientRect().height):null,
        innerO: inner?+(+getComputedStyle(inner).opacity).toFixed(2):null,
        innerT: inner?getComputedStyle(inner).transform:null,
        homeT: body?getComputedStyle(body).transform:null,
        hero:r('.hero'), task1:r('.taskrow'), task2:[...document.querySelectorAll('.taskrow')][1]?r('.taskrow'):null,
        nav:r('.nav'), seen: localStorage.getItem('dorm.notice.seen')||'',
        scrollH: sc?sc.scrollHeight:null, clientH: sc?sc.clientHeight:null, scrollTop: sc?sc.scrollTop:null,
        btns: { more: !!document.querySelector('.notice__more'), x: !!document.querySelector('.notice__x'),
                sheet: !!document.querySelector('.sheet'), ntc: !!document.querySelector('.ntc__list') },
      };
    })()`);

  const boot = async () => {
    await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
    await sleep(4800);
    await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
    await sleep(700);
  };

  const sample = async (ms, label) => {
    const out = [];
    const t0 = Date.now();
    for (const at of ms) {
      const w = at - (Date.now() - t0);
      if (w > 0) await sleep(w);
      const s = await state();
      out.push({ at, h: s.bodyH, io: s.innerO, mt: s.homeT, hero: s.hero && s.hero[1] });
      if (label) await shot(`${label}-${at}`);
    }
    return out;
  };

  const report = {};
  await boot();
  await shot("01-expanded");
  report.expanded = await state();

  // 收起
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  report.collapse = await sample([40, 110, 200, 300, 460], "02-collapse");
  await sleep(300);
  await shot("03-collapsed");
  report.collapsed = await state();

  // 再展开
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  report.expand = await sample([40, 110, 200, 300, 460], "04-expand");
  await sleep(300);
  await shot("05-expanded-again");
  report.reExpanded = await state();

  // 重启：已读不再自动展开/出现
  await boot();
  report.revisit = await state();
  await shot("06-revisit");

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
})();
