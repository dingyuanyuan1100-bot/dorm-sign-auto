// 正式版冒烟：直接跑线上那份 bundle，检查启动无报错、资源无 404，并验证更新面板能弹出
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9399;
const SITE = "https://175.24.230.58/";
const OUT = path.join(__dirname, "release");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = {
  version: "2.0.12",
  versionCode: 999,
  url: "https://175.24.230.58/update/dorm-sign-2.0.11-release.apk",
  size: "3.4 MB",
  force: false,
  publishedAt: "2026-11-06",
  notes: ["冒烟测试用的假清单，不对外发布"],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
  const child = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--ignore-certificate-errors",
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
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
  const errors = [];
  const bad = [];
  const hits = [];
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
      if (r.status >= 400) bad.push(`${r.status} ${r.url}`);
    }
    if (m.method === "Network.loadingFailed" && !m.params.errorText?.includes("ERR_ABORTED")) {
      bad.push(`FAIL ${m.params.errorText} ${m.params.requestId}`);
    }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (/version\.json/.test(request.url)) {
        hits.push(request.url);
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
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.removeItem('dorm.token');localStorage.removeItem('dorm.notice.seen');localStorage.removeItem('dorm.update.snoozed');}catch(e){}`,
  });

  const report = {};

  // 一、干净加载线上 bundle
  await send("Page.navigate", { url: SITE });
  await sleep(7000);
  report.first = {
    url: await evalJs("location.href"),
    title: await evalJs("document.title"),
    rootChildren: await evalJs("document.querySelector('#root')?.children.length ?? -1"),
    mounted: await evalJs("!!document.querySelector('.login__card, .home__wrap, .hero, nav')"),
    bundle: await evalJs(`(performance.getEntriesByType('resource').filter(r=>/index-[A-Za-z0-9_-]+\\.js/.test(r.name))[0]||{}).name || ''`),
    errors: errors.slice(0, 8),
    bad: bad.slice(0, 8),
  };
  await shot("01-live-login");

  // 二、注入更高 versionCode 的清单，看更新面板是否出现
  errors.length = 0;
  bad.length = 0;
  await send("Fetch.enable", { patterns: [{ urlPattern: "*update/version.json*" }] });
  await send("Page.reload", { ignoreCache: true });

  // 自动检查在 2.6s / 12s / 40s 三个时点触发，轮询等面板出现，别写死等待
  let panelAt = -1;
  for (let i = 0; i < 70; i++) {
    await sleep(300);
    if (await evalJs("!!document.querySelector('.update, .update__bar, .update__notes')")) {
      panelAt = (i + 1) * 300;
      break;
    }
  }
  await sleep(400);
  report.update = {
    panelAtMs: panelAt,
    intercepted: hits.length,
    sheetTitle: await evalJs(`(document.querySelector('.sheet__title, .update')?.closest('[class*=sheet]')?.querySelector('h2,h3,.sheet__title')?.textContent || '').trim()`),
    hasUpdate: await evalJs("!!document.querySelector('.update, .update__bar, .update__notes')"),
    versionText: await evalJs(`(document.querySelector('.update__vers')?.textContent || '').replace(/\\s+/g,' ').trim()`),
    notes: await evalJs(`[...document.querySelectorAll('.update__notes li')].map(x=>x.textContent.trim())`),
    button: await evalJs(`(document.querySelector('.update button, [class*=sheet] button')?.textContent || '').trim()`),
    errors: errors.slice(0, 8),
    bad: bad.slice(0, 8),
  };
  await shot("02-update-prompt");

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  child.kill();
})().catch((e) => {
  console.error("SMOKE_FAIL", e);
  process.exit(1);
});
