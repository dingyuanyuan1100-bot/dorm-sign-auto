// 启动完成后，用户点公告的收起/展开必须仍然是弹簧动画（不是被 data-instant 冻住）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9395;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "nm-"));
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
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token');localStorage.removeItem('dorm.notice.seen');}catch(e){}`,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  await sleep(4200);

  const sample = (ms) =>
    evalJs(`new Promise((done)=>{
      const box=document.querySelector('.notice__body');
      const out=[];
      const t0=performance.now();
      const tick=()=>{ out.push([Math.round(performance.now()-t0), Math.round(box.getBoundingClientRect().height)]);
        if(performance.now()-t0<${ms}) requestAnimationFrame(tick); else done(out); };
      requestAnimationFrame(tick);
    })`);

  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  const collapse = await sample(700);
  await sleep(300);
  await evalJs("document.querySelector('.notice__head').click(); 'ok'");
  const expand = await sample(700);

  const uniq = new Set(collapse.map((x) => x[1]));
  const report = {
    collapseFrames: collapse.length,
    collapseDistinctHeights: uniq.size,
    collapseTail: collapse.slice(-4),
    expandFrames: expand.length,
    expandDistinctHeights: new Set(expand.map((x) => x[1])).size,
    expandTail: expand.slice(-4),
    animated: uniq.size > 3 && new Set(expand.map((x) => x[1])).size > 3,
  };
  fs.mkdirSync(path.join(__dirname, "intro"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "intro", "motion.json"), JSON.stringify({ report, collapse, expand }, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
  process.exit(0);
})();
