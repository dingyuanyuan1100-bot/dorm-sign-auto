// 首页 / 重置成功 一比一验收
//   首页   对照设计稿 17:12「02 总览」
//   成功页 对照设计稿 73:65「05 忘记密码 · 04 重置成功」
// 起点：qa/mock_design_server.py（端口 8809，数据对齐画布）+ vite preview
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9342;
const WEB_PORT = Number(process.env.QA_PORT || 5297);
const BASE = "http://127.0.0.1:" + WEB_PORT;
const W = 390, H = 844, DPR = 2;
const OUT = path.join(process.cwd(), "qa", "home");

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
const eq = (a, b) => Math.abs(a - b) < 0.6;

// 累加 offsetParent 得到设计坐标系里的绝对位置（忽略 scale 变换）
const ABS = `const abs = (el) => {
  let x = 0, y = 0, n = el;
  while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
};`;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormhome-"));
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

  fs.mkdirSync(OUT, { recursive: true });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: false });

  /* ================= 首页 ================= */
  console.log("--- 首页（设计稿 17:12）---");
  const goto = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 60; i++) {
      try {
        const ok = await ev2(`document.readyState === 'complete' && location.origin === ${JSON.stringify(BASE)}`);
        if (ok) return;
      } catch {}
      await sleep(150);
    }
    throw new Error("页面未加载完成: " + url);
  };

  await goto(BASE + "/?flat=1");
  await ev2(`localStorage.setItem('dorm.token','mock-token'); localStorage.removeItem('dorm.notice.seen'); 'ok'`);
  await goto(BASE + "/?flat=1&r=home#home");
  await sleep(2500);

  const hm = await ev2(`(() => {
    ${ABS}
    const q = (s) => document.querySelector(s);
    const hero = q('.hero');
    const cs = hero && getComputedStyle(hero);
    return {
      hero: window.__box = hero ? abs(hero) : null,
      heroRadius: cs?.borderTopLeftRadius,
      heroBg: cs?.backgroundColor,
      label: q('.hero__label') ? abs(q('.hero__label')) : null,
      time: q('.hero__time') ? Object.assign(abs(q('.hero__time')), { t: q('.hero__time').textContent.trim(), c: getComputedStyle(q('.hero__time')).color }) : null,
      pill: q('.hero__pill') ? Object.assign(abs(q('.hero__pill')), { r: getComputedStyle(q('.hero__pill')).borderTopLeftRadius, t: q('.hero__pill').textContent.trim() }) : null,
      place: q('.hero__place') ? Object.assign(abs(q('.hero__place')), { t: q('.hero__place').textContent.trim() }) : null,
      cta: q('.hero__cta') ? Object.assign(abs(q('.hero__cta')), { r: getComputedStyle(q('.hero__cta')).borderTopLeftRadius, t: q('.hero__cta').textContent.trim() }) : null,
      pinCount: document.querySelectorAll('.home__pin').length,
      heroSvgs: hero ? hero.querySelectorAll('svg').length : -1,
      statA: q('.stat--a') ? Object.assign(abs(q('.stat--a')), { r: getComputedStyle(q('.stat--a')).borderTopLeftRadius }) : null,
      statB: q('.stat--b') ? abs(q('.stat--b')) : null,
      check: q('.stat--b .stat__check') ? abs(q('.stat--b .stat__check')) : null,
      sectionY: q('.section-title') ? abs(q('.section-title')).y : null,
      rows: [...document.querySelectorAll('.taskrow')].map((r) => Object.assign(abs(r), { off: r.dataset.off, t: r.querySelector('.taskrow__time')?.textContent.trim() })),
      notice: document.querySelectorAll('.notice, .noticecard, [class*="notice"]').length,
    };
  })()`);

  rec("主卡 20/136/350/196", hm.hero && eq(hm.hero.x, 20) && eq(hm.hero.y, 136) && eq(hm.hero.w, 350) && eq(hm.hero.h, 196), JSON.stringify(hm.hero));
  rec("主卡圆角 26 / 纯黑 #1a1a1a", hm.heroRadius === "26px" && hm.heroBg === "rgb(26, 26, 26)", `${hm.heroRadius} ${hm.heroBg}`);
  rec("主卡内没有水滴形装饰（画布已删）", hm.pinCount === 0 && hm.heroSvgs === 0, `pin=${hm.pinCount} svg=${hm.heroSvgs}`);
  rec("「今晚签到」42/158",
    hm.label && eq(hm.label.x, 42) && eq(hm.label.y, 158), JSON.stringify(hm.label));
  rec("时间 40/176、色 #bef22f、文案 23:30",
    hm.time && eq(hm.time.x, 40) && eq(hm.time.y, 176) && hm.time.c === "rgb(190, 242, 47)" && hm.time.t === "23:30",
    JSON.stringify(hm.time));
  rec("状态胶囊 280/160/68/26、圆角 13",
    hm.pill && eq(hm.pill.x, 280) && eq(hm.pill.y, 160) && eq(hm.pill.w, 68) && eq(hm.pill.h, 26) && hm.pill.r === "13px",
    JSON.stringify(hm.pill));
  rec("位置行 42/240、文案「3 号公寓 · 502」",
    hm.place && eq(hm.place.x, 42) && eq(hm.place.y, 240) && hm.place.t === "3 号公寓 · 502",
    JSON.stringify(hm.place));
  rec("立即签到 212/272/136/42、圆角 14",
    hm.cta && eq(hm.cta.x, 212) && eq(hm.cta.y, 272) && eq(hm.cta.w, 136) && eq(hm.cta.h, 42) && hm.cta.r === "14px",
    JSON.stringify(hm.cta));
  rec("指标卡 20/348 与 199/348、171×88、圆角 22",
    hm.statA && hm.statB && eq(hm.statA.x, 20) && eq(hm.statA.y, 348) && eq(hm.statA.w, 171) && eq(hm.statA.h, 88) &&
      eq(hm.statB.x, 199) && eq(hm.statB.y, 348) && hm.statA.r === "22px",
    `${JSON.stringify(hm.statA)} ${JSON.stringify(hm.statB)}`);
  rec("最近执行徽标 317/383", hm.check && eq(hm.check.x, 317) && eq(hm.check.y, 383), JSON.stringify(hm.check));
  rec("「签到任务」标题 458", eq(hm.sectionY, 458), `y=${hm.sectionY}`);
  rec("任务行 496 / 594，均 350×86",
    hm.rows.length === 2 && eq(hm.rows[0].x, 20) && eq(hm.rows[0].y, 496) && eq(hm.rows[1].y, 594) &&
      eq(hm.rows[0].w, 350) && eq(hm.rows[0].h, 86),
    JSON.stringify(hm.rows));
  rec("第二条任务为停用态", hm.rows[1] && hm.rows[1].off === "true", `off=${hm.rows[1]?.off}`);
  rec("无公告时首页不出公告条", hm.notice === 0, `notice=${hm.notice}`);

  await shot("home-01");

  /* ================= 重置成功 ================= */
  console.log("\n--- 重置成功（设计稿 73:65）---");
  await ev2(`localStorage.clear(); 'ok'`);
  await goto(BASE + "/?flat=1&r=login#login");
  await sleep(1800);

  const onLogin = await ev2(`!!document.querySelector('.login__forgot')`);
  rec("回到登录页", onLogin === true, `forgot=${onLogin}`);

  await ev2(`document.querySelector('.login__forgot').click(); 'ok'`);
  await sleep(700);

  const setV = async (sel, v) => ev2(`(() => {
    const el = document.querySelector('${sel}');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`);

  await setV("#rc-sid", "2023abc21");
  await setV("#rc-dpwd", "dorm1234");
  await ev2(`document.querySelector('.recover__submit').click(); 'ok'`);
  await sleep(1200);

  const step2 = await ev2(`document.querySelector('.recover__card')?.dataset.step`);
  rec("验证身份 → 选择账号", step2 === "2", `step=${step2}`);

  await ev2(`document.querySelector('.recover__submit').click(); 'ok'`);
  await sleep(900);

  await setV("#rc-pwd", "newpass123");
  await setV("#rc-pwd2", "newpass123");
  await ev2(`document.querySelector('.recover__submit').click(); 'ok'`);
  await sleep(1400);

  const rs = await ev2(`(() => {
    ${ABS}
    const q = (s) => document.querySelector(s);
    const card = q('.recover__card');
    const reset = q('.reset');
    const title = q('.reset__title');
    const btn = q('.reset__submit');
    const dog = q('.reset__dog');
    const ba = q('.reset__blob--a');
    const bb = q('.reset__blob--b');
    const cs = (el) => el ? getComputedStyle(el) : {};
    return {
      step: card?.dataset.step,
      resetBg: reset ? cs(reset).backgroundColor : null,
      card: card ? abs(card) : null,
      cardR: cs(card).borderTopLeftRadius,
      title: title ? Object.assign(abs(title), { fs: cs(title).fontSize, fw: cs(title).fontWeight, ta: cs(title).textAlign, t: title.textContent.trim() }) : null,
      btn: btn ? Object.assign(abs(btn), { r: cs(btn).borderTopLeftRadius, bg: cs(btn).backgroundColor, c: cs(btn).color, fs: cs(btn).fontSize, t: btn.textContent.trim() }) : null,
      dog: dog ? abs(dog) : null,
      blobA: ba ? Object.assign(abs(ba), { bg: cs(ba).backgroundColor }) : null,
      blobB: bb ? abs(bb) : null,
      backHidden: q('.recover__back') ? cs(q('.recover__back')).display : 'absent',
      titleHidden: q('.recover__title') ? cs(q('.recover__title')).display : 'absent',
      oldDone: document.querySelectorAll('.recover__done').length,
      oldText: document.querySelectorAll('.recover__donetext').length,
    };
  })()`);

  rec("走到第 4 步", rs.step === "4", `step=${rs.step}`);
  rec("整屏绿底 #bef22f", rs.resetBg === "rgb(190, 242, 47)", rs.resetBg);
  rec("卡片 16/250/343/270、圆角 26",
    rs.card && eq(rs.card.x, 16) && eq(rs.card.y, 250) && eq(rs.card.w, 343) && eq(rs.card.h, 270) && rs.cardR === "26px",
    JSON.stringify(rs.card));
  rec("小狗 95/182/184/174",
    rs.dog && eq(rs.dog.x, 95) && eq(rs.dog.y, 182) && eq(rs.dog.w, 184) && eq(rs.dog.h, 174),
    JSON.stringify(rs.dog));
  rec("光斑 A 200/-140/300/300、色 #a9db23",
    rs.blobA && eq(rs.blobA.x, 200) && eq(rs.blobA.y, -140) && eq(rs.blobA.w, 300) && eq(rs.blobA.h, 300) &&
      rs.blobA.bg === "rgb(169, 219, 35)",
    JSON.stringify(rs.blobA));
  rec("光斑 B -80/620/220/220",
    rs.blobB && eq(rs.blobB.x, -80) && eq(rs.blobB.y, 620) && eq(rs.blobB.w, 220),
    JSON.stringify(rs.blobB));
  // 绝对坐标：卡片 16/250 + 卡内 0/122
  rec("标题「密码已重置」绝对 16/372（卡内 0/122）、343×30、22px/700/居中",
    rs.title && eq(rs.title.x, 16) && eq(rs.title.y, 372) && eq(rs.title.w, 343) && eq(rs.title.h, 30) &&
      rs.title.fs === "22px" && rs.title.fw === "700" && rs.title.ta === "center" && rs.title.t === "密码已重置",
    JSON.stringify(rs.title));
  rec("按钮「去登录」绝对 38/442（卡内 22/192）、299×52、圆角 14、黑底绿字",
    rs.btn && eq(rs.btn.x, 38) && eq(rs.btn.y, 442) && eq(rs.btn.w, 299) && eq(rs.btn.h, 52) &&
      rs.btn.r === "14px" && rs.btn.bg === "rgb(26, 26, 26)" && rs.btn.c === "rgb(190, 242, 47)" && rs.btn.t === "去登录",
    JSON.stringify(rs.btn));
  rec("设计稿没有返回键与页面标题", rs.backHidden === "none" && rs.titleHidden === "none", `${rs.backHidden} / ${rs.titleHidden}`);
  rec("旧的绿勾圆 + 说明文字已移除", rs.oldDone === 0 && rs.oldText === 0, `done=${rs.oldDone} text=${rs.oldText}`);

  await shot("reset-01");

  rec("无 JS 异常", errors.length === 0, errors.join(" | "));

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  ws.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
