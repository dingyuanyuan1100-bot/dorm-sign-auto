// 模拟原生壳（注入 window.Capacitor）后按真机尺寸截图，用于核对 APK 的实际观感
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9351;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5275}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TOKEN = process.argv[2] || "";
const OUT = process.argv[3] || "qa/native";

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "native-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send("Page.enable");
  await send("Runtime.enable");
  // 412x915 = 常见 6.4 寸安卓机逻辑尺寸
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });

  const inject = `
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
    try { localStorage.setItem('dorm.token', ${JSON.stringify(TOKEN)}); } catch (e) {}
  `;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: inject });

  fs.mkdirSync(OUT, { recursive: true });

  const shots = [
    ["login", `${WEB}/?r=login#login`, true],
    ["home", `${WEB}/?r=home#home`, false],
    ["tasks", `${WEB}/?r=tasks#tasks`, false],
    ["locations", `${WEB}/?r=locations#locations`, false],
    ["logs", `${WEB}/?r=logs#logs`, false],
    ["me", `${WEB}/?r=me#me`, false],
  ];

  for (const [name, url, clearToken] of shots) {
    if (clearToken) {
      await send("Page.navigate", { url });
      await sleep(600);
      await send("Runtime.evaluate", { expression: "localStorage.clear(); 'ok'" });
      await send("Page.reload", { ignoreCache: false });
    } else {
      await send("Page.navigate", { url });
    }
    await sleep(2400);
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    const b = fs.readFileSync(file);
    console.log(name, b.readUInt32BE(16) + "x" + b.readUInt32BE(20));
  }

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
