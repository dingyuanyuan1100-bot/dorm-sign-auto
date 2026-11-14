// 端到端冒烟：走 UI 完成 登录 -> 添加位置 -> 新建任务（预期 400）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9335;
const BASE = process.env.QA_BASE || "http://127.0.0.1:5275";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = process.argv[2] || "qa_probe_01";
const PASS = process.argv[3] || "dorm2024";

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dorme2e-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/version`);
      ok = true;
    } catch {
      await sleep(200);
    }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const evalJS = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  const HELPERS = `
    window.__t = {
      set(el, v){
        const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        d.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true}));
      },
      byText(sel, txt){ return [...document.querySelectorAll(sel)].find(e=>e.textContent.trim()===txt); },
      hasText(txt){ return document.body.innerText.includes(txt); },
    }; 'ok'`;

  const log = (name, pass, extra = "") => console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);

  // 轮询等待元素出现（公网延迟不可控）
  const waitFor = async (sel, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const ok = await evalJS(`!!document.querySelector(${JSON.stringify(sel)})`);
      if (ok) return true;
      await sleep(200);
    }
    return false;
  };

  // ---------- 1. 登录 ----------
  await send("Page.navigate", { url: BASE + "/?flat=1&r=login#login" });
  await sleep(1500);
  await evalJS("localStorage.clear();'ok'");
  await send("Page.navigate", { url: BASE + "/?flat=1&e2e=1&r=login#login" });
  await sleep(1800);
  await evalJS(HELPERS);

  const hasLogin = await evalJS("!!document.querySelector('.login__card')");
  log("登录页渲染", hasLogin);

  // 错误密码先验一次
  await evalJS(`(()=>{const i=document.querySelectorAll('.login__field input');
    __t.set(i[0], '${USER}'); __t.set(i[2], 'wrongpass'); })(); 'ok'`);
  await evalJS("document.querySelector('.login__submit').click(); 'ok'");
  await sleep(1600);
  const errToast = await evalJS("(document.querySelector('.toast')||{}).innerText||''");
  log("错误密码被拒绝", /失败|错误/.test(errToast), JSON.stringify(errToast.slice(0, 40)));

  // 正确密码
  await evalJS(`__t.set(document.querySelectorAll('.login__field input')[2], '${PASS}'); 'ok'`);
  await evalJS("document.querySelector('.login__submit').click(); 'ok'");
  const atHome = await waitFor(".hero", 12000);
  await sleep(300);
  log("登录成功进入总览", atHome);

  // ---------- 2. 添加位置 ----------
  await send("Page.navigate", { url: BASE + "/?flat=1&e2e=1&r=locations#locations" });
  const locReady = await waitFor(".head-btn", 12000);
  log("位置页就绪", locReady);
  await evalJS(HELPERS);
  const before = await evalJS("document.querySelectorAll('.loc').length");

  await evalJS("document.querySelector('.head-btn').click(); 'ok'");
  await sleep(600);
  const sheetOpen = await evalJS("!!document.querySelector('.sheet')");
  log("添加位置浮层打开", sheetOpen);

  await evalJS(`(()=>{const f=document.querySelectorAll('.sheet__field input');
    __t.set(f[0], 'E2E 测试点'); __t.set(f[1], '31.7100'); __t.set(f[2], '118.5100');
    __t.set(f[3], '自动化用例'); })(); 'ok'`);
  await evalJS(`__t.byText('.sheet__btn', '保存').click(); 'ok'`);
  await sleep(1800);
  const after = await evalJS("document.querySelectorAll('.loc').length");
  log("位置创建成功", after === before + 1, `${before} -> ${after}`);

  // ---------- 3. 新建任务（无晚寝账号，预期后端 400） ----------
  await send("Page.navigate", { url: BASE + "/?flat=1&e2e=1&r=tasks#tasks" });
  await waitFor(".addrow", 12000);
  await evalJS(HELPERS);
  await evalJS("document.querySelector('.addrow').click(); 'ok'");
  await sleep(600);
  await evalJS(`__t.byText('.sheet__btn', '创建').click(); 'ok'`);
  await sleep(2000);
  const taskToast = await evalJS("(document.querySelector('.toast')||{}).innerText||''");
  const bindHint = /绑定/.test(taskToast);
  log("无晚寝账号时创建被拒绝", bindHint, JSON.stringify(taskToast.slice(0, 40)));

  // ---------- 4. 绑定页可用 ----------
  await send("Page.navigate", { url: BASE + "/?flat=1&e2e=1&r=me#me" });
  await waitFor(".listcard", 12000);
  await evalJS(HELPERS);
  await evalJS(`[...document.querySelectorAll('.listrow__value')][0].click(); 'ok'`);
  await sleep(700);
  const bindSheet = await evalJS("(document.querySelector('.sheet__title')||{}).innerText||''");
  log("绑定晚寝账号浮层", /晚寝账号/.test(bindSheet), JSON.stringify(bindSheet));

  // ---------- 5. 清理测试数据（走接口） ----------
  const leftover = await evalJS(`
    (async () => {
      const t = localStorage.getItem('dorm.token');
      const r = await fetch('/api/locations', { headers: { Authorization: 'Bearer ' + t } });
      const j = await r.json();
      const kill = (j.data || []).filter(l => /E2E/.test(l.name));
      for (const l of kill) {
        await fetch('/api/locations/' + l.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
      }
      return kill.length;
    })()`);
  console.log(`CLEAN  删除测试位置 ${leftover} 个`);

  ws.close();
  chrome.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}
main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
