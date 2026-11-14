// 端到端验证「写入回包丢失」时的行为：node qa/write_e2e.cjs [base] [mock]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9361;
const BASE = process.argv[2] || "http://127.0.0.1:5277";
const MOCK = process.argv[3] || "http://127.0.0.1:8806";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "we2e-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const net = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Network.requestWillBeSent") { const r = m.params.request; if (/MOCK|88(06|07)/.test(r.url)) net.push(`${r.method} ${r.url.replace(/^http:\/\/[^/]+/, "")}`); }
    if (m.method === "Network.loadingFailed") net.push(`✗ ${m.params.type} ${m.params.errorText}`);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token','mock-token');` });
  await send("Page.navigate", { url: `${BASE}/?r=tasks#tasks` });
  await sleep(1800);

  const state = async (tag) => {
    const s = await evalJs(`(() => {
      const t = document.querySelector('.toast');
      return JSON.stringify({
        cards: document.querySelectorAll('.taskcard').length,
        toast: t ? t.innerText.replace(/\\n/g,' | ') : null,
        netbar: document.querySelector('.netbar') ? document.querySelector('.netbar').innerText.replace(/\\n/g,' ') : null,
        sheet: !!document.querySelector('.sheet'),
      });
    })()`);
    const m = await (await fetch(MOCK + "/api/__stats")).json();
    console.log(`${tag} | ui=${s} | server=${JSON.stringify({ n: m.data.n, stats: m.data.stats })}`);
    return { ui: JSON.parse(s), server: m.data };
  };

  await state("初始");

  // 1) 新建：代理会把 POST 的回包掐掉（服务端其实已经写入）
  await evalJs(`document.querySelector('.addrow').click(); 1`);
  await sleep(500);
  await evalJs(`document.querySelector('.sheet__btn--primary').click(); 1`);
  await sleep(200);
  console.log("创建后 200ms 提示条:", await evalJs(`document.querySelector(".netbar") ? document.querySelector(".netbar").innerText.replace(/\\n/g," ") : null`));
  await sleep(700);
  console.log("创建后 900ms 吐司:", await evalJs(`document.querySelector('.toast') ? document.querySelector('.toast').innerText.replace(/\\n/g," ") : null`));
  await sleep(2200);
  const afterCreate = await state("点创建后");

  // 2) 暂停（PUT 回包同样被掐）
  await evalJs(`document.querySelector('.taskcard__switch').click(); 1`);
  await sleep(900);
  console.log("暂停后 900ms 吐司:", await evalJs(`document.querySelector('.toast') ? document.querySelector('.toast').innerText.replace(/\\n/g," ") : null`));
  await sleep(1800);
  await state("点暂停后");

  // 3) 删除（长按 600ms 触发确认，再点删除）
  await evalJs(`(() => { const c = document.querySelector('.taskcard'); if (!c) return 0;
    c.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
    setTimeout(() => c.dispatchEvent(new PointerEvent('pointerup', {bubbles:true})), 620); return 1; })()`);
  await sleep(1100);
  const sheetTxt = await evalJs(`document.querySelector('.sheet') ? document.querySelector('.sheet').innerText.split('\\n')[0] : null`);
  console.log("长按确认弹层:", sheetTxt);
  await evalJs(`(() => { const b = document.querySelector('.sheet__btn--danger'); if (b) { b.click(); return 1; } return 0; })()`);
  await sleep(900);
  console.log("删除后 900ms 吐司:", await evalJs(`document.querySelector('.toast') ? document.querySelector('.toast').innerText.replace(/\\n/g," ") : null`));
  await sleep(1600);
  const afterDelete = await state("点删除后");

  console.log("--- 请求序列 ---\n" + net.join("\n"));
  console.log("=== 判定 ===");
  console.log("创建后服务端任务数 =", afterCreate.server.n, "（应为 1，多了就是重复创建）");
  console.log("删除后服务端任务数 =", afterDelete.server.n, "（应为 0）");
  console.log("UI 卡片数 =", afterDelete.ui.cards);
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
