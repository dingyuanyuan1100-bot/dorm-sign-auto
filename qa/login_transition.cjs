/* 登录转场入场验收：登录成功（anon → ready）后，首页组件是否也补了一次
   顺序入场，并且最终全部回到 opacity 1、data-intro 被摘掉。
   用法: node qa/login_transition.cjs [port]
*/
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLER = `
window.__lt = [];
(function () {
  var LIST = { hi: ".home__hi", hero: ".hero", statA: ".stat--a", statB: ".stat--b", head: ".section-head", nav: ".nav" };
  var t = setInterval(function () {
    var st = document.querySelector(".stage");
    var e = {};
    for (var k in LIST) {
      var n = document.querySelector(LIST[k]);
      if (n) e[k] = +getComputedStyle(n).opacity;
    }
    window.__lt.push({ t: Math.round(performance.now()), intro: st ? (st.dataset.intro || "") : "none", e: e });
    if (window.__lt.length > 500) clearInterval(t);
  }, 16);
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lt-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--window-size=390,844", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(150); }
  }
  if (!up) { console.log("CHROME_FAILED"); process.exit(2); }

  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (n) => fs.writeFileSync(path.join(__dirname, "live", "intro", n), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SAMPLER });
  await send("Page.navigate", { url: WEB });
  await sleep(900);
  await evalJs(`localStorage.clear()`);
  await send("Page.reload");
  await sleep(2600);

  const fired = await evalJs(`(function(){
    var set = function(el, v){ var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    var u = document.querySelector('#lg-user'), p = document.querySelector('#lg-pwd');
    if (!u || !p) return 'NO_INPUT';
    set(u, '${process.env.QA_USER || "qacheck_1793717807"}');
    set(p, '${process.env.QA_PASS || "Qa123456"}');
    var b = document.querySelector('.login__submit');
    if (!b) return 'NO_BTN';
    b.click();
    return 'CLICKED';
  })()`);
  console.log("trigger:", fired);
  await sleep(300); await shot("login-t1.png");
  await sleep(400); await shot("login-t2.png");
  await sleep(500); await shot("login-t3.png");
  await sleep(1500);

  const s = JSON.parse((await evalJs("JSON.stringify(window.__lt || [])")) || "[]");
  // 只看「登录之后」那一轮：启动闪屏那轮在 2.4s 前已经结束
  let startIdx = -1;
  // 取**第一个** pending 帧：取最后一个的话 pendingMs 会贴着 runMs，看不出真实等待
  s.forEach((x, i) => { if (x.intro === "pending" && x.t > 2400 && startIdx < 0) startIdx = i; });
  const runIdx = s.findIndex((x, i) => i > startIdx && x.intro === "run");
  const cleared = s.findIndex((x, i) => i > runIdx && runIdx >= 0 && x.intro === "");
  const after = s.slice(startIdx >= 0 ? startIdx : 0);
  const keys = Object.keys(s[s.length - 1].e);
  const order = keys.map((k) => {
    const hit = after.find((x) => x.e[k] > 0.05);
    return { key: k, at: hit ? hit.t : null, end: s[s.length - 1].e[k] };
  }).filter((x) => x.at != null).sort((a, b) => a.at - b.at);

  console.log(JSON.stringify({
    introPending: startIdx >= 0,
    introRun: runIdx >= 0,
    pendingMs: startIdx >= 0 ? s[startIdx].t : null,
    runMs: runIdx >= 0 ? s[runIdx].t : null,
    clearedMs: cleared > 0 ? s[cleared].t : null,
    order: order.map((x) => `${x.key}@${x.at}`),
    monotonic: order.every((x, i) => i === 0 || x.at >= order[i - 1].at),
    allOpaqueAtEnd: order.every((x) => x.end >= 0.99),
    // 排障用：pending 前后 12 条原始记录
    trace: s.slice(Math.max(0, startIdx - 2), startIdx + 12).map(
      (x) => `${x.t}:${x.intro || "-"}:${Object.values(x.e).map((v) => +v.toFixed(2)).join(",")}`,
    ),
    introValues: [...new Set(s.map((x) => x.intro))],
    samples: s.length,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
