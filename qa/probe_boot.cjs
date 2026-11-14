// 探针：真实登录后轮询 boot 状态，抓 console/network 线索
//   node qa/probe_boot.cjs [端口]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9510 + Math.floor(Math.random() * 40);
const WEB = Number(process.argv[2] || 5297);
const BASE = `http://127.0.0.1:${WEB}`;
const USER = process.env.QA_USER || "qacheck_1793717807";
const PASS = process.env.QA_PASS || "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "pb-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { const q = wait.get(m.id); wait.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === "Runtime.consoleAPICalled") logs.push("console:" + (m.params.args || []).map((a) => a.value || a.description || "").join(" ").slice(0, 200));
    if (m.method === "Runtime.exceptionThrown") logs.push("EX:" + (m.params.exceptionDetails?.exception?.description || "").slice(0, 200));
    if (m.method === "Log.entryAdded") logs.push("log:" + m.params.entry.level + " " + (m.params.entry.text || "").slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "EX " + (r.exceptionDetails.exception?.description || "").slice(0, 300);
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1500);
  const tok = await ev(`(async () => {
    const r = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
    const j = await r.json();
    return (j && j.data && j.data.token) || "";
  })()`);
  console.log("token:", tok ? tok.slice(0, 24) + "..." : "(空)");

  // 直接用真 token 打一次 /api/auth/me，看接口本身是否认
  console.log("me via proxy:", JSON.stringify(await ev(`(async () => {
    const r = await fetch("/api/auth/me", { headers: { Authorization: "Bearer ${tok}" } });
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  })()`)));

  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok)}); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=me#me` });

  for (let i = 0; i < 14; i++) {
    await sleep(1000);
    const st = await ev(`(() => ({
      show: document.querySelector('.app')?.getAttribute('data-show'),
      token: (localStorage.getItem('dorm.token')||'').slice(0,12),
      loginShow: document.querySelector('.login-layer')?.getAttribute('data-show'),
      rows: document.querySelectorAll('.listrow').length,
    }))()`);
    console.log(`t+${i + 1}s`, JSON.stringify(st));
    if (st && st.show === "true") break;
  }
  console.log("--- logs ---");
  console.log(logs.slice(-15).join("\n"));

  ws.close();
  chrome.kill();
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
