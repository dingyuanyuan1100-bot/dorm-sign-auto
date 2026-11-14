/* 手动检查更新验收：登录 → 我的 → 关于 → 检查更新
   用法: node qa/update_manual.cjs [端口] */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9387;
const WEB = `http://127.0.0.1:${process.argv[2] || 5297}/`;
const OUT = path.join(__dirname, "update");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = "qacheck_1793717807", PASS = "Qa123456";

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "upm-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description || "").slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
  };
  const lastSheet = async () => JSON.parse(await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({
      open: !!s,
      title: s?.querySelector(".sheet__title")?.innerText || "",
      rows: [...(s?.querySelectorAll(".detail__row") || [])].map(r => r.innerText.replace(/\\s+/g, " ")),
      vers: [...(s?.querySelectorAll(".update__v") || [])].map(v => v.innerText),
      btns: [...(s?.querySelectorAll(".sheet__btn") || [])].map(b => b.innerText.trim()),
      toast: document.querySelector(".toast__text")?.innerText || "",
    });
  })()`));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  // 直接注入 token（等价于已登录），避免在登录表单上耗时间
  const token = await evalJs(`(async () => {
    const r = await fetch("https://175.24.230.58/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "${USER}", password: "${PASS}" }),
    });
    const j = await r.json();
    return j?.data?.token || "";
  })()`);
  if (!token) { console.log("LOGIN_FAILED"); process.exit(1); }
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem("dorm.token","${token}")}catch(e){}`,
  });
  await send("Page.navigate", { url: WEB });
  await sleep(4200);

  // 先收掉启动自动弹的更新层（顺便写入 12h 节流），后面专门验证「手动检查」
  const autoFirst = await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    if (!s) return "none";
    const t = s.querySelector(".sheet__title")?.innerText || "";
    [...s.querySelectorAll(".sheet__btn")].find(b => (b.innerText || "").trim() === "稍后再说")?.click();
    return t;
  })()`);
  console.log("AUTO_SHEET", autoFirst);
  await sleep(700);

  // 关掉登录后自动弹的「绑定晚寝账号」
  await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => (x.innerText || "").trim() === "取消");
    b?.click(); return 1;
  })()`);
  await sleep(700);

  // 我的 → 关于
  const navHit = await evalJs(`(() => {
    const n = [...document.querySelectorAll(".nav__item")].find(x => x.getAttribute("aria-label") === "我的");
    n?.click();
    return (document.querySelector(".page-title")?.innerText || "") + "|" + (n ? 1 : 0);
  })()`);
  console.log("NAV", navHit);
  await sleep(900);
  const rowHit = await evalJs(`(() => {
    const b = document.querySelector('[data-key="about"] .listrow__value');
    if (!b) return 0; b.click(); return 1;
  })()`);
  console.log("ROW_ABOUT", rowHit);
  await sleep(1000);
  const about = await lastSheet();
  console.log("ABOUT", JSON.stringify(about));
  await shot("02-about-390x844.png");

  // 检查更新
  await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    const b = [...(s?.querySelectorAll(".sheet__btn") || [])].find(x => (x.innerText || "").trim().startsWith("检查更新"));
    b?.click(); return b ? 1 : 0;
  })()`);
  await sleep(2600);
  const after = await lastSheet();
  console.log("AFTER_CHECK", JSON.stringify(after));
  await shot("03-manual-update-390x844.png");
  console.log("SNOOZE", await evalJs(`localStorage.getItem("dorm.update.snoozed")`));
  console.log("ERRORS", errs.length ? errs.slice(0, 4).join(" / ") : "none");
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
