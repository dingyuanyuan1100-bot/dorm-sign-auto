/* 一次性探针：确认闪屏文字与登录页标题的实际字体/字距差异 */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9900 + Math.floor(Math.random() * 80);
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5296}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pf-"));
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
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const evalJs = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: WEB });
  await sleep(900);

  const out = await evalJs(`(async () => {
    await document.fonts.ready;
    const mk = (fam, ls, tag) => {
      const d = document.createElement(tag || "div");
      d.style.cssText = "position:fixed;left:-9999px;top:0;font-weight:700;font-size:30px;white-space:nowrap;letter-spacing:" + ls;
      d.style.fontFamily = fam;
      d.textContent = "晚寝签到";
      document.body.appendChild(d);
      const b = d.getBoundingClientRect();
      d.remove();
      return [+b.width.toFixed(2), +b.height.toFixed(2)];
    };
    const t = document.querySelector(".login__title");
    const sp = t ? t.querySelector("span") : null;
    const w = document.querySelector("#boot-splash .bs-word");
    let ww = null, wcs = null;
    if (w) {
      wcs = (() => { const c = getComputedStyle(w); return { f: c.fontFamily, ls: c.letterSpacing, fs: c.fontSize, fw: c.fontWeight, lh: c.lineHeight, w: +w.getBoundingClientRect().width.toFixed(2) }; })();
      w.style.letterSpacing = "0px";
      ww = +w.getBoundingClientRect().width.toFixed(2);
      w.style.letterSpacing = "";
    }
    const cs = (n) => { const c = getComputedStyle(n); return { f: c.fontFamily, ls: c.letterSpacing, fs: c.fontSize, fw: c.fontWeight, lh: c.lineHeight, w: +n.getBoundingClientRect().width.toFixed(2) }; };
    return JSON.stringify({
      div_ali: mk("'Alimama ShuHeiTi'", "0px", "div"),
      span_ali: mk("'Alimama ShuHeiTi'", "0px", "span"),
      div_alifirst: mk("Alimama ShuHeiTi, serif", "0px", "div"),
      div_noto: mk("'Noto Sans SC'", "0px", "div"),
      title: cs(t),
      span: sp ? cs(sp) : "NO_SPAN",
      word: wcs,
      wordNoLs: ww,
      check1: document.fonts.check("700 30px 'Alimama ShuHeiTi'"),
      faces: [...document.fonts].map((f) => f.family + "/" + f.weight + "/" + f.status),
    }, null, 2);
  })()`);
  console.log(out);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
