// 失败态与成功态图标对照截图
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9385;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const API = "http://127.0.0.1:8807";
const OUT = path.join(__dirname, "beta3");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "b3i-"));
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
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token');localStorage.setItem('dorm.notice.seen','20261105')}catch(e){}`,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 4, mobile: true });

  const boot = async () => {
    await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
    await sleep(4600);
  };

  for (const fail of [0, 1]) {
    await fetch(`${API}/api/__ok?fail=${fail}`);
    await boot();
    await shot(`icon-${fail ? "fail" : "ok"}-home`);
    const box = await evalJs(
      "(() => { const e=document.querySelector('.stat__check'); const b=e&&e.getBoundingClientRect(); const c=document.querySelector('.stat--b').getBoundingClientRect(); return {icon:[Math.round(b.left),Math.round(b.top),Math.round(b.width)], card:[Math.round(c.left),Math.round(c.top),Math.round(c.width)]} })()",
    );
    console.log(fail ? "fail" : "ok", "statCheck", JSON.stringify(box));
    await evalJs("document.querySelector('.stat--b').click(); 'ok'");
    await sleep(900);
    await shot(`icon-${fail ? "fail" : "ok"}-logs`);
  }

  ws.close();
  process.exit(0);
})();
