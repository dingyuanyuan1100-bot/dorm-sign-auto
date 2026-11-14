// 绑定晚寝账号弹层：文案精简后的高度与可见文本验收（mock 未绑定态）
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9391;
const WEB = `http://127.0.0.1:${process.env.QA_PORT || 5292}`;
const OUT = path.join(__dirname, "fix");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const MOCK = `
(() => {
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
  const real = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.includes("/api/")) return real(input, init);
    const p = url.replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
    if (p === "/api/auth/me") return Promise.resolve(json({ success: true, msg: "", data: { username: "123456", has_dorm_account: false, student_id: "" } }));
    if (p === "/api/dorm-account") return Promise.resolve(json({ success: false, msg: "尚未绑定晚寝账号", data: null }));
    if (p === "/api/update" || p.includes("version.json")) return Promise.resolve(json({ version: "2.0.4", versionCode: 16, notes: [] }));
    return Promise.resolve(json({ success: true, msg: "", data: [] }));
  };
})();
`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bindcopy-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('dorm.token','qa-mock-token');localStorage.removeItem('dorm.update.snoozed');}catch(e){};${MOCK}` });
  const W = Number(process.env.QA_W || 412), H = Number(process.env.QA_H || 915);
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });

  await send("Page.navigate", { url: `${WEB}/?native=1#home` });
  await sleep(3200);

  const info = await evalJs(`(() => {
    const sheet = document.querySelector('.sheet');
    const r = sheet?.getBoundingClientRect();
    const fields = document.querySelector('.sheet__fields')?.getBoundingClientRect();
    return {
      open: !!sheet,
      title: document.querySelector('.sheet__title')?.textContent || '',
      desc: document.querySelector('.sheet__desc')?.textContent || '',
      hints: [...document.querySelectorAll('.sheet__hint')].map(e => e.textContent.trim()),
      sheetTop: r ? Math.round(r.top) : null,
      sheetH: r ? Math.round(r.height) : null,
      fieldsH: fields ? Math.round(fields.height) : null,
      placeholders: [...document.querySelectorAll('.sheet__field input')].map(i => i.placeholder),
      btns: [...document.querySelectorAll('.sheet__btn')].map(b => b.textContent.trim()),
    };
  })()`);
  console.log(JSON.stringify(info, null, 2));
  await shot(`bind-copy-${W}x${H}`);
  process.exit(0);
})();
