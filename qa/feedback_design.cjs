// 意见反馈三屏 1:1 验收：对照设计稿 70:159（表单）/ 73:230（成功）/ 73:262（记录）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9339;
const WEB_PORT = Number(process.env.QA_PORT || 5296);
const BASE = "http://127.0.0.1:" + WEB_PORT;
const W = 390, H = 844, DPR = 2;
const OUT = path.join(process.cwd(), "qa", "feedback");

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
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormfb-"));
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
  // 线上还没有宿管回复接口，真实账号里不可能有「已回复」记录，
  // 而设计稿 73:262 是按「2 条已回复 + 处理中」画的。记录列表在这里用固定样本，
  // 表单提交与成功态仍走真接口 —— 设计稿对齐率才不会被数据形状带偏。
  const FIX_REC = (n, replied) => ({
    id: 900 + n,
    code: `FB-2026102${n}-000${n}`,
    type: n % 2 ? "功能异常" : "体验建议",
    content: replied
      ? "签到记录日历看不了上个月的记录，切月之后还是本月。"
      : "希望定位失败的时候能给一个手动重试的按钮。",
    image_count: 0,
    status: replied ? "replied" : "pending",
    reply: replied ? "已修复：日历支持切月，下个版本可见。" : null,
    created_at: `2026-10-2${n} 21:0${n}:00`,
    replied_at: replied ? `2026-10-2${n} 22:1${n}:00` : null,
    images: [],
  });
  const FIXTURE = {
    success: true,
    msg: "ok",
    data: {
      total: 4,
      pending: 2,
      items: [FIX_REC(1, true), FIX_REC(2, false), FIX_REC(3, true), FIX_REC(4, false)],
    },
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(msg.params.exceptionDetails?.exception?.description || "exception");
    if (msg.method === "Fetch.requestPaused") {
      const p = msg.params;
      const path = new URL(p.request.url).pathname;
      if (process.env.QA_DEBUG) console.log("paused", p.request.method, path);
      const getList = p.request.method === "GET" && path === "/api/feedback";
      const getOne = p.request.method === "GET" && /^\/api\/feedback\/\d+$/.test(path);
      if (process.env.QA_DEBUG) console.log("classify", p.request.method, path, "list=", getList, "one=", getOne);
      if (getList || getOne) {
        const body = getList
          ? FIXTURE
          : { success: true, msg: "ok", data: FIXTURE.data.items.find((r) => path.endsWith("/" + r.id)) || FIXTURE.data.items[0] };
        const origin = (p.request.headers.Origin || p.request.headers.origin || BASE);
        send("Fetch.fulfillRequest", {
          requestId: p.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Access-Control-Allow-Origin", value: origin },
            { name: "Access-Control-Allow-Credentials", value: "true" },
            { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
            { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
            { name: "Content-Type", value: "application/json; charset=utf-8" },
          ],
          body: Buffer.from(JSON.stringify(body)).toString("base64"),
        }).catch(() => {});
        return;
      }
      send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      return;
    }
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
  // 只拦反馈记录列表/详情（GET），其它请求原样放行
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/feedback*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(900);
  // 打包产物 API 直连线上，mock-token 会被判 401 → authed=false → 浮层不挂载，
  // 这里用 QA 账号换真 token（同源 /api/auth/login 走 preview 代理）
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
  // 让 boot 落定（/api/auth/me 往返）
  for (let i = 0; i < 12; i++) {
    if ((await ev2(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(700);
  }
  // 关掉自动弹出的「绑定晚寝账号」面板，否则模糊背景影响取色
  for (let i = 0; i < 3; i++) {
    const closed = await ev2(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!closed) break;
    await sleep(400);
  }

  fs.mkdirSync(OUT, { recursive: true });

  // 从「我的」进入意见反馈
  const opened = await ev2(`(() => {
    const b = document.querySelector('.listrow[data-key="feedback"] .listrow__value');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  rec("我的页有意见反馈入口", opened === true, `clicked=${opened}`);
  await sleep(700);

  const geo = await ev2(`(() => {
    const g = (sel, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return null;
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    const cs = (sel, prop, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      return el ? getComputedStyle(el)[prop] : null;
    };
    return {
      title: g('.fb__title'),
      record: g('.fb__record'),
      card: g('.fb__card'),
      dog: g('.fb__dog'),
      illL: g('.fb__ill--l'),
      illR: g('.fb__ill--r'),
      upload: g('.fb__upload'),
      optional: g('.fb__optional'),
      labels: [g('.fb__label', 0), g('.fb__label', 1)],
      type1: (() => {
        const t = document.querySelectorAll('.fb__type')[0];
        return t ? { x: t.offsetLeft, y: t.offsetTop + t.parentElement.offsetTop, w: t.offsetWidth, h: t.offsetHeight } : null;
      })(),
      type2: (() => {
        const t = document.querySelectorAll('.fb__type')[1];
        return t ? { x: t.offsetLeft, y: t.offsetTop + t.parentElement.offsetTop, w: t.offsetWidth, h: t.offsetHeight } : null;
      })(),
      area: g('.fb__area'),
      submit: g('.fb__submit'),
      cardRadius: cs('.fb__card', 'borderRadius'),
      cardBg: cs('.fb__card', 'backgroundColor'),
      uploadBg: cs('.fb__upload', 'backgroundColor'),
      pageBg: cs('.fb', 'backgroundColor'),
      typeOnBg: cs('.fb__type', 'backgroundColor'),
      typeOffBg: cs('.fb__type', 'backgroundColor', 1),
      titleText: document.querySelector('.fb__title')?.textContent.trim(),
      recordText: document.querySelector('.fb__record')?.textContent.trim(),
      labelText: Array.from(document.querySelectorAll('.fb__label')).map((n) => n.textContent.trim()),
      typeText: Array.from(document.querySelectorAll('.fb__type')).map((n) => n.textContent.trim()),
      hintText: document.querySelector('.fb__hint')?.textContent.trim(),
      submitText: document.querySelector('.fb__submit')?.textContent.trim(),
    };
  })()`);

  const cmp = (name, got, want, keys) => {
    if (!got) return rec(name, false, "元素不存在");
    const bad = keys.filter((k, i) => !near(got[["x", "y", "w", "h"][i]], want[i]));
    rec(name, bad.length === 0, keys.map((k, i) => `${k}=${got[["x", "y", "w", "h"][i]]}（设计 ${want[i]}）`).join("  "));
  };

  cmp("标题 意见反馈", geo.title, [26, 97], ["x", "y"]);
  cmp("记录入口", geo.record, [296, 99, 80, 18], ["x", "y", "w", "h"]);
  cmp("卡片 反馈内容", geo.card, [16, 217, 358, 421], ["x", "y", "w", "h"]);
  cmp("小狗插画（压在卡片顶边）", geo.dog, [104, -92, 143, 149], ["x", "y", "w", "h"]);
  cmp("左侧装饰插画", geo.illL, [57, 124, 101, 52], ["x", "y", "w", "h"]);
  cmp("右侧装饰插画", geo.illR, [191, 102, 126, 106], ["x", "y", "w", "h"]);
  cmp("添加截图区", geo.upload, [13, 59, 333, 112], ["x", "y", "w", "h"]);
  cmp("选填角标", geo.optional, [281, 13, 36, 18], ["x", "y", "w", "h"]);
  cmp("反馈类型标签", geo.labels[0], [13, 183], ["x", "y"]);
  cmp("问题描述标签", geo.labels[1], [13, 263], ["x", "y"]);
  cmp("类型胶囊 1", geo.type1, [13, 209, 102, 34], ["x", "y", "w", "h"]);
  cmp("类型胶囊 2", geo.type2, [128, 209, 102, 34], ["x", "y", "w", "h"]);
  cmp("问题描述输入框", geo.area, [13, 289, 332, 119], ["x", "y", "w", "h"]);
  cmp("提交按钮", geo.submit, [16, 659, 358, 54], ["x", "y", "w", "h"]);

  rec("卡片圆角 20", geo.cardRadius === "20px", geo.cardRadius);
  rec("卡片白底 / 页面 #F5F5F7",
    geo.cardBg === "rgb(255, 255, 255)" && geo.pageBg === "rgb(245, 245, 247)",
    `${geo.cardBg} / ${geo.pageBg}`);
  rec("上传区底色 #F0F0F3", geo.uploadBg === "rgb(240, 240, 243)", geo.uploadBg);
  rec("选中胶囊为 lime / 未选为灰",
    geo.typeOnBg === "rgb(190, 242, 47)" && geo.typeOffBg === "rgb(240, 240, 243)",
    `${geo.typeOnBg} / ${geo.typeOffBg}`);
  rec("文案：标题/记录/标签/胶囊/按钮",
    geo.titleText === "意见反馈" && geo.recordText === "记录 ›" &&
      geo.labelText.join("/") === "反馈类型/问题描述" &&
      geo.typeText.join("/") === "功能异常/体验建议" &&
      geo.submitText === "提交反馈",
    `${geo.titleText} | ${geo.recordText} | ${geo.labelText.join(",")} | ${geo.typeText.join(",")} | ${geo.submitText}`);
  rec("上传说明文案", geo.hintText === "最多 3 张，支持 JPG / PNG", geo.hintText);

  await shot("fb-01-form");

  // ---- 交互：聚焦描边 / 类型切换 / 空提交报错 ----
  const areaIdle = await ev2(`getComputedStyle(document.querySelector('.fb__area')).boxShadow`);
  await ev2(`document.querySelector('.fb__area textarea').focus(); 'ok'`);
  await sleep(300);
  const areaFocus = await ev2(`getComputedStyle(document.querySelector('.fb__area')).boxShadow`);
  rec("描述框聚焦有墨色描边",
    /rgb\(26, 26, 26\)/.test(areaFocus) && /inset/.test(areaFocus),
    `${areaFocus}（初始 ${areaIdle}）`);
  await ev2(`document.activeElement.blur(); 'ok'`);

  await ev2(`document.querySelectorAll('.fb__type')[1].click(); 'ok'`);
  await sleep(320);
  const switched = await ev2(`(() => {
    const t = document.querySelectorAll('.fb__type');
    return [getComputedStyle(t[0]).backgroundColor, getComputedStyle(t[1]).backgroundColor,
            t[1].getAttribute('aria-checked')];
  })()`);
  rec("切换反馈类型：高亮跟着走",
    switched[0] === "rgb(240, 240, 243)" && switched[1] === "rgb(190, 242, 47)" && switched[2] === "true",
    switched.join(" / "));

  // 空描述直接提交 → 报错 + 抖动，不进入成功页
  await ev2(`document.querySelector('.fb__submit').click(); 'ok'`);
  await sleep(120);
  const errState = await ev2(`(() => ({
    err: document.querySelector('.fb__err')?.textContent.trim() || '',
    shake: getComputedStyle(document.querySelector('.fb__card')).animationName,
    areaErr: document.querySelector('.fb__area').getAttribute('data-err'),
    step: document.querySelector('.fb').getAttribute('data-step'),
  }))()`);
  rec("空描述提交被拦：红边 + 抖动 + 提示",
    errState.err.includes("描述太短") && errState.shake === "fbShake" &&
      errState.areaErr === "true" && errState.step === "form",
    `err=${errState.err} anim=${errState.shake} areaErr=${errState.areaErr} step=${errState.step}`);

  // 同一条校验错误不应该出现第二次（卡片内 + 全局 Toast），且提交按钮不能被遮挡
  const dedup = await ev2(`(() => {
    const b = document.querySelector('.fb__submit');
    const r = b.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      toast: document.querySelectorAll('.toast').length,
      onTop: !!(hit && (hit === b || b.contains(hit))),
      btnTop: Math.round(r.top),
      btnBottom: Math.round(r.bottom),
    };
  })()`);
  rec("校验错误只提示一次：不重复弹 Toast，且提交按钮未被遮挡",
    dedup.toast === 0 && dedup.onTop === true,
    `toast=${dedup.toast} 按钮中心可点=${dedup.onTop} 按钮 ${dedup.btnTop}~${dedup.btnBottom}`);
  await shot("fb-02-error");

  // ---- 填写并提交 ----
  await ev2(`(() => {
    const ta = document.querySelector('.fb__area textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, '签到定位一直显示未定位，重启也没用');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })(); 'ok'`);
  await sleep(200);
  const errCleared = await ev2(`(() => ({
    err: document.querySelector('.fb__err')?.textContent.trim() || '',
    areaErr: document.querySelector('.fb__area').getAttribute('data-err'),
  }))()`);
  rec("开始输入后错误提示与红边立即清除",
    errCleared.err === "" && errCleared.areaErr !== "true",
    `err=${errCleared.err} areaErr=${errCleared.areaErr}`);
  await shot("fb-03-typed");

  await ev2(`document.querySelector('.fb__submit').click(); 'ok'`);
  await sleep(900);
  const doneState = await ev2(`(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    const cs = (sel, p) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[p] : null; };
    return {
      step: document.querySelector('.fb').getAttribute('data-step'),
      badge: g('.fb__badge'),
      title: g('.fb__done-title'),
      desc: g('.fb__done-desc'),
      receipt: g('.fb__receipt'),
      btn1: g('.fb__submit'),
      btn2: g('.fb__ghost'),
      close: g('.fb__close'),
      badgeBg: cs('.fb__badge', 'backgroundColor'),
      badgeRadius: cs('.fb__badge', 'borderRadius'),
      labels: Array.from(document.querySelectorAll('.fb__rlabel')).map((n) => n.textContent.trim()),
      values: Array.from(document.querySelectorAll('.fb__rvalue')).map((n) => n.textContent.trim()),
      btn1Text: document.querySelector('.fb__submit')?.textContent.trim(),
      btn2Text: document.querySelector('.fb__ghost')?.textContent.trim(),
    };
  })()`);
  rec("提交后进入成功页", doneState.step === "done" && doneState.badge !== null, `step=${doneState.step}`);
  cmp("成功徽标 88×88", doneState.badge, [151, 196, 88, 88], ["x", "y", "w", "h"]);
  cmp("成功标题", doneState.title, [0, 306, 390, 34], ["x", "y", "w"]);
  cmp("成功说明", doneState.desc, [40, 348, 310], ["x", "y", "w"]);
  cmp("凭证卡", doneState.receipt, [16, 412, 358, 128], ["x", "y", "w", "h"]);
  cmp("查看反馈记录按钮", doneState.btn1, [16, 576, 358, 54], ["x", "y", "w", "h"]);
  cmp("返回首页按钮", doneState.btn2, [16, 642, 358, 54], ["x", "y", "w", "h"]);
  rec("徽标为 lime 圆形", doneState.badgeBg === "rgb(190, 242, 47)" && doneState.badgeRadius === "44px",
    `${doneState.badgeBg} / ${doneState.badgeRadius}`);
  rec("凭证卡三行标签",
    doneState.labels.join("/") === "反馈编号/反馈类型/提交时间", doneState.labels.join("/"));
  rec("凭证卡值已回填（编号/类型/时间）",
    /^FB-\d{8}-\d{4}$/.test(doneState.values[0] || "") &&
      (doneState.values[1] || "").startsWith("体验建议") &&
      /\d{1,2}:\d{2}/.test(doneState.values[2] || ""),
    doneState.values.join(" | "));
  rec("两个按钮文案", doneState.btn1Text === "查看反馈记录" && doneState.btn2Text === "返回首页",
    `${doneState.btn1Text} / ${doneState.btn2Text}`);
  await shot("fb-04-done");

  // ---- 反馈记录 ----
  await ev2(`document.querySelector('.fb__submit').click(); 'ok'`);
  await sleep(1100);
  const recState = await ev2(`(() => {
    const g = (sel, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      if (!el) return null;
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    const cs = (sel, p, i = 0) => {
      const el = document.querySelectorAll(sel)[i];
      return el ? getComputedStyle(el)[p] : null;
    };
    return {
      step: document.querySelector('.fb').getAttribute('data-step'),
      title: g('.fb__title'),
      stat: g('.fb__stat'),
      statText: document.querySelector('.fb__stat')?.textContent.trim(),
      count: document.querySelectorAll('.fb__rec').length,
      cards: Array.from(document.querySelectorAll('.fb__rec')).map((n) => {
        const r = n.getBoundingClientRect();
        const b = document.querySelector('.fb').getBoundingClientRect();
        return { y: Math.round(r.top - b.top), h: Math.round(r.height) };
      }),
      recsScrollable: (() => {
        const c = document.querySelector('.fb__recs');
        return c ? c.scrollHeight > c.clientHeight + 1 : false;
      })(),
      statusText: Array.from(document.querySelectorAll('.fb__status')).map((n) => n.textContent.trim()),
      statusBg: Array.from(document.querySelectorAll('.fb__status')).map((n) => getComputedStyle(n).backgroundColor),
      tagText: Array.from(document.querySelectorAll('.fb__tag')).map((n) => n.textContent.trim()),
      titles: Array.from(document.querySelectorAll('.fb__rtitle')).map((n) => n.textContent.trim()),
      meta: Array.from(document.querySelectorAll('.fb__rmeta')).map((n) => n.textContent.trim()),
      reply: Array.from(document.querySelectorAll('.fb__rreply')).map((n) => n.textContent.trim()),
      replyLabel: document.querySelector('.fb__rreply-label')?.textContent.trim(),
      wait: Array.from(document.querySelectorAll('.fb__rwait')).map((n) => n.textContent.trim()),
      backExists: !!document.querySelector('.fb__back'),
    };
  })()`);
  rec("进入反馈记录页", recState.step === "records", `step=${recState.step}`);
  cmp("记录页标题位置", recState.title, [24, 92], ["x", "y"]);
  cmp("统计行位置", recState.stat, [24, 126], ["x", "y"]);
  rec("记录卡片数量", recState.count >= 4, `count=${recState.count}`);
  const cards = recState.cards || [];
  const stacked = cards.every((c, i) => (i === 0 ? near(c.y, 196) : near(c.y, cards[i - 1].y + cards[i - 1].h + 12)));
  rec("首卡在 196、卡间距 12（设计稿）", cards.length >= 4 && stacked,
    cards.map((c) => `${c.y}/${c.h}`).join("  "));
  rec("卡高按状态取 156（已回复）/116（处理中）",
    cards.every((c) => c.h === 156 || c.h === 116), cards.map((c) => c.h).join(","));
  rec("记录超出可视区可滚动（不被导航栏压住）",
    recState.recsScrollable === true, `scrollable=${recState.recsScrollable}`);
  const statusOk = recState.statusText.every((t, i) =>
    t === "已回复" ? recState.statusBg[i] === "rgb(190, 242, 47)" : recState.statusBg[i] === "rgb(240, 240, 243)",
  );
  rec("状态胶囊：已回复为 lime、处理中为灰",
    statusOk && recState.statusText.includes("已回复") && recState.statusText.includes("处理中"),
    recState.statusText.map((t, i) => `${t}=${recState.statusBg[i]}`).join(" / "));
  rec("统计文案含总数与处理中条数",
    /^共 \d+ 条 · \d+ 条处理中$/.test(recState.statText || ""), recState.statText);
  rec("已回复卡带官方回复块",
    recState.replyLabel === "官方回复" && recState.reply[0].length > 6, recState.reply[0] || "");
  rec("处理中卡显示等待提示",
    recState.wait[0] === "预计 1 个工作日内回复", recState.wait[0] || "");
  rec("有返回按钮", recState.backExists === true, `back=${recState.backExists}`);
  await shot("fb-05-records");

  rec("无 JS 异常", errors.length === 0, errors.join(" | "));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
