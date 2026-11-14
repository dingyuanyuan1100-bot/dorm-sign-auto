// 清理后运行时验收：真实站点加载，统计 4xx/5xx、JS 异常，确认页面正常渲染
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9411;
const SITE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "postfix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
  const child = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--ignore-certificate-errors",
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 90; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0;
  const pend = new Map();
  const bad = [];
  const errors = [];
  const assets = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push("EXC " + (m.params.exceptionDetails?.exception?.description || "").slice(0, 160));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("CONSOLE " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160));
    }
    if (m.method === "Network.responseReceived") {
      const { url, status } = m.params.response;
      if (/\/assets\/|\/fonts\//.test(url)) assets.push(`${status} ${url.replace(SITE, "/")}`);
      if (status >= 400) bad.push(`${status} ${url.replace(SITE, "/")}`);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.clear();}catch(e){}`,
  });

  const t0 = Date.now();
  await send("Page.navigate", { url: SITE });

  let mountedAt = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const ok = await evalJs("document.querySelector('#root, #app') && (document.querySelector('#root, #app').children.length > 0)");
    if (ok) { mountedAt = Date.now() - t0; break; }
  }

  // 主动验证被动态 import 的 web chunk 在浏览器里可用（不是只靠 curl）
  const dyn = await evalJs(`fetch('/assets/web-C2L7ddMz.js').then(r=>r.status)`);
  const fontOk = await evalJs(`document.fonts.check('16px "Poppins"')`);

  const body = await evalJs("(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,200)");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "home.png"), Buffer.from(shot.data, "base64"));

  console.log(JSON.stringify({
    mountedAtMs: mountedAt,
    dynChunkStatus: dyn,
    poppinsLoaded: fontOk,
    assetRequests: assets.length,
    assetFailures: bad.filter((b) => /assets|fonts/.test(b)),
    allFailures: bad,
    jsErrors: errors,
    bodyHead: body,
  }, null, 2));

  ws.close();
  child.kill();
  process.exit(0);
})();
