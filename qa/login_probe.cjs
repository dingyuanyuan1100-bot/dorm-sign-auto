/* 登录路径诊断：提交后按真实时间轮询 1.6s，抓底板矩形 / 入场 / 落位 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/?native=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = "qacheck_1793717807", PASS = "Qa123456";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lp-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=390,844", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") console.log("[exception]", (m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  };
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: WEB });
  await sleep(900);
  await ev(`localStorage.clear()`);
  await send("Page.reload");
  await sleep(3200);

  await ev(`(function(){
    var set = function(el, v){ var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('#lg-user'), '${USER}'); set(document.querySelector('#lg-pwd'), '${PASS}');
    window.__t0 = Math.round(performance.now());
    document.querySelector('.login__submit').click();
  })()`);

  const SNAP = `(function(){
    var st = document.querySelector('.stage'), l = document.querySelector('.login-layer');
    var hi = document.querySelector('.pane[data-active="true"] .home__hi');
    var b = l ? l.getBoundingClientRect() : null;
    return JSON.stringify({ t: Math.round(performance.now()) - (window.__t0||0),
      swap: st ? st.dataset.swap||'' : '', intro: st ? st.dataset.intro||'' : '',
      w: b ? Math.round(b.width) : null, h: b ? Math.round(b.height) : null,
      x: b ? Math.round(b.left) : null, op: l ? +getComputedStyle(l).opacity : null,
      hi: hi ? +getComputedStyle(hi).opacity : null,
      land: window.__tLand ? window.__tLand - (window.__t0||0) : null,
      run: window.__tRun ? window.__tRun - (window.__t0||0) : null });
  })()`;

  const rows = [];
  for (let i = 0; i < 34; i++) {
    rows.push(JSON.parse(await ev(SNAP)));
    await sleep(50);
  }
  rows.forEach((r) => console.log(
    `${String(r.t).padStart(5)} swap=${(r.swap || "-").padEnd(7)} intro=${(r.intro || "-").padEnd(8)} W=${String(r.w).padStart(3)}@${String(r.x).padStart(3)} op=${r.op} hi=${r.hi} run=${r.run} land=${r.land}`));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
