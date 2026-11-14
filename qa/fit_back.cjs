// 适配 + 返回键验收：等比缩放（无变形）、页面栈返回、弹层返回、双击退出提示
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9361;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5290}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = process.argv[2] || "";
const OUT = process.argv[3] || path.join(__dirname, "fix");

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fit-"));
  spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      up = true;
    } catch {
      await sleep(200);
    }
  }
  if (!up) throw new Error("chrome 未启动");
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(OUT, { recursive: true });
    const f = path.join(OUT, `${name}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, "base64"));
    return f;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
      try { localStorage.setItem('dorm.token', ${JSON.stringify(TOKEN)}); } catch (e) {}
    `,
  });

  const VIEWS = [
    ["390x844", 390, 844],
    ["412x915", 412, 915],
    ["360x800", 360, 800],
    ["393x873", 393, 873],
  ];

  const report = [];
  for (const [label, w, h] of VIEWS) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send("Page.navigate", { url: `${WEB}/?native=1&r=home#home` });
    await sleep(3600);
    const m = await evalJs(`(() => {
      const stage = document.querySelector('.stage');
      const nav = document.querySelector('.nav');
      const seg = document.querySelector('.seg');
      const hi = document.querySelector('.home-indicator');
      const cs = getComputedStyle(stage);
      const r = stage.getBoundingClientRect();
      const nr = nav?.getBoundingClientRect();
      const sr = seg?.getBoundingClientRect();
      return {
        win: [innerWidth, innerHeight],
        transform: cs.transform,
        stage: [Math.round(r.width), Math.round(r.height)],
        nav: nr ? [nr.width / nr.height, Math.round(innerHeight - nr.bottom)] : null,
        seg: sr ? [sr.width, sr.height, sr.width / sr.height] : null,
        homeIndicatorBottom: hi ? Math.round(innerHeight - hi.getBoundingClientRect().bottom) : null,
      };
    })()`);
    report.push({ label, ...m });
    await shot(`home-${label}`);

    // 位置库：确认顶部 + 已删、位置库页可下滑
    await send("Page.navigate", { url: `${WEB}/?native=1&r=locations#locations` });
    await sleep(1800);
    const headBtn = await evalJs("document.querySelectorAll('.head-btn').length");
    const addBtn = await evalJs("!!document.querySelector('.addrow')");
    report.push({ label, locationsHeadBtn: headBtn, locationsAddRow: addBtn });
    await shot(`locations-${label}`);
  }

  /* ---------------- 返回键链路 ---------------- */
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `${WEB}/?native=1&r=home#home` });
  await sleep(3600);

  const clickNav = (label) =>
    evalJs(`(() => {
      const b=[...document.querySelectorAll('.nav__item')].find(x=>x.getAttribute('aria-label')==='${label}');
      b?.click(); return !!b;
    })()`);

  const back = () => evalJs("window.__dormBack && (window.__dormBack(), true)");
  const state = () =>
    evalJs(`(() => ({
      hash: location.hash,
      active: document.querySelector('.pane[data-active="true"]')?.className,
      paneIdx: [...document.querySelectorAll('.pane')].findIndex(p=>p.dataset.active==='true'),
      sheet: !!document.querySelector('.sheet'),
      toast: document.querySelector('.toast__text')?.textContent || '',
    }))()`);

  const steps = [];
  const snap = async (tag) => {
    const s = await state();
    steps.push({ tag, ...s });
    return s;
  };

  await clickNav("任务");
  await sleep(700);
  await snap("nav->任务");

  await clickNav("我的");
  await sleep(700);
  await snap("nav->我的");

  await back();
  await sleep(600);
  await snap("back#1 (我的→任务)");

  await back();
  await sleep(600);
  await snap("back#2 (任务→首页)");

  await back();
  await sleep(300);
  await snap("back#3 (首页→提示双击)");

  await back();
  await sleep(300);
  await snap("back#4 (2s 内再按→退出)");

  // 弹层：新建签到任务
  await clickNav("任务");
  await sleep(600);
  await evalJs("document.querySelector('.addrow')?.click()");
  await sleep(600);
  const sheetOpen = await snap("open sheet 新建签到任务");
  await shot("sheet-tasks-412x915");
  await back();
  await sleep(500);
  await snap("back (弹层→关闭)");

  console.log(JSON.stringify({ report, steps }, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
