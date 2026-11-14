// 线上公告 × beta5 前端：验证「公告由服务器下发」这条链路，并出图
// 前置：mock_logs.cjs 以 NOTICE_FROM=prod 运行（只 mock /api，/update 转发线上）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9391;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "prod");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // 线上真身，作为比对基准
  const prod = await (await fetch("https://175.24.230.58/update/notice.json?" + Date.now())).json();

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pn-"));
  const child = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" }
  );

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
  const seen = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Network.responseReceived" && /\/update\/notice\.json/.test(m.params.response.url)) {
      seen.push({ url: m.params.response.url, status: m.params.response.status, mime: m.params.response.mimeType });
    }
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
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token')}catch(e){}`,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  const state = () =>
    evalJs(`(() => {
      const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)];};
      const n=document.querySelector('.notice');
      return {
        noticeBox:r('.notice'), open:n?n.dataset.open:null,
        title:document.querySelector('.notice__title')?document.querySelector('.notice__title').textContent.trim():null,
        tag:document.querySelector('.notice__tag')?document.querySelector('.notice__tag').textContent.trim():null,
        items:[...document.querySelectorAll('.notice__list li')].map(e=>e.textContent.trim()),
        note:document.querySelector('.notice__note')?document.querySelector('.notice__note').textContent.trim():null,
        tip:document.querySelector('.notice__tip')?document.querySelector('.notice__tip').textContent.trim():null,
        noteBox:r('.notice__note'), tipBox:r('.notice__tip'),
        hero:r('.hero'), nav:r('.nav'),
        scrollH:(document.querySelector('.home__scroll')||{}).scrollHeight||null,
        seen:localStorage.getItem('dorm.notice.seen')||'',
      };
    })()`);

  // 1) 首次进入（无 seen）：应自动展开
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  await sleep(4800);
  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(1400);
  await shot("01-home-expanded");
  const expanded = await state();

  // 2) 收起
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  await sleep(800);
  await shot("02-home-collapsed");
  const collapsed = await state();

  // 3) 重启（已读）：条还在，默认收起
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  await sleep(4600);
  await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
  await sleep(1200);
  await shot("03-home-revisit");
  const revisit = await state();

  // 4) 再点开，看完整正文
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  await sleep(800);
  await shot("04-home-reopen");
  const reopen = await state();

  const norm = (s) => (s || "").replace(/\s+/g, "");
  // .notice__note 里同时装着说明段和提示段，比较说明段时先把 tip 从尾部剥掉
  const noteOnly = norm(expanded.note).endsWith(norm(prod.tip))
    ? norm(expanded.note).slice(0, norm(expanded.note).length - norm(prod.tip).length)
    : norm(expanded.note);
  const checks = {
    titleMatch: norm(expanded.title) === norm(prod.title),
    itemsMatch: JSON.stringify(expanded.items.map(norm)) === JSON.stringify((prod.items || []).map(norm)),
    noteMatch: noteOnly === norm(prod.note),
    tipMatch: norm(expanded.tip) === norm(prod.tip),
    autoExpandFirst: expanded.open === "true",
    collapsedAfterClick: collapsed.open === "false",
    stillVisibleRevisit: !!revisit.noticeBox,
    collapsedOnRevisit: revisit.open === "false",
    reopenWorks: reopen.open === "true",
    seenPersisted: revisit.seen === prod.id,
  };

  const report = { prodId: prod.id, prodTitle: prod.title, network: seen, expanded, collapsed, revisit, reopen, checks };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
})();
