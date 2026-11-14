/* 2.0.6 三项验收：
   A) 「我的」页显示昵称而非登录账号；关于弹层不再有那段免责长句
   B) 登录失败提示统一为「账号或密码错误」
   C) 网络失败提示统一为「网络问题，请稍后重试」
   用法: node qa/copy_v206.cjs  (需 vite preview 在 5294) */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9397;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5294}`;
const OUT = path.join(__dirname, "fix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const MOCK = `
(() => {
  const real = window.fetch;
  const json = (o, status = 200) => new Response(JSON.stringify(o), {
    status, headers: { "Content-Type": "application/json" },
  });
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const p = url.replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
    if (!p.startsWith("/api/")) return real(input, init);
    const mode = localStorage.getItem("__MODE") || "bound";
    if (mode === "neterr") return Promise.reject(new TypeError("Failed to fetch"));
    if (p === "/api/auth/login") {
      if (mode === "401") return Promise.resolve(json({ success: false, msg: "用户名或密码错误", data: null }, 401));
      if (mode === "409") return Promise.resolve(json({ success: false, msg: "用户名已存在", data: null }, 409));
      if (mode === "500") return Promise.resolve(json({ success: false, msg: "Internal Server Error", data: null }, 500));
    }
    if (p === "/api/auth/me") return Promise.resolve(json({ success: true, data: {
      username: "123456", has_dorm_account: mode === "bound", student_id: mode === "bound" ? "20230101" : null } }));
    if (p === "/api/dorm-account") return mode === "bound"
      ? Promise.resolve(json({ success: true, data: { student_id: "20230101", nickname: "小陈同学", created_at: "2026-11-01 10:00" } }))
      : Promise.resolve(json({ success: false, msg: "尚未绑定晚寝账号", data: null }));
    return Promise.resolve(json({ success: true, data: [] }));
  };
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "v206-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
  };
  const setVal = (sel, val) => evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return "no-" + ${JSON.stringify(sel)};
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    s.call(el, ${JSON.stringify(val)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return el.value;
  })()`);

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });

  /* ---------- A. 已绑定：我的页显示昵称 ---------- */
  await send("Page.navigate", { url: `${WEB}/` });
  await sleep(1400);
  await evalJs(`localStorage.setItem("dorm.token","qa"); localStorage.setItem("__MODE","bound");`);
  await send("Page.reload");
  await sleep(3400);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b=>(b.innerText||"").trim()==="取消")?.click(); return 1; })()`);
  await sleep(600);
  await evalJs(`(() => { const n=[...document.querySelectorAll(".nav__item")].find(x=>x.getAttribute("aria-label")==="我的"); n?.click(); return 1; })()`);
  await sleep(900);
  console.log("ME_HEAD", JSON.stringify(await evalJs(`(() => ({
    name: document.querySelector(".account__name")?.textContent || "",
    nameClass: document.querySelector(".account__name")?.className || "",
    sid: document.querySelector(".account__sid")?.textContent || "",
    badge: document.querySelector(".account__badge")?.textContent || ""
  }))()`)));
  await shot("07-me-nickname-390x844.png");

  // 长昵称溢出保护：省略号 + 不压到右侧徽标
  console.log("LONG_NAME", JSON.stringify(await evalJs(`(() => {
    const el = document.querySelector(".account__name");
    const badge = document.querySelector(".account__badge");
    const before = el.textContent;
    el.textContent = "计算机学院2023级晚寝签到负责人小陈同学";
    const r = el.getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    const out = { truncated: el.scrollWidth > el.clientWidth, nameRight: Math.round(r.right), badgeLeft: Math.round(b.left), overlap: r.right > b.left };
    el.textContent = before;
    return out;
  })()`)));

  // 关于弹层
  await evalJs(`document.querySelector('[data-key="about"] .listrow__value')?.click()`);
  await sleep(800);
  console.log("ABOUT", JSON.stringify(await evalJs(`(() => {
    const s=[...document.querySelectorAll(".sheet")].pop();
    return { hasMsg: !!s?.querySelector(".detail__msg"),
      text: (s?.querySelector(".sheet")?.innerText || s?.innerText || "").replace(/\\s+/g," ").slice(0,160) };
  })()`)));
  await shot("08-about-390x844.png");

  /* ---------- B. 登录 401 → 账号或密码错误 ---------- */
  await send("Page.navigate", { url: `${WEB}/` });
  await sleep(600);
  await evalJs(`localStorage.clear(); localStorage.setItem("__MODE","401");`);
  await send("Page.reload");
  await sleep(2200);
  await setVal("#lg-user", "123456");
  await setVal("#lg-pwd", "wrongpass");
  await evalJs(`document.querySelector(".login__submit")?.click()`);
  await sleep(1600);
  console.log("LOGIN_401", JSON.stringify(await evalJs(`(() => ({
    hint: document.querySelector(".login__hint")?.textContent || "",
    toast: document.querySelector(".toast__text")?.textContent || ""
  }))()`)));
  await shot("09-login-401-390x844.png");

  /* ---------- C. 网络失败 → 网络问题 ---------- */
  await evalJs(`localStorage.setItem("__MODE","neterr")`);
  await setVal("#lg-user", "123456");
  await setVal("#lg-pwd", "wrongpass");
  await evalJs(`document.querySelector(".login__submit")?.click()`);
  await sleep(2200);
  console.log("NET_ERR", JSON.stringify(await evalJs(`(() => ({
    hint: document.querySelector(".login__hint")?.textContent || "",
    toast: document.querySelector(".toast__text")?.textContent || ""
  }))()`)));
  await shot("10-login-neterr-390x844.png");

  /* ---------- D. 服务端 500 → 服务暂时不可用 ---------- */
  await evalJs(`localStorage.setItem("__MODE","500")`);
  await setVal("#lg-user", "123456");
  await setVal("#lg-pwd", "wrongpass");
  await evalJs(`document.querySelector(".login__submit")?.click()`);
  await sleep(1800);
  console.log("SRV_500", JSON.stringify(await evalJs(`document.querySelector(".login__hint")?.textContent || ""`)));

  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
