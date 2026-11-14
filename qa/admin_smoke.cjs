// 管理后台真实浏览器验收（headless Chrome / CDP）
//   ADMIN_TOKEN=xxx node qa/admin_smoke.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9890 + Math.floor(Math.random() * 30);
const SITE = process.env.QA_SITE || "https://www.wuxianshitu.icu/admin/";
const TOKEN = process.env.ADMIN_TOKEN || "";
const OUT = path.resolve(__dirname, "admin_smoke.png");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`);
};

(async () => {
  if (!TOKEN) throw new Error("ADMIN_TOKEN 未设置");
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "adm-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
    "--no-proxy-server", "--ignore-certificate-errors", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  const errs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description || "exception");
    if (m.method === "Network.loadingFailed") errs.push(`netfail ${m.params.errorText}`);
    if (m.id && wait.has(m.id)) { const q = wait.get(m.id); wait.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; wait.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result?.value;
  };
  const until = async (expr, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(180); }
    return false;
  };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: SITE });

  rec("页面加载完成", await until(`document.readyState === 'complete' && !!document.getElementById('token')`));
  rec("标题正确", (await ev(`document.title`)) === "意见反馈 · 管理后台");
  rec("初始为口令门禁", await ev(`!document.getElementById('gate').hidden && document.getElementById('main').hidden`));

  // 错误口令要有明确反馈
  await ev(`document.getElementById('token').value='wrong-token'; document.getElementById('enter').click(); true`);
  rec("错误口令有提示", await until(`document.getElementById('gateErr').textContent.length > 0`),
    await ev(`document.getElementById('gateErr').textContent`));

  // 正确口令进入
  await ev(`document.getElementById('token').value=${JSON.stringify(TOKEN)}; document.getElementById('enter').click(); true`);
  rec("正确口令进入后台", await until(`!document.getElementById('main').hidden && document.querySelectorAll('.item').length > 0`));
  const total = Number(await ev(`document.getElementById('sTotal').textContent`));
  const pending = Number(await ev(`document.getElementById('sPending').textContent`));
  rec("统计数字有效", Number.isFinite(total) && total > 0 && Number.isFinite(pending), `total=${total} pending=${pending}`);
  const items = Number(await ev(`document.querySelectorAll('.item').length`));
  rec("反馈列表已渲染", items > 0, `${items} 条`);

  // 打开第一条详情
  await ev(`document.querySelector('.item').click(); true`);
  rec("详情区含内容与回复框", await until(`!!document.querySelector('#detail textarea') && !!document.querySelector('#detail .content')`),
    await ev(`(document.querySelector('#detail .code') || {}).textContent || ''`));

  // 待处理筛选
  await ev(`document.querySelector('.tab[data-filter="pending"]').click(); true`);
  await sleep(900);
  const pills = await ev(`Array.from(document.querySelectorAll('.item .pill')).map(x=>x.textContent)`);
  rec("待处理筛选生效", Array.isArray(pills) && pills.length > 0 && pills.every((x) => x === "待处理"),
    `${pills?.length} 条 / ${[...new Set(pills || [])].join(",")}`);

  rec("无 JS 异常与网络失败", errs.length === 0, errs.slice(0, 3).join(" | "));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
  console.log(`截图：${OUT}`);
  console.log(`验收结果：${pass}/${pass + fail} 通过`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
