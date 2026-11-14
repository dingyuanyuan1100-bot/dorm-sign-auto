// 断连可自愈验证：登录 -> 断网 -> 点保存 -> 看报错与重试 -> 恢复网络 -> 点重试
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9339;
const BASE = process.argv[2] || "http://127.0.0.1:5277";
const USER = process.argv[3] || "qa_probe_01";
const PASS = process.argv[4] || "dorm2024";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormretry-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const fails = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Network.loadingFailed") fails.push(m.params.errorText);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJS = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
    return r.result.value;
  };
  const setNet = (offline) =>
    send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  const HELPERS = `window.__t={set(el,v){const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));},byText(sel,txt){return [...document.querySelectorAll(sel)].find(e=>e.textContent.trim()===txt);}};'ok'`;
  const grabToast = async (ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = (await evalJS("(document.querySelector('.toast')||{}).innerText||''")).trim();
      if (t) return t;
      await sleep(120);
    }
    return "";
  };

  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(1200);
  await evalJS("localStorage.clear();'ok'");
  await send("Page.navigate", { url: BASE + "/?flat=1&r=login#login" });
  await sleep(1800);
  await evalJS(HELPERS);
  await evalJS(`(()=>{const i=document.querySelectorAll('.login__field input');__t.set(i[0],'${USER}');__t.set(i[2],'${PASS}');})();'ok'`);
  await evalJS("document.querySelector('.login__submit').click();'ok'");
  await sleep(2500);
  console.log("登录:", await evalJS("!!document.querySelector('.hero')"));

  await send("Page.navigate", { url: BASE + "/?flat=1&r=locations#locations" });
  await sleep(2200);
  await evalJS(HELPERS);

  // 断网
  await setNet(true);
  await evalJS("document.querySelector('.head-btn').click();'ok'");
  await sleep(500);
  await evalJS(`(()=>{const f=document.querySelectorAll('.sheet__field input');__t.set(f[0],'离线测试点');__t.set(f[1],'31.71');__t.set(f[2],'118.51');})();'ok'`);
  const t0 = Date.now();
  await evalJS(`__t.byText('.sheet__btn','保存').click();'ok'`);
  const offlineToast = await grabToast(6000);
  console.log(`断网报错(${Date.now() - t0}ms): ${JSON.stringify(offlineToast)}`);
  const hasRetry = await evalJS("!!(document.querySelector('.toast')||{}).querySelector('button')");
  const retryText = await evalJS("((document.querySelector('.toast button')||{}).innerText||'').trim()");
  console.log(`重试按钮: ${hasRetry} ${JSON.stringify(retryText)}`);

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync("qa/netbar.png", Buffer.from(shot.data, "base64"));
  console.log("已截图 qa/netbar.png");

  const barText = await evalJS("((document.querySelector('.netbar')||{}).innerText||'').replace(/\\n/g,' | ')");
  console.log(`常驻提示条: ${JSON.stringify(barText)}`);

  // 恢复网络后点重试
  await setNet(false);
  await sleep(300);
  if (hasRetry) {
    await evalJS("document.querySelector('.toast button').click();'ok'");
    const okToast = await grabToast(6000);
    console.log(`点重试后: ${JSON.stringify(okToast)}`);
  }

  const barGone = await evalJS("!document.querySelector('.netbar')");
  console.log(`恢复后提示条已收起: ${barGone}`);
  console.log("网络失败条数:", fails.length, fails.slice(0, 3));
  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* noop */ }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
