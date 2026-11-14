// 带登录态的截图：CDP 注入 token 后逐页抓 390x844 @2x
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const WEB_PORT = Number(process.env.QA_PORT || 5275);
const BASE = "http://127.0.0.1:" + WEB_PORT;
const W = 390,
  H = 844,
  DPR = 2;

const token = process.argv[2];
const outDir = process.argv[3] || path.join(process.cwd(), "qa", "app");
const only = process.argv[4] ? process.argv[4].split(",") : null;

/* ---------- PNG ---------- */
function decode(buf) {
  let p = 8, width = 0, height = 0, ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { width = d.readUInt32BE(0); height = d.readUInt32BE(4); ct = d[9]; }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { width, height, ch, data: out };
}
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function encodeRGB(width, height, data) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function cropTo(img, w, h) {
  const out = Buffer.alloc(w * h * 3);
  const cw = Math.min(w, img.width), chh = Math.min(h, img.height);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y * img.width + x) * img.ch;
      const d = (y * w + x) * 3;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
    }
  }
  return out;
}

/* ---------- CDP ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormqa-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try {
      ver = await getJSON(`http://127.0.0.1:${PORT}/json/version`);
      if (ver) break;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  if (!ver) throw new Error("Chrome 未启动");

  const targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
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
  await send("Emulation.setDeviceMetricsOverride", {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: false,
  });

  // 先落到同源页面，写入 token
  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(1200);
  if (token) {
    await send("Runtime.evaluate", {
      expression: `localStorage.setItem('dorm.token', ${JSON.stringify(token)}); 'ok'`,
    });
  }

  const shots = [
    ["login", BASE + "/?flat=1&r=login#login"],
    ["home", BASE + "/?flat=1&r=home#home"],
    ["tasks", BASE + "/?flat=1&r=tasks#tasks"],
    ["locations", BASE + "/?flat=1&r=locations#locations"],
    ["logs", BASE + "/?flat=1&r=logs#logs"],
    ["me", BASE + "/?flat=1&r=me#me"],
  ].filter(([n]) => !only || only.includes(n));

  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, url] of shots) {
    if (name === "login") {
      await send("Runtime.evaluate", { expression: "localStorage.clear(); 'ok'" });
    } else if (token) {
      await send("Runtime.evaluate", {
        expression: `localStorage.setItem('dorm.token', ${JSON.stringify(token)}); 'ok'`,
      });
    }
    await send("Page.navigate", { url });
    await sleep(2600);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const img = decode(Buffer.from(shot.data, "base64"));
    const data = cropTo(img, W * DPR, H * DPR);
    fs.writeFileSync(path.join(outDir, `${name}.png`), encodeRGB(W * DPR, H * DPR, data));
    console.log(`${name}.png  ${img.width}x${img.height} -> ${W * DPR}x${H * DPR}`);
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
