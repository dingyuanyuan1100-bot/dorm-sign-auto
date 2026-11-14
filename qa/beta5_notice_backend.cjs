// 2.0.11-beta5 验收（B）：公告全部走后端下发
// 1) 后端改内容 → 不重新打包，App 下次进入即拿到新公告并自动展开
// 2) 后端 404 → 用本地最近一次成功拉取的副本兜底
// 3) 后端 404 且无本地副本 → 首页不显示公告条
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9389;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "beta5");
const NOTICE_FILE = path.join(__dirname, "notice.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const original = fs.readFileSync(NOTICE_FILE, "utf8");

const writeNotice = (obj) => fs.writeFileSync(NOTICE_FILE, JSON.stringify(obj, null, 2) + "\n", "utf8");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b5n-"));
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
      const n=document.querySelector('.notice');
      const t=document.querySelector('.notice__title');
      const note=document.querySelector('.notice__note');
      return {
        has: !!n, open: n?n.dataset.open:null,
        title: t?t.textContent:null,
        note: note?note.textContent.slice(0,24):null,
        noteH: note?Math.round(note.getBoundingClientRect().height):0,
        bar: n?Math.round(n.getBoundingClientRect().height):0,
        seen: localStorage.getItem('dorm.notice.seen')||'',
        cache: (localStorage.getItem('dorm.notice.cache')||'').slice(0,40),
        noticeUrl: window.__nurl||null,
      };
    })()`);

  const open = async (tag, clearAll) => {
    await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
    if (clearAll) {
      await sleep(300);
      await evalJs("try{localStorage.removeItem('dorm.notice.seen');localStorage.removeItem('dorm.notice.cache')}catch(e){}; 1");
      await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
    }
    await sleep(4600);
    await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
    await sleep(900);
    if (tag) await shot(tag);
    return state();
  };

  const report = {};

  // 1) 后端下发的第一条公告
  report.fromBackend = await open("10-backend-a");

  // 2) 只改后端文件，不重新打包 → 新公告自动展开
  writeNotice({
    id: "20261106a",
    date: "2026-11-06",
    title: "热更新测试：这条只改后端",
    items: ["前端一行代码没动", "重新进入 App 就能看到"],
    note: "这条文案完全来自 /update/notice.json。",
    tip: "把时间设置在 21:30 ~ 23:30 之间。",
  });
  report.hotUpdate = await open("11-backend-b");

  // 收起后重进：常驻但默认收起
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  await sleep(600);
  report.afterCollapse = await open("12-backend-b-collapsed");

  // 3) 后端 404 → 本地副本兜底
  await fetch("http://127.0.0.1:8807/api/__notice?on=0");
  report.backendDown = await open("13-backend-down");
  await fetch("http://127.0.0.1:8807/api/__notice?on=1");

  // 4) 404 + 无副本 → 不显示公告条（并恢复原文件）
  writeNotice(JSON.parse(original));
  await fetch("http://127.0.0.1:8807/api/__notice?on=0");
  report.noNotice = await open("14-no-notice", true);
  await fetch("http://127.0.0.1:8807/api/__notice?on=1");

  fs.writeFileSync(path.join(OUT, "report-backend.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => {
  fs.writeFileSync(NOTICE_FILE, original);
  console.error(e);
  process.exit(1);
});
