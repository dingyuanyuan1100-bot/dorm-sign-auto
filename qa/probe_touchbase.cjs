// 对照实验：极简可滚动的 div，验证 headless 的触摸手势是否真能滚
//   node qa/probe_touchbase.cjs
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9650 + Math.floor(Math.random() * 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font:14px sans-serif}
  .col{position:absolute;left:40px;top:100px;width:80px;height:180px;overflow-y:auto;background:#eee}
  .col.touch-scroll{-webkit-overflow-scrolling:touch}
  .col.snap{scroll-snap-type:y mandatory}
  .col.snap .it{scroll-snap-align:center}
  .col.pad{padding:68px 0}
  .it{height:44px;line-height:44px;text-align:center}
</style>
<div class="col" id="a"><div id="a-in"></div></div>
<div class="col touch-scroll snap" id="b" style="left:160px"><div id="b-in"></div></div>
<div class="col touch-scroll snap pad" id="c" style="left:280px"><div id="c-in"></div></div>
<script>
  for (const [id, n] of [['a-in',40],['b-in',40],['c-in',40]]) {
    const box = document.getElementById(id);
    const parent = box.parentElement;
    for (let i=0;i<n;i++){ const d=document.createElement('div'); d.className='it'; d.textContent=i; if(parent.classList.contains('snap')) d.classList.add('it'); box.appendChild(d); }
  }
</script>`;

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ptb-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run",
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
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(HTML) });
  await sleep(800);

  const read = () => ev(`JSON.stringify({ a: document.getElementById('a').scrollTop, b: document.getElementById('b').scrollTop, c: document.getElementById('c').scrollTop })`);
  console.log("起始:", await read());

  for (const [name, x] of [["普通", 80], ["snap+touch", 200], ["snap+touch+pad", 320]]) {
    await send("Input.synthesizeScrollGesture", { x, y: 180, yDistance: -200, speed: 1000, gestureSourceType: "touch" });
    await sleep(700);
    console.log(name + " 触摸上滑 →", await read());
  }
  for (const [name, x] of [["普通", 80], ["snap+touch", 200], ["snap+touch+pad", 320]]) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y: 180, deltaX: 0, deltaY: 120, pointerType: "mouse" });
    await sleep(500);
    console.log(name + " 滚轮下滑 →", await read());
  }

  ws.close();
  chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
})();
