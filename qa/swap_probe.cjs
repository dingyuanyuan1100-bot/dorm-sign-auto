/* 探针：手动打 data-swap，读 .login 各子元素的计算 opacity 与过渡，确认
   「内容先淡出、底板后褪」这两条规则是否真的命中。 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9820 + Math.floor(Math.random() * 40);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/?native=1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pq-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=390,844", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: WEB });
  await sleep(3200);

  const out = await evalJs(`(function(){
    var st = document.querySelector(".stage");
    var kids = [].slice.call(document.querySelectorAll(".login > *"));
    var before = kids.map(function(n){ return n.className + " op=" + getComputedStyle(n).opacity; });
    st.dataset.swap = "out";
    void st.offsetWidth;
    var after = kids.map(function(n){ return n.className + " op=" + getComputedStyle(n).opacity + " tr=" + getComputedStyle(n).transitionProperty + "/" + getComputedStyle(n).transitionDuration; });
    var layer = document.querySelector(".login-layer");
    var r = { before: before, after: after,
      layerOp: getComputedStyle(layer).opacity, layerTr: getComputedStyle(layer).transition,
      match: (function(){
        var m = document.querySelector(".login__card").matches(".stage[data-swap] .login > :not(.login__blob)");
        return m;
      })() };
    delete st.dataset.swap;
    return JSON.stringify(r, null, 1);
  })()`);
  console.log(out);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
