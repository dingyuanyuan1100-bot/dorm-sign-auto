/* 诊断启动路径 waitOpaque 为什么等满 900ms：列出头像 svg 的祖先 opacity 链 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = "qacheck_1793717807", PASS = "Qa123456";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bo-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=390,844", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: WEB });
  await sleep(2000);
  const token = await ev(`(async () => { const r = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({username:"${USER}",password:"${PASS}"})}); return (await r.json())?.data?.token || ""; })()`);
  await ev(`localStorage.setItem("dorm.token", ${JSON.stringify(token)}); localStorage.removeItem("dorm.update.snoozed");`);
  await sleep(200);
  await send("Page.navigate", { url: WEB + "?native=1" });

  const CHAIN = `(function(){
    var n = document.querySelector('.pane[data-active="true"] .home__avatar svg');
    var out = [];
    for (var p = n ? n.parentElement : null; p && p.nodeType === 1; p = p.parentElement) {
      var cs = getComputedStyle(p);
      out.push((p.className || p.tagName) + '=' + cs.opacity + '/' + cs.visibility +
        (p.dataset && p.dataset.active !== undefined ? '(active=' + p.dataset.active + ')' : ''));
    }
    return JSON.stringify({ t: Math.round(performance.now()), handoff: document.documentElement.dataset.handoff || '',
      splash: !!document.getElementById('boot-splash'), tLand: window.__tLand || 0, chain: out });
  })()`;

  for (let i = 0; i < 16; i++) {
    await sleep(180);
    const r = JSON.parse(await ev(CHAIN));
    console.log(r.t, "handoff=" + r.handoff, "splash=" + r.splash, "land=" + r.tLand, r.chain.join(" > "));
  }
  process.exit(0);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
