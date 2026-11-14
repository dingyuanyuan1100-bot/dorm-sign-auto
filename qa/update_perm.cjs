// 应用内更新：权限被系统拦下时的处理（NEED_PERMISSION / 未声明权限）
// 前置：UPDATE_CODE=999 node qa/mock_logs.cjs 8807
//       cd dorm-app && DORM_API=http://127.0.0.1:8807 npx vite --config vite.qa.config.mjs
// 说明：@capacitor/core 被 vite.qa.config.mjs 换成了 qa/mocks/capacitor-core.js
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9397;
const WEB = "http://127.0.0.1:5294";
const OUT = path.join(__dirname, "update-perm");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MANIFEST = {
  version: "9.9.9-qa",
  versionCode: 999,
  url: "http://127.0.0.1:8807/qa/update.apk",
  size: "3.2 MB",
  notes: ["应用内直接下载安装", "允许安装未知应用后自动继续"],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "updperm-"));
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

  const listTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
  const page = (await listTargets())[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });

  let id = 0;
  const pend = new Map();
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
      const qa=window.__qaPlugin||{};
      return {
        sheet: !!document.querySelector('.sheet'),
        btn: b ? b.textContent.trim() : null,
        disabled: b ? !!b.disabled : null,
        bar: bar ? Math.round(bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width * 100) : null,
        tip: tip ? tip.textContent.trim() : null,
        warn: tip ? tip.className.includes('--warn') : null,
        dl: qa.downloadCalls, ins: qa.installCalls,
      };
    })()`);

  const ready = async () => {
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const p = await probe();
      if (p.sheet && p.btn === "立即更新" && p.disabled === false) return p;
      // 公告面板先挡在前面，关掉它才会轮到更新面板
      if (p.sheet && p.btn && p.btn !== "立即更新") {
        await evalJs("document.querySelector('.scrim')?.click(); 'ok'");
      }
    }
    return probe();
  };

  const report = {};

  // A) 系统未放开安装权限：下载 → 跳到开关页 → 提示 → 重试（不重复下载）
  await send("Page.navigate", { url: `${WEB}/?r=${Date.now()}#home` });
  report.idle = await ready();
  await shot("01-sheet");

  await evalJs("document.querySelector('.sheet__btn--primary').click(); 'ok'");

  const samples = [];
  for (let i = 0; i < 60; i++) {
    samples.push({ t: i * 60, ...(await probe()) });
    const s = samples[samples.length - 1];
    if (s.bar !== null && s.bar >= 30 && !s.progressShot) {
      report.progress = s;
      await shot("02-progress");
      samples[samples.length - 1].progressShot = true;
    }
    if (s.btn === "重试" || s.btn === "正在安装…") break;
    await sleep(60);
  }
  report.samples = samples;
  report.perm = await probe();
  await shot("03-perm");
  report.targetsAfterPerm = (await listTargets()).length;

  await evalJs("window.__qaPlugin.allowed = true; 'ok'");
  await evalJs("document.querySelector('.sheet__btn--primary').click(); 'ok'");
  for (let i = 0; i < 40; i++) {
    await sleep(80);
    const p = await probe();
    if (p.btn === "正在安装…" || !p.sheet) {
      report.installing = p;
      break;
    }
  }
  await shot("04-installing");
  await sleep(1800);
  report.afterInstall = await probe();

  // B) 老包没声明权限：不下载，直接给网页
  await send("Page.navigate", { url: `${WEB}/?r=${Date.now()}#home` });
  await ready();
  await evalJs("window.__qaPlugin.declared = false; window.__qaPlugin.downloadCalls = 0; 'ok'");
  await evalJs("document.querySelector('.sheet__btn--primary').click(); 'ok'");
  await sleep(1200);
  report.undeclared = await probe();
  await shot("05-undeclared");
  report.targetsAfterUndeclared = (await listTargets()).length;

  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const brief = {
    idle: report.idle,
    progress: report.progress && { btn: report.progress.btn, bar: report.progress.bar },
    perm: report.perm,
    targetsAfterPerm: report.targetsAfterPerm,
    installing: report.installing,
    afterInstall: report.afterInstall,
    undeclared: report.undeclared,
    targetsAfterUndeclared: report.targetsAfterUndeclared,
  };
  console.log(JSON.stringify(brief, null, 1));

  ws.close();
  child.kill();
  process.exit(0);
})();
