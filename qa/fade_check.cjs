// 切页过程逐帧采样：任何一帧都不应出现「整屏只剩底色」
// node qa/fade_check.cjs <token> [base]
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

function decode(buf) {
  let p = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const t = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

// 内容带（y 250~620 设计坐标 ×2 DPR）里「深色像素」占比：有卡片/文字时远大于 0
function inkRatio(file) {
  const { w, h, ch, data } = decode(fs.readFileSync(file));
  let ink = 0, total = 0;
  for (let y = Math.floor(h * 0.28); y < Math.floor(h * 0.72); y += 2) {
    for (let x = Math.floor(w * 0.1); x < Math.floor(w * 0.9); x += 2) {
      const i = (y * w + x) * ch;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      total++;
      if (lum < 120) ink++;
    }
  }
  return +(ink / total * 100).toFixed(2);
}

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9375;
const TOKEN = process.argv[2] || "";
const BASE = process.argv[3] || "http://127.0.0.1:5281";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fade-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${PORT}/json/version`); break; } catch { await sleep(200); } }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (m2, p = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m2, params: p })); });

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('dorm.token', ${JSON.stringify(TOKEN)});` });
  await send("Page.navigate", { url: `${BASE}/#home` });
  await sleep(2600);

  const grab = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const f = `qa/fade-${name}.png`;
    fs.writeFileSync(f, Buffer.from(r.data, "base64"));
    return `${name}=${inkRatio(f)}%`;
  };

  console.log("静止（首页）:", await grab("idle"));
  // 连点三次导航，逐帧采样
  await send("Runtime.evaluate", { expression: `document.querySelectorAll('.nav__item')[1].click()` });
  const a = [];
  for (const [ms, name] of [[40, "a40"], [40, "a80"], [40, "a120"], [60, "a180"], [80, "a260"]]) {
    await sleep(ms); a.push(await grab(name));
  }
  console.log("首页→任务:", a.join("  "));

  await send("Runtime.evaluate", { expression: `document.querySelectorAll('.nav__item')[2].click()` });
  const b = [];
  for (const [ms, name] of [[40, "b40"], [40, "b80"], [60, "b140"], [80, "b220"]]) {
    await sleep(ms); b.push(await grab(name));
  }
  console.log("任务→我的:", b.join("  "));
  console.log("静止（我的）:", await grab("end"));

  ws.close(); chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
})();
