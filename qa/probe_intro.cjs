// 探针：入场动画到底作用在哪些元素上
//   node qa/probe_intro.cjs [端口]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9740 + Math.floor(Math.random() * 30);
const WEB = Number(process.env.QA_PORT || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--no-proxy-server", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { const q = wait.get(m.id); wait.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EX " + (r.exceptionDetails.exception?.description || "").slice(0, 200);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  /* ---------- 登录页小狗 ---------- */
  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(120);
  for (let i = 0; i < 40; i++) {
    const st = await ev(`(() => {
      const s = document.querySelector('.stage');
      const d = document.querySelector('.login__dog');
      if (!d) return null;
      const cs = getComputedStyle(d);
      return { intro: s && s.dataset.intro, op: Number(cs.opacity), anim: cs.animationName, t: Math.round(performance.now()) };
    })()`);
    if (st) console.log("login t=" + st.t, "intro=" + st.intro, "dogOpacity=" + st.op, "anim=" + st.anim);
    await sleep(120);
    if (st && st.intro === undefined) break;
  }
  await sleep(1500);
  console.log("登录稳定后:", JSON.stringify(await ev(`(() => {
    const d = document.querySelector('.login__dog');
    const cs = d && getComputedStyle(d);
    return { exists: !!d, op: cs && Number(cs.opacity), anim: cs && cs.animationName, cardAnim: getComputedStyle(document.querySelector('.login__card')).animationName };
  })()`)));

  /* ---------- 首页日历 ---------- */
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=home#home` });
  for (let i = 0; i < 25; i++) {
    const ok = await ev(`!!document.querySelector('.signcal') || !!document.querySelector('.empty')`);
    if (ok) break;
    await sleep(150);
  }
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push(await ev(`(() => {
      const pick = (s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); const p = e.closest('.pane'); return { op: Number(cs.opacity), anim: cs.animationName, delay: cs.animationDelay, enter: p && p.getAttribute('data-enter') }; };
      return { cal: pick('.signcal'), hero: pick('.hero'), stat: pick('.stat--a'), head: pick('.section-head') };
    })()`));
    await sleep(90);
  }
  for (const [i, s] of samples.entries()) console.log("home#" + i, JSON.stringify(s));

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
})();
