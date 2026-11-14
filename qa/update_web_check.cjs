// 2.0.13 验收：更新面板点击后是否走浏览器下载（不再应用内下载）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9403;
const SITE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "release13");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = {
  version: "2.0.14",
  versionCode: 999,
  url: "https://175.24.230.58/update/dorm-sign-2.0.13-release.apk",
  size: "3.4 MB",
  force: false,
  publishedAt: "2026-11-06",
  notes: ["冒烟用假清单，不对外发布"],
};

// 记录所有 <a>.click()，用来确认走的是浏览器下载
const STUB = `
window.__clicks = [];
const _click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  window.__clicks.push({ href: this.href, target: this.target });
  return _click.apply(this, arguments);
};
`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "u13-"));
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
  const errors = [];
  const bad = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") errors.push("EXC " + (m.params.exceptionDetails?.exception?.description || ""));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("CONSOLE " + m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
      bad.push(`${m.params.response.status} ${m.params.response.url}`);
    }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (/version\.json/.test(request.url)) {
        send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: Buffer.from(JSON.stringify(FAKE)).toString("base64"),
        });
      } else {
        send("Fetch.continueRequest", { requestId });
      }
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (n) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, `${n}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.removeItem('dorm.token');localStorage.removeItem('dorm.notice.seen');localStorage.removeItem('dorm.update.snoozed');}catch(e){}` + STUB,
  });

  await send("Fetch.enable", { patterns: [{ urlPattern: "*version.json*" }] });
  await send("Page.navigate", { url: SITE });

  let panelAt = -1;
  for (let i = 0; i < 70; i++) {
    await sleep(300);
    if (await evalJs("!!document.querySelector('.update')")) { panelAt = (i + 1) * 300; break; }
  }
  const report = {
    panelAtMs: panelAt,
    versionPair: await evalJs(`(document.querySelector('.update__vers')?.textContent || '').replace(/\\s+/g,' ').trim()`),
    tip: await evalJs(`(document.querySelector('.update__tip')?.textContent || '').trim()`),
    btn: await evalJs(`(document.querySelector('.sheet__btn--primary')?.textContent || '').trim()`),
    hasProgressBar: await evalJs("!!document.querySelector('.update__bar')"),
  };
  await shot("01-sheet");

  await evalJs("document.querySelector('.sheet__btn--primary').click(); 'ok'");
  await sleep(1200);
  report.clicks = await evalJs("window.__clicks || []");
  report.sheetClosed = await evalJs("!document.querySelector('.update')");
  report.errors = errors.slice(0, 6);
  report.bad = bad.slice(0, 6);
  await shot("02-after-click");

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
})().catch((e) => { console.error("CHECK_FAIL", e); process.exit(1); });
