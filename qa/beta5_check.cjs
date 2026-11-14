// 2.0.11-beta5 验收：
// A. 日志页只有列表滚动，标题/统计固定
// B. 公告常驻：首次展开、之后默认收起、底部运维说明
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9387;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "beta5");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b5-"));
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

  const R = `(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];}`;

  const logsState = () =>
    evalJs(`(() => {
      const r=${R};
      const sc=document.querySelector('.logs__scroll');
      const rows=[...document.querySelectorAll('.logrow')].map(e=>{const b=e.getBoundingClientRect();return [Math.round(b.top),Math.round(b.bottom)];});
      return {
        title:r('.pane[data-active="true"] .page-title'), head:r('.pane[data-active="true"] .head-btn'),
        ok:r('.stat--ok'), fail:r('.stat--fail'),
        scroll:r('.logs__scroll'), nav:r('.nav'),
        hasScreenScroll: !!document.querySelector('.pane[data-active="true"] .screenscroll'),
        scrollTop: sc?Math.round(sc.scrollTop):null, scrollH: sc?sc.scrollHeight:null, clientH: sc?sc.clientHeight:null,
        rows, groups: document.querySelectorAll('.pane[data-active="true"] .group-label').length,
      };
    })()`);

  const homeState = () =>
    evalJs(`(() => {
      const r=${R};
      const n=document.querySelector('.notice');
      const bd=document.querySelector('.notice__body');
      const note=document.querySelector('.notice__note');
      const sc=document.querySelector('.home__scroll');
      return {
        notice:r('.notice'), open:n?n.dataset.open:null,
        bodyH: bd?Math.round(bd.getBoundingClientRect().height):null,
        note:r('.notice__note'), noteText: note?note.textContent.trim():null,
        noteFont: note?getComputedStyle(note).fontSize+'/'+getComputedStyle(note).lineHeight:null,
        hero:r('.hero'), task1:r('.taskrow'), task2:[...document.querySelectorAll('.taskrow')][1]?r('.taskrow'):null,
        nav:r('.nav'), bodyTop: (()=>{const b=document.querySelector('.home__body'); return b?Math.round(b.getBoundingClientRect().top):null;})(),
        scrollH: sc?sc.scrollHeight:null, clientH: sc?sc.clientHeight:null,
        seen: localStorage.getItem('dorm.notice.seen')||'',
        title: document.querySelector('.notice__title')?document.querySelector('.notice__title').textContent:null,
      };
    })()`);

  const go = async (hash) => {
    await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#${hash}` });
    await sleep(4600);
    await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
    await sleep(800);
  };

  const report = {};

  // ---------- A. 日志页 ----------
  await go("logs");
  await shot("01-logs-rest");
  report.logsRest = await logsState();

  await evalJs("document.querySelector('.logs__scroll').scrollTop = 400; 'ok'");
  await sleep(500);
  await shot("02-logs-scrolled-mid");
  report.logsMid = await logsState();

  await evalJs("const s=document.querySelector('.logs__scroll'); s.scrollTop = s.scrollHeight; 'ok'");
  await sleep(600);
  await shot("03-logs-bottom");
  report.logsBottom = await logsState();

  // 滚动是否只发生在列表上：标题/统计矩形必须和静止态一致
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  report.lockCheck = {
    titleLocked: same(report.logsRest.title, report.logsBottom.title),
    okLocked: same(report.logsRest.ok, report.logsBottom.ok),
    failLocked: same(report.logsRest.fail, report.logsBottom.fail),
    headLocked: same(report.logsRest.head, report.logsBottom.head),
  };

  // ---------- B. 公告 ----------
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}&fresh=1#home` });
  await sleep(4600);
  await evalJs("try{localStorage.removeItem('dorm.notice.seen')}catch(e){}; 1");
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}&fresh=2#home` });
  await sleep(4600);
  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(1200);
  await shot("04-home-first");
  report.homeFirst = await homeState();

  // 收起
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  await sleep(700);
  await shot("05-home-collapsed");
  report.homeCollapsed = await homeState();

  // 重启（已读）：公告条应仍在，但默认收起
  await go("home");
  await shot("06-home-revisit");
  report.homeRevisit = await homeState();

  // 再次点开
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  await sleep(700);
  await shot("07-home-reopen");
  report.homeReopen = await homeState();

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
})();
