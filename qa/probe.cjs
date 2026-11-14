// 读取 ?probe=1 注入的元素盒子，输出 名字 x/y/w/h
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9334;
const token = process.argv[2] || "";
const routes = (process.argv[3] || "home,tasks,locations,logs,me,login").split(",");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormprobe-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
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
  const listTargets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = (await listTargets()).find((t) => t.type === "page");
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:5275/?flat=1&r=boot" });
  await sleep(900);

  for (const r of routes) {
    await send("Runtime.evaluate", {
      expression:
        r === "login"
          ? "localStorage.clear();'ok'"
          : `localStorage.setItem('dorm.token', ${JSON.stringify(token)});'ok'`,
    });
    await send("Page.navigate", { url: `http://127.0.0.1:5275/?flat=1&probe=1&r=${r}#${r}` });
    await sleep(2800);
    const res = await send("Runtime.evaluate", {
      expression: `(document.getElementById('probe')||{}).textContent||'NO PROBE'`,
      returnByValue: true,
    });
    console.log(`\n===== ${r} =====`);
    console.log(res.result.value);
  }

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
