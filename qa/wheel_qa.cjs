// 验收：新建签到任务的时间滚轮被限制在 21:35–23:25
//   QA_PORT=5299 node qa/wheel_qa.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9790 + Math.floor(Math.random() * 30);
const WEB = Number(process.env.QA_PORT || 5299);
const BASE = `http://127.0.0.1:${WEB}`;
const USER = "qacheck_1793717807";
const PASS = "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let pass = 0;
let fail = 0;
const rec = (name, ok, detail = "") => {
  if (ok) pass++; else fail++;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `   [${detail}]` : ""}`);
};

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "whq-"));
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
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__jsErr=0;window.addEventListener('error',()=>window.__jsErr++);" });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1400);
  const tok = await ev(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
      const j = await r.json();
      return (j && j.data && j.data.token) || "";
    } catch (e) { return ""; }
  })()`);
  await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok || "")}); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=tasks#tasks` });
  for (let i = 0; i < 20; i++) {
    if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(600);
  }
  await sleep(1500);
  for (let i = 0; i < 3; i++) {
    const c = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!c) break;
    await sleep(400);
  }
  await ev(`document.querySelector('.addrow').click(); 'ok'`);
  await sleep(900);

  const base = await ev(`(() => {
    const cs = [...document.querySelectorAll('.tw__col')];
    const vals = (c) => [...c.querySelectorAll('.tw__item')].map((e) => e.textContent.trim());
    return {
      on: cs.map((c) => c.querySelector('.tw__item[data-on="true"]')?.textContent.trim()),
      hours: vals(cs[0]), mins: vals(cs[1]),
      top: cs.map((c) => Math.round(c.scrollTop)),
      max: cs.map((c) => c.scrollHeight - c.clientHeight),
    };
  })()`);
  rec("小时列只剩窗口内的 21/22/23", base.hours.join(",") === "21,22,23", `小时=${base.hours.join(",")}`);
  rec("默认时间是窗口上界 23:25", base.on.join(":") === "23:25", `选中=${base.on.join(":")}`);
  rec("23 点只能选 00~25 分", base.mins.length === 26 && base.mins[0] === "00" && base.mins[25] === "25",
    `${base.mins.length} 格：${base.mins[0]}…${base.mins[25]}`);
  rec("小时列可滚范围正好 3 格", base.max[0] === 88, `scrollTop=${base.top[0]} max=${base.max[0]}`);

  // 滚到最早 = 21 点，分钟自动夹到 35 起
  const at21 = await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[0];
    c.scrollTop = 0;
    await new Promise(r => setTimeout(r, 560));
    const cs = [...document.querySelectorAll('.tw__col')];
    const mins = [...cs[1].querySelectorAll('.tw__item')].map(e => e.textContent.trim());
    return { on: cs.map(x => x.querySelector('.tw__item[data-on="true"]')?.textContent.trim()),
      minsLen: mins.length, first: mins[0], last: mins[mins.length - 1] };
  })()`);
  rec("拖到最早停在 21 点", at21.on[0] === "21", `小时=${at21.on[0]}`);
  rec("21 点的分钟从 35 起（min 边界）", at21.minsLen === 25 && at21.first === "35" && at21.last === "59",
    `${at21.minsLen} 格：${at21.first}…${at21.last}`);
  rec("21 点分钟被夹进 35 之后", Number(at21.on[1]) >= 35, `当前 ${at21.on.join(":")}`);

  // 滚到最晚 = 23 点，分钟夹到 25
  const at23 = await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[0];
    c.scrollTop = 99999;
    await new Promise(r => setTimeout(r, 560));
    const cs = [...document.querySelectorAll('.tw__col')];
    const mins = [...cs[1].querySelectorAll('.tw__item')].map(e => e.textContent.trim());
    return { on: cs.map(x => x.querySelector('.tw__item[data-on="true"]')?.textContent.trim()),
      minsLen: mins.length, last: mins[mins.length - 1] };
  })()`);
  rec("拖到最晚停在 23 点", at23.on[0] === "23", `小时=${at23.on[0]}`);
  rec("23 点的分钟到 25 为止（max 边界）", at23.minsLen === 26 && at23.last === "25", `${at23.minsLen} 格，末位 ${at23.last}`);

  // 分钟列滚到底 → 停在 25，不能越过
  const minBottom = await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[1];
    c.scrollTop = 99999;
    await new Promise(r => setTimeout(r, 560));
    const cs = [...document.querySelectorAll('.tw__col')];
    return { on: cs.map(x => x.querySelector('.tw__item[data-on="true"]')?.textContent.trim()), top: Math.round(c.scrollTop), max: c.scrollHeight - c.clientHeight };
  })()`);
  rec("分钟列滚到底也不会越过 25", minBottom.on.join(":") === "23:25" && minBottom.top === minBottom.max,
    `${minBottom.on.join(":")} top=${minBottom.top}/${minBottom.max}`);

  // 22 点是满分钟
  const at22 = await ev(`(async () => {
    const cs = [...document.querySelectorAll('.tw__col')];
    cs[0].scrollTop = 44;
    await new Promise(r => setTimeout(r, 560));
    cs[1].scrollTop = 0;
    await new Promise(r => setTimeout(r, 560));
    return cs.map(x => x.querySelector('.tw__item[data-on="true"]')?.textContent.trim());
  })()`);
  rec("22 点可以选 00 分（窗口内的整点）", at22.join(":") === "22:00", at22.join(":"));

  // 窗口内任意时间都能落位
  const picks = await ev(`(async () => {
    const cs = [...document.querySelectorAll('.tw__col')];
    const out = [];
    const read = () => cs.map(x => x.querySelector('.tw__item[data-on="true"]')?.textContent.trim()).join(":");
    const setH = async (i) => { cs[0].scrollTop = i * 44; await new Promise(r => setTimeout(r, 460)); };
    const setM = async (i) => { cs[1].scrollTop = i * 44; await new Promise(r => setTimeout(r, 460)); };
    await setH(0); await setM(0); out.push(read());
    await setM(24);               out.push(read());
    await setH(1); await setM(45); out.push(read());
    await setH(2); await setM(25); out.push(read());
    return out;
  })()`);
  rec("窗口内任意时间都能落位", picks.join(",") === "21:35,21:59,22:45,23:25", picks.join(","));

  // 松手对齐
  const align = await ev(`(async () => {
    const c = document.querySelectorAll('.tw__col')[0];
    c.scrollTop = 1 * 44 + 21;
    c.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 560));
    return { top: Math.round(c.scrollTop), want: 1 * 44, on: c.querySelector('.tw__item[data-on="true"]')?.textContent.trim() };
  })()`);
  rec("松手后自动对齐到整格", align.top === align.want, `top=${align.top} want=${align.want} (${align.on} 点)`);

  // 截一张面板图留档
  await ev(`(async () => { const cs = [...document.querySelectorAll('.tw__col')]; cs[0].scrollTop = 0; cs[1].scrollTop = 0; await new Promise(r => setTimeout(r, 500)); return 1; })()`);
  const shotData = await send("Page.captureScreenshot", { format: "png" });
  fs.mkdirSync(path.resolve(__dirname, "fbx"), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, "fbx", "wheel-window.png"), Buffer.from(shotData.data, "base64"));

  rec("滚轮没有 JS 异常", (await ev(`window.__jsErr || 0`)) === 0, `jsErr=${await ev(`window.__jsErr || 0`)}`);

  console.log(results.join("\n"));
  console.log(`\n${pass}/${pass + fail} 通过`);

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
