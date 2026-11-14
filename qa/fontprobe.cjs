// 运行时字体探针：打印标题的计算字体 + 字体加载状态
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9399;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB = Number(process.env.QA_PORT || 5297);

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "fp-"));
  const ch = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 80; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (v) break;
    } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const p = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const q = p.get(m.id);
      p.delete(m.id);
      m.error ? q.j(new Error(JSON.stringify(m.error))) : q.r(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r, j) => {
      const mid = ++id;
      p.set(mid, { r, j });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const ev = async (x) => {
    const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? "EX " + JSON.stringify(r.exceptionDetails).slice(0, 200) : r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/?flat=1` });
  await sleep(1500);
  await ev("localStorage.setItem('dorm.token','mock-token')");
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/?flat=1&r=me#me` });
  await sleep(2600);

  const line = (sel) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return ${JSON.stringify(sel)} + ' : none';
    const cs = getComputedStyle(el);
    return ${JSON.stringify(sel)} + ' | ' + cs.fontFamily + ' | w=' + cs.fontWeight + ' | ' + cs.fontSize + ' | text=' + JSON.stringify(el.textContent.trim().slice(0,6));
  })()`;

  for (const sel of [".page-title", ".login__title"]) {
    console.log(await ev(line(sel)));
  }

  // 打开意见反馈浮层
  await ev(`(() => { const rs=[...document.querySelectorAll('.listrow')]; const r=rs.find(x=>x.textContent.includes('意见反馈')); r&&r.click(); return !!r; })()`);
  await sleep(900);
  for (const sel of [".fb__title", ".fb__label", ".fbd__title"]) {
    console.log(await ev(line(sel)));
  }

  ws.close();
  ch.kill();
})();
