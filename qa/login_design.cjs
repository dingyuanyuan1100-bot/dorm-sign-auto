// 登录页 1:1 还原验收：几何逐项对照设计稿 26:332，并验证输入框聚焦描边
// 设计稿坐标系 375x812（.login 用 scale(1.04) 铺满 390x844，offsetLeft 仍是设计单位）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9337;
const WEB_PORT = Number(process.env.QA_PORT || 5294);
const BASE = "http://127.0.0.1:" + WEB_PORT;
const W = 390, H = 844, DPR = 2;
const OUT = path.join(process.cwd(), "qa", "login");

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormld-"));
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

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + expr.slice(0, 80));
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
  await sleep(1000);
  await ev("localStorage.clear(); 'ok'");
  await send("Page.navigate", { url: BASE + "/?flat=1&r=login#login" });
  await sleep(2800);

  fs.mkdirSync(OUT, { recursive: true });

  // ---- 1) 几何：卡内元素 offset 与设计稿逐项比对 ----
  const geo = await ev(`(() => {
    const card = document.querySelector('.login__card');
    const pick = (sel, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight,
        rectW: +r.width.toFixed(1), rectH: +r.height.toFixed(1),
      };
    };
    const cs = (sel, prop, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      return el ? getComputedStyle(el)[prop] : null;
    };
    const page = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    return {
      card: page('.login__card'),
      label1: pick('.login__label', 0),
      field1: pick('.login__field', 0),
      label2: pick('.login__label', 1),
      field2: pick('.login__field', 1),
      check: pick('.login__check'),
      remember: pick('.login__remember'),
      forgot: pick('.login__forgot'),
      submit: pick('.login__submit'),
      alt: pick('.login__alt'),
      dog: page('.login__dog'),
      title: page('.login__title'),
      cardRadius: cs('.login__card', 'borderRadius'),
      fieldRadius: cs('.login__field', 'borderRadius'),
      cardBg: cs('.login__card', 'backgroundColor'),
      fieldBg: cs('.login__field', 'backgroundColor'),
      labelColor: cs('.login__label', 'color'),
      rememberColor: cs('.login__remember', 'color'),
      altColor: cs('.login__alt', 'color'),
      submitBg: cs('.login__submit', 'backgroundColor'),
      submitFs: cs('.login__submit', 'fontSize'),
      submitWeight: cs('.login__submit', 'fontWeight'),
      altText: document.querySelector('.login__alt')?.textContent.trim(),
      forgotText: document.querySelector('.login__forgot')?.textContent.trim(),
      rememberText: document.querySelector('.login__remember')?.textContent.trim(),
    };
  })()`);

  const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
  const design = {
    card: [16, 300, 350, 351],
    label1: [22, 24], field1: [22, 44], label2: [22, 102], field2: [22, 122],
    check: [22, 195], remember: [52, 197], forgot: [202, 197],
    submit: [22, 236, 306, 54], alt: [22, 311, 306], dog: [255, 208, 97, 129],
  };
  const cmp = (name, got, want, keys) => {
    if (!got) return rec(name, false, "元素不存在");
    const bad = keys.filter((k, i) => !near(got[["x", "y", "w", "h"][i]], want[i]));
    const detail = keys.map((k, i) => `${k}=${got[["x", "y", "w", "h"][i]]}（设计 ${want[i]}）`).join("  ");
    rec(name, bad.length === 0, detail);
  };

  cmp("卡片 位置/尺寸", geo.card, design.card, ["x", "y", "w", "h"]);
  cmp("账号标签 位置", geo.label1, design.label1, ["x", "y"]);
  cmp("账号输入框 位置", geo.field1, design.field1, ["x", "y"]);
  cmp("密码标签 位置", geo.label2, design.label2, ["x", "y"]);
  cmp("密码输入框 位置", geo.field2, design.field2, ["x", "y"]);
  cmp("勾选框 位置", geo.check, design.check, ["x", "y"]);
  cmp("记住此设备 位置", geo.remember, design.remember, ["x", "y"]);
  cmp("忘记密码 位置", geo.forgot, design.forgot, ["x", "y"]);
  cmp("登录按钮 位置/尺寸", geo.submit, design.submit, ["x", "y", "w", "h"]);
  cmp("立即注册 位置/宽度", geo.alt, design.alt, ["x", "y", "w"]);
  cmp("小狗装饰 位置/尺寸", geo.dog, design.dog, ["x", "y", "w", "h"]);

  rec("卡片圆角 26", geo.cardRadius === "26px", geo.cardRadius);
  rec("输入框圆角 16", geo.fieldRadius === "16px", geo.fieldRadius);
  rec("输入框底色 #F5F5F7", geo.fieldBg === "rgb(245, 245, 247)", geo.fieldBg);
  rec("标签色 #6E6E76", geo.labelColor === "rgb(110, 110, 118)", geo.labelColor);
  rec("记住行色 #6E6E76", geo.rememberColor === "rgb(110, 110, 118)", geo.rememberColor);
  rec("立即注册色 #1A1A1A", geo.altColor === "rgb(26, 26, 26)", geo.altColor);
  rec("按钮底色 #BEF22F", geo.submitBg === "rgb(190, 242, 47)", geo.submitBg);
  rec("按钮字号 24 / 粗体", geo.submitFs === "24px" && Number(geo.submitWeight) >= 700, `${geo.submitFs} / ${geo.submitWeight}`);
  rec("忘记密码文案带问号", geo.forgotText === "忘记密码？", geo.forgotText);
  rec("立即注册文案", geo.altText === "立即注册", geo.altText);
  rec("记住此设备文案", geo.rememberText === "记住此设备", geo.rememberText);

  await shot("ld-01-idle");

  // ---- 2) 聚焦描边（本次报的问题） ----
  const blurShadow = await ev(`getComputedStyle(document.querySelector('.login__field')).boxShadow`);
  const blurBg = await ev(`getComputedStyle(document.querySelector('.login__field')).backgroundColor`);
  await ev(`document.querySelector('#lg-user').focus(); 'ok'`);
  await sleep(320);
  const focusState = await ev(`(() => {
    const f = document.querySelectorAll('.login__field')[0];
    const cs = getComputedStyle(f);
    return { shadow: cs.boxShadow, bg: cs.backgroundColor, active: document.activeElement.id };
  })()`);
  rec("聚焦后出现墨色 1.5px 内描边",
    /rgb\(26, 26, 26\)/.test(focusState.shadow) && /1\.5px/.test(focusState.shadow) && /inset/.test(focusState.shadow),
    focusState.shadow);
  rec("聚焦后底色转白", focusState.bg === "rgb(255, 255, 255)", focusState.bg);
  rec("聚焦落点正确", focusState.active === "lg-user", focusState.active);
  await shot("ld-02-focus-user");

  // 切到密码框：前一个要复原，后一个要亮起
  await ev(`document.querySelector('#lg-pwd').focus(); 'ok'`);
  await sleep(320);
  const twoField = await ev(`(() => {
    const f = document.querySelectorAll('.login__field');
    return [getComputedStyle(f[0]).boxShadow, getComputedStyle(f[1]).boxShadow,
            getComputedStyle(f[0]).backgroundColor, getComputedStyle(f[1]).backgroundColor];
  })()`);
  rec("焦点转移到密码框后账号框复原",
    !/rgb\(26, 26, 26\)/.test(twoField[0]) && twoField[2] === "rgb(245, 245, 247)", twoField[0]);
  rec("密码框同样有描边",
    /rgb\(26, 26, 26\)/.test(twoField[1]) && twoField[3] === "rgb(255, 255, 255)", twoField[1]);
  await shot("ld-03-focus-pwd");

  // 失焦复原
  await ev(`document.activeElement.blur(); 'ok'`);
  await sleep(320);
  const backShadow = await ev(`getComputedStyle(document.querySelectorAll('.login__field')[1]).boxShadow`);
  rec("失焦后描边消失、不留死状态",
    backShadow === blurShadow, `${backShadow}（初始 ${blurShadow}）`);

  // ---- 3) 注册态：文案与几何不跳 ----
  await ev(`document.querySelector('.login__alt').click(); 'ok'`);
  await sleep(420);
  const reg = await ev(`(() => {
    const alt = document.querySelector('.login__alt');
    const btn = document.querySelector('.login__submit');
    return {
      alt: alt.textContent.trim(),
      rem: document.querySelector('.login__remember').textContent.trim(),
      forgot: !!document.querySelector('.login__forgot'),
      altY: alt.offsetTop, btnY: btn.offsetTop, btnH: btn.offsetHeight,
      btnText: btn.textContent.trim(),
      cardH: document.querySelector('.login__card').offsetHeight,
    };
  })()`);
  rec("注册态：按钮文案 注册", reg.btnText === "注册", reg.btnText);
  rec("注册态：勾选行文案 注册后自动登录", reg.rem === "注册后自动登录", reg.rem);
  rec("注册态：底部 已有账号？去登录", reg.alt === "已有账号？去登录", reg.alt);
  rec("注册态：不出现忘记密码入口", reg.forgot === false, `forgot=${reg.forgot}`);
  rec("注册态：按钮与卡片高度不跳",
    reg.altY === 311 && reg.btnY === 236 && reg.btnH === 54 && reg.cardH === 351,
    `alt=${reg.altY} btn=${reg.btnY} h=${reg.btnH} card=${reg.cardH}`);
  await shot("ld-04-register");

  // ---- 4) 报错态仍可用（卡片抖动 + 提示） ----
  await ev(`document.querySelector('.login__alt').click(); 'ok'`);
  await sleep(300);
  await ev(`document.querySelector('#lg-user').focus(); 'ok'`);
  await ev(`(() => { const i = document.querySelector('#lg-user');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, 'ab'); i.dispatchEvent(new Event('input', { bubbles: true })); })(); 'ok'`);
  await sleep(120);
  await ev(`document.querySelector('.login__submit').click(); 'ok'`);
  await sleep(120);
  const shakeAnim = await ev(`getComputedStyle(document.querySelector('.login__card')).animationName`);
  rec("校验失败时卡片抖动", shakeAnim === "shake", `animationName=${shakeAnim}`);
  await sleep(60);
  await shot("ld-05-error");

  rec("无 JS 异常", errors.length === 0, errors.join(" | "));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
