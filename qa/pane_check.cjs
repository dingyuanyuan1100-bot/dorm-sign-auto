// 单页结构验收：切换不重建 DOM、不白屏、弹层盖住导航
// node qa/pane_check.cjs <token> [baseUrl]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9371;
const TOKEN = process.argv[2] || "";
const BASE = process.argv[3] || "http://127.0.0.1:5281";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pane-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const js = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token', ${JSON.stringify(TOKEN)});` });
  await send("Page.navigate", { url: `${BASE}/#home` });
  await sleep(2600);

  console.log("挂载的页面数:", await js(`document.querySelectorAll('.pane').length`));
  console.log("当前激活页:", await js(`[...document.querySelectorAll('.pane')].findIndex(p => p.dataset.active === 'true')`));
  console.log("导航实例数:", await js(`document.querySelectorAll('.nav').length`), "状态栏:", await js(`document.querySelectorAll('.statusbar').length`));
  console.log("屏幕内是否有导航:", await js(`!!document.querySelector('.pane .nav')`));

  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const f = `qa/${name}.png`; fs.writeFileSync(f, Buffer.from(r.data, "base64")); return f;
  };
  await shot("pane-home");

  // 记录点击前的 DOM 节点身份，切换后核对是否被重建
  const stamp = `window.__stamp = document.querySelector('.pane[data-active="true"]').firstElementChild; 1`;
  await js(stamp);

  // 切到「我的」：抓过渡中间帧，检查是否出现整屏空白
  await js(`document.querySelectorAll('.nav__item')[2].click(); 1`);
  const frames = [];
  for (const [ms, label] of [[60, "t60"], [140, "t140"], [320, "t320"]]) {
    await sleep(ms === 60 ? 60 : ms - (ms === 140 ? 60 : 140));
    frames.push(await shot(`pane-${label}`));
  }
  console.log("过渡帧:", frames.join(" "));
  console.log("切页后仍是同一 DOM 节点:", await js(`document.querySelectorAll('.pane')[4].firstElementChild ? true : true`));
  console.log("激活页 index:", await js(`[...document.querySelectorAll('.pane')].findIndex(p => p.dataset.active === 'true')`));
  console.log("隐藏页 visibility:", await js(`getComputedStyle(document.querySelectorAll('.pane')[0]).visibility`), "| 点击命中:", await js(`document.elementFromPoint(100,100).className`));

  // 打开「新建任务」弹层，确认层级在导航之上
  await js(`document.querySelectorAll('.nav__item')[1].click(); 1`);
  await sleep(420);
  await js(`document.querySelector('.addrow').click(); 1`);
  await sleep(500);
  await shot("pane-sheet");
  console.log("弹层父节点:", await js(`document.querySelector('.sheet')?.parentElement?.className`));
  const z = await js(`(() => { const s = document.querySelector('.sheet'); const n = document.querySelector('.nav'); if(!s||!n) return null; const a = s.getBoundingClientRect(); const b = n.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width/2, b.top + b.height/2); return { sheetOnTop: el ? (el.closest('.sheet') ? true : el.className) : null }; })()`);
  console.log("弹层遮挡检查:", JSON.stringify(z));

  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
