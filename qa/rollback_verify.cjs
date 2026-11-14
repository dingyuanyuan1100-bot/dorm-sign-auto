// 回退验收：线上是否已回到 2.0.10，且不再弹更新提示
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9401;
const SITE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "rollback");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rb-"));
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
  const seen = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      errors.push("EXC " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("CONSOLE " + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (/version\.json|notice\.json/.test(r.url)) seen.push(`${r.status} ${r.url}`);
      if (r.status >= 400) bad.push(`${r.status} ${r.url}`);
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
    source: `try{localStorage.removeItem('dorm.token');localStorage.removeItem('dorm.notice.seen');localStorage.removeItem('dorm.update.snoozed');}catch(e){}`,
  });

  await send("Page.navigate", { url: SITE });
  await sleep(6000);

  const first = {
    title: await evalJs("document.title"),
    mounted: await evalJs("!!document.querySelector('#root')?.children.length"),
    bundle: await evalJs(`(performance.getEntriesByType('resource').filter(r=>/index-[A-Za-z0-9_-]+\\.js/.test(r.name))[0]||{}).name || ''`),
  };
  const shot1 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "01-rolled-back.png"), Buffer.from(shot1.data, "base64"));

  // 自动检查在 2.6s / 12s / 40s 触发，等到 20s 覆盖前两次，期间持续观察是否弹面板
  let poppedAt = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    if (await evalJs("!!document.querySelector('.update, .update__bar, .update__notes')")) { poppedAt = (i + 1) * 300 + 6000; break; }
  }
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, "02-no-update.png"), Buffer.from(shot2.data, "base64"));

  const report = {
    first,
    updatePanelAppeared: poppedAt > 0,
    poppedAtMs: poppedAt,
    manifestCalls: seen,
    errors: errors.slice(0, 6),
    bad: bad.slice(0, 6),
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
})().catch((e) => { console.error("VERIFY_FAIL", e); process.exit(1); });
