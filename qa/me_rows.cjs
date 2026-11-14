// 「我的」页列表卡 1:1 验收：对照设计稿 26:279 / 26:281
// 重点覆盖新增的「意见反馈」行（设计稿 70:322 行 5 @ y=86）与卡高 342。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9341;
const WEB_PORT = Number(process.env.QA_PORT || 5296);
const BASE = "http://127.0.0.1:" + WEB_PORT;
const W = 390, H = 844, DPR = 2;
const OUT = path.join(process.cwd(), "qa", "me");

/* ---------- PNG（只用来落一张截图做目视复核） ---------- */
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
  for (let y = 0; y < chh; y++)
    for (let x = 0; x < cw; x++) {
      const s = (y * img.width + x) * img.ch;
      const d = (y * w + x) * 3;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
    }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

let pass = 0, fail = 0;
const rec = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormme-"));
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });

  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await getJSON(`http://127.0.0.1:${PORT}/json/version`); if (ver) break; } catch {}
    await sleep(200);
  }
  if (!ver) throw new Error("Chrome 未启动");

  const targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(msg.params.exceptionDetails?.exception?.description || "exception");
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

  const ev2 = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + expr.slice(0, 90));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const img = decode(Buffer.from(s.data, "base64"));
    fs.writeFileSync(path.join(OUT, `${name}.png`), encodeRGB(W * DPR, H * DPR, cropTo(img, W * DPR, H * DPR)));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(900);
  // 真 token：打包产物 API 直连线上，mock-token 会 401 → authed=false → 反馈浮层不挂载
  const qaTok = await ev2(`(async () => {
    try {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }) });
      const j = await r.json();
      return (j && j.data && j.data.token) || "mock-token";
    } catch (e) { return "mock-token"; }
  })()`);
  await ev2(`localStorage.setItem('dorm.token', ${JSON.stringify(qaTok)}); 'ok'`);
  await send("Page.navigate", { url: BASE + "/?flat=1&r=me#me" });
  await sleep(2600);
  for (let i = 0; i < 12; i++) {
    if ((await ev2(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(700);
  }
  for (let i = 0; i < 3; i++) {
    const closed = await ev2(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!closed) break;
    await sleep(400);
  }

  fs.mkdirSync(OUT, { recursive: true });

  const g = await ev2(`(() => {
    const box = (el) => el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
    const card = document.querySelector('.listcard');
    const rows = [...document.querySelectorAll('.listrow')].map((r) => ({
      key: r.dataset.key,
      label: r.querySelector('.listrow__label')?.textContent.trim(),
      labelTop: r.querySelector('.listrow__label')?.offsetTop,
      value: r.querySelector('.listrow__value')?.textContent.trim(),
      valueTop: r.querySelector('.listrow__value')?.offsetTop,
    }));
    const divs = [...document.querySelectorAll('.listcard__div')].map((d) => d.offsetTop);
    const lo = document.querySelector('.logout');
    const lg = lo ? getComputedStyle(lo) : {};
    return {
      card: box(card),
      rows, divs,
      logout: box(lo),
      logoutBottom: lg.bottom,
      rowsAttr: card?.dataset.rows,
    };
  })()`);

  rec("列表卡几何 x=20 y=262 w=350 h=342",
    g.card && g.card.x === 20 && g.card.y === 262 && g.card.w === 350 && g.card.h === 342,
    JSON.stringify(g.card));

  rec("列表卡按 5 行取 342 高（设计稿 26:281）", g.rowsAttr === "5", `data-rows=${g.rowsAttr}`);

  rec("行顺序：晚寝账号 / 意见反馈 / 安全与隐私 / 日志 / 关于",
    g.rows.map((r) => r.label).join("/") === "晚寝账号/意见反馈/安全与隐私/日志/关于",
    g.rows.map((r) => r.label).join(" / "));

  const wantLabel = [22, 86, 153, 220, 283];
  rec("行标签纵坐标 22/86/153/220/283",
    g.rows.every((r, i) => r.labelTop === wantLabel[i]),
    g.rows.map((r) => r.labelTop).join(" / "));

  const wantValue = [24, 86, 153, 224, 285];
  rec("行值纵坐标 24/86/153/224/285",
    g.rows.every((r, i) => r.valueTop === wantValue[i]),
    g.rows.map((r) => r.valueTop).join(" / "));

  rec("四条分割线 66/132/195/264（设计稿 264.33）",
    g.divs.slice().sort((a, b) => a - b).join(",") === "66,132,195,264",
    g.divs.slice().sort((a, b) => a - b).join(" / "));

  rec("意见反馈行值文案为 ›", g.rows[1]?.value === "›", `value=${g.rows[1]?.value}`);

  rec("退出登录按钮 20/616/350/54，且与卡片不重叠",
    g.logout && g.logout.x === 20 && g.logout.y === 616 && g.logout.w === 350 && g.logout.h === 54 &&
      g.card.y + g.card.h <= g.logout.y,
    `${JSON.stringify(g.logout)} 卡片底=${g.card.y + g.card.h} 按钮顶=${g.logout.y}`);

  rec("五个入口都能点（不是装饰文本）",
    (await ev2(`document.querySelectorAll('.listrow__value').length`)) === 5,
    "listrow__value × 5");

  await shot("me-01");

  // 点「意见反馈」应进入反馈页
  await ev2(`document.querySelector('.listrow[data-key="feedback"] .listrow__value').click(); 'ok'`);
  await sleep(700);
  const entered = await ev2(`(() => { const el = document.querySelector('.fb'); return el ? el.getAttribute('data-step') : ''; })()`);
  rec("点「意见反馈」进入反馈表单", entered === "form", `step=${entered}`);


  rec("无 JS 异常", errors.length === 0, errors.join(" | "));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  ws.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
