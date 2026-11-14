// 量日历卡内部的真实盒子：标签 / 数值 / 单位 / 日格
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9398;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEB = Number(process.env.QA_PORT || 5297);

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "bp-"));
  const ch = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 80; i++) {
    try {
      if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break;
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
    return r.exceptionDetails ? "EX " + JSON.stringify(r.exceptionDetails).slice(0, 240) : r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/?flat=1` });
  await sleep(1300);
  await ev("localStorage.setItem('dorm.token','mock-token')");
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB}/?flat=1&r=home#home` });
  await sleep(2600);

  console.log(
    await ev(`(() => {
      const card = document.querySelector('.signcal');
      if (!card) return 'no .signcal';
      const c = card.getBoundingClientRect();
      const rel = (el) => { const r = el.getBoundingClientRect(); return { x: +(r.left - c.left).toFixed(1), y: +(r.top - c.top).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
      const out = ['card ' + JSON.stringify({ w: +c.width.toFixed(1), h: +c.height.toFixed(1) })];
      const month = card.querySelector('.signcal__month');
      out.push('month ' + JSON.stringify(rel(month)));
      const grid = card.querySelector('.signcal__grid');
      out.push('grid ' + JSON.stringify(rel(grid)));
      const cell = card.querySelector('.signcal__day');
      out.push('cell ' + JSON.stringify(rel(cell)));
      const stats = card.querySelector('.signcal__stats');
      out.push('stats ' + JSON.stringify(rel(stats)));
      for (const s of ['.signcal__statlabel', '.signcal__statvalue', '.signcal__statunit']) {
        out.push(s + ' ' + JSON.stringify(rel(card.querySelector(s))));
      }
      out.push('art ' + JSON.stringify(rel(card.querySelector('.signcal__art'))));
      return out.join('\\n');
    })()`),
  );

  ws.close();
  ch.kill();
})();
