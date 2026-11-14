// 应用内更新：进度条 + 失败回退浏览器（web 环境无法真正装包，最后一步必然回退）
// 前置：node qa/mock_logs.cjs 8807（提供 /qa/update.apk 限速假包）
//       DORM_API=http://127.0.0.1:8807 npx vite --host 127.0.0.1 --port 5292
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9396;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "update");
const APK = "http://127.0.0.1:8807/qa/update.apk";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MANIFEST = {
  version: "9.9.9-qa",
  versionCode: 999,
  url: APK,
  size: "3.2 MB",
  notes: ["应用内直接下载安装", "日志页只有列表滚动，顶部固定"],
};

// web 端 isNativePlatform 为 false，这里只是让它走进「应用内下载」分支
const AS_NATIVE = `window.Capacitor.isNativePlatform = () => true;`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "upd-"));
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
  const apkIds = new Set();
  let apkBytes = 0;
  let apkStatus = null;

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pend.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (/update\/version\.json/.test(request.url)) {
        send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: Buffer.from(JSON.stringify(MANIFEST)).toString("base64"),
        });
      } else {
        send("Fetch.continueRequest", { requestId });
      }
      return;
    }
    if (m.method === "Network.responseReceived" && m.params.response.url.startsWith(APK)) {
      apkIds.add(m.params.requestId);
      apkStatus = m.params.response.status;
    }
    if (m.method === "Network.loadingFinished" && apkIds.has(m.params.requestId)) {
      apkBytes = m.params.encodedDataLength;
    }
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id);
      pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };

  const evalJs = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*version.json*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('dorm.token','qa-token');localStorage.removeItem('dorm.update.snoozed')}catch(e){}`,
  });

  const probe = () =>
    evalJs(`(() => {
      const b=document.querySelector('.sheet__btn--primary');
      const bar=document.querySelector('.update__bar i');
      const tip=document.querySelector('.update__tip');
      return {
        sheet: !!document.querySelector('.sheet'),
        btn: b ? b.textContent.trim() : null,
        disabled: b ? !!b.disabled : null,
        bar: bar ? Math.round(bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width * 100) : null,
        tip: tip ? tip.textContent.trim() : null,
        notes: [...document.querySelectorAll('.update__notes li')].map(e=>e.textContent.trim()),
      };
    })()`);

  const report = {};

  await send("Page.navigate", { url: `${WEB}/?native=1&r=${Date.now()}#home` });
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await evalJs("!!document.querySelector('.update__tip, .update__bar')")) break;
  }
  await sleep(400);
  await shot("01-sheet");
  report.idle = await probe();

  await evalJs(AS_NATIVE + "; 'ok'");
  await evalJs("document.querySelector('.sheet__btn--primary').click(); 'ok'");

  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push({ t: i * 50, ...(await probe()) });
    if (i === 6) await shot("02-progress");
    if (samples[i].btn === "重试" || samples[i].btn === "正在安装…") break;
    await sleep(50);
  }
  report.samples = samples;
  await shot("03-fallback");

  report.apk = { status: apkStatus, bytes: apkBytes };
  report.reached100 = samples.some((s) => s.bar === 100 || /100%/.test(s.btn || ""));
  const last = await probe();
  report.fallback = last.tip;
  report.stayedOpen = last.sheet;

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      { idle: report.idle, apk: report.apk, reached100: report.reached100, fallback: report.fallback, stayedOpen: report.stayedOpen },
      null,
      1
    )
  );
  const steps = [];
  let prev = null;
  for (const s of samples) {
    const k = `${s.btn}|${s.bar}`;
    if (k !== prev) {
      steps.push(`${s.t}ms ${s.btn} bar=${s.bar}`);
      prev = k;
    }
  }
  console.log(steps.join("\n"));

  ws.close();
  child.kill();
  process.exit(0);
})();
