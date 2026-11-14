/* 探针：登录成功后，克隆出来的 #swap-fly svg 上 transition 是否被浏览器接受。
   用法: node qa/fly_probe.cjs [port] */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9810 + Math.floor(Math.random() * 60);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/?native=1`;
const USER = process.env.QA_USER || "qacheck_1793717807";
const PASS = process.env.QA_PASS || "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fly-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
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
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: WEB });
  await sleep(900);
  await evalJs("localStorage.clear()");
  await send("Page.reload");
  await sleep(3000);

  const r = await evalJs(`(function(){
    var out = {};
    var src = document.querySelector(".login__logo svg");
    out.src = src ? JSON.stringify(src.getBoundingClientRect()) : null;
    var dst = document.querySelector('.pane[data-active="true"] .home__avatar svg');
    out.dst = dst ? JSON.stringify(dst.getBoundingClientRect()) : null;
    return out;
  })()`);
  console.log("pre", r);

  await evalJs(`(function(){
    var set = function(el, v){ var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(document.querySelector('#lg-user'), '${USER}');
    set(document.querySelector('#lg-pwd'), '${PASS}');
    window.__clickAt = Math.round(performance.now());
    document.querySelector('.login__submit').click();
    return 1;
  })()`);

  const samples = [];
  for (let i = 0; i < 34; i++) {
    const s = await evalJs(`(function(){
      var g = document.querySelector("#swap-fly svg");
      if (!g) return null;
      var cs = getComputedStyle(g);
      var r = g.getBoundingClientRect();
      return { t: Math.round(performance.now()),
        inline: g.getAttribute("style"),
        prop: cs.transitionProperty, dur: cs.transitionDuration, del: cs.transitionDelay,
        tf: cs.transform,
        r: [Math.round(r.left), Math.round(r.top), Math.round(r.width)] };
    })()`);
    if (s) samples.push(s);
    await sleep(16);
  }
  for (const s of samples.slice(0, 26)) console.log(s.t + " " + s.r.join(",") + "  prop=" + s.prop + " dur=" + s.dur + " del=" + s.del);
  console.log("INLINE:", samples[0] && samples[0].inline);
  console.log("TF:", samples[0] && samples[0].tf);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
