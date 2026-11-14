// 反馈详情 / 找回密码返回 / 导航闪屏 验收
//   QA_MODE=recover  node qa/fb_detail.cjs   → 数黑体标题、原生返回逐级回退、导航瞬切
//   QA_MODE=detail   node qa/fb_detail.cjs   → 记录列表 → 反馈详情（对照设计稿 73:394）
//
// 说明：
// 1. 打包产物里 API 直连 https://175.24.230.58，所以登录态必须用「真 token」，
//    之前写 'mock-token' 会被后端判 401 → authed=false → 反馈浮层压根不挂载。
//    token 走预览服务器同源 /api/auth/login（preview 有 proxy），拿到的就是真 token。
// 2. 找回密码第 1 步要校验真实晚寝账号，线上教务时通时不通。
//    这里用 CDP Fetch 只拦 /api/auth/recover/*，返回固定的 ticket + 账号列表，
//    让「第 2 步按返回回第 1 步」这类返回栈断言稳定可跑（被测的是返回栈，不是教务）。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const WEB = Number(process.env.QA_PORT || 5297);
const BASE = `http://127.0.0.1:${WEB}`;
const MODE = process.env.QA_MODE || "detail";
const OUT = path.join(process.cwd(), "qa", "fbx");
const USER = process.env.QA_USER || "qacheck_1793717807";
const PASS = process.env.QA_PASS || "Qa123456";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const results = [];
function rec(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`);
  ok ? pass++ : fail++;
}
const near = (a, b, t = 1.2) => a !== null && a !== undefined && Math.abs(a - b) <= t;

const VERIFY_OK = {
  success: true,
  msg: "ok",
  data: {
    ticket: "qa-ticket-0001",
    accounts: [
      { id: 65, username: "qacheck_1793717807", nickname: "QA 一号", student_id: "2023****01" },
      { id: 66, username: "qacheck_alt", nickname: "QA 二号", student_id: "2023****01" },
    ],
  },
};
const RESET_OK = { success: true, msg: "密码已重置", data: { username: "qacheck_1793717807" } };

// 「已回复 + 2 张截图」样本：这是用户最常看到的终态，
// 但线上还没宿管回复接口，真实账号拿不到，只能给固定样本验收渲染。
const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const REPLIED_REC = {
  id: 901,
  code: "FB-20261028-0901",
  type: "功能异常",
  content: "签到记录日历看不了上个月的记录，切月之后还是本月。",
  image_count: 3,
  status: "replied",
  reply: "已修复：日历支持切月，2.0.15 版本可见，感谢反馈。",
  created_at: "2026-10-28 21:03:00",
  replied_at: "2026-10-28 22:15:00",
  images: [TINY, TINY, TINY],
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "fbx-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
      "--no-proxy-server",
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const q = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result);
    } else if (m.method === "Fetch.requestPaused") {
      onPaused(m.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      waiting.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || "").slice(0, 200));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(s.data, "base64"));
  };

  /** 拦到的请求：预检给 204 + CORS，正式请求给固定 JSON */
  function onPaused(p) {
    const origin = (p.request.headers.Origin || p.request.headers.origin || BASE);
    const cors = [
      { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
      { name: "Access-Control-Allow-Methods", value: "POST,GET,OPTIONS" },
    ];
    if (p.request.method === "OPTIONS") {
      send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" }).catch(() => {});
      return;
    }
    const reset = /recover\/reset/.test(p.request.url);
    // replied 模式：列表/详情给固定样本（线上回复接口还没上线，真实账号没有已回复记录）
    const path = new URL(p.request.url).pathname;
    let payload = reset ? RESET_OK : VERIFY_OK;
    if (MODE === "replied" && (path === "/api/feedback" || /^\/api\/feedback\/\d+$/.test(path))) {
      payload = path === "/api/feedback"
        ? { success: true, msg: "ok", data: { total: 1, pending: 0, items: [REPLIED_REC] } }
        : { success: true, msg: "ok", data: REPLIED_REC };
    }
    const body = Buffer.from(JSON.stringify(payload)).toString("base64");
    send("Fetch.fulfillRequest", {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [...cors, { name: "Content-Type", value: "application/json; charset=utf-8" }],
      body,
    }).catch(() => {});
  }

  const goto = async (hash) => {
    await send("Page.navigate", { url: `${BASE}/?flat=1&r=${hash}#${hash}` });
    for (let i = 0; i < 70; i++) {
      try { if (await ev(`document.readyState === 'complete'`)) break; } catch {}
      await sleep(120);
    }
    await sleep(2200);
  };
  /** 用同源 /api/auth/login 换真 token（preview 带 proxy），再写进 localStorage */
  const login = async () => {
    const tok = await ev(`(async () => {
      try {
        const r = await fetch("/api/auth/login", { method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
        const j = await r.json();
        return (j && j.data && j.data.token) || "";
      } catch (e) { return ""; }
    })()`);
    if (!tok) return "";
    await ev(`localStorage.setItem('dorm.token', ${JSON.stringify(tok)}); 'ok'`);
    return tok;
  };

  /** 关掉自动弹出的「绑定晚寝账号」底部面板：
   *  QA 账号没绑晚寝，boot 后会自动弹，模糊背景挡住被测页面（真机绑过就不会弹）。 */
  const dismissSheets = async () => {
    for (let i = 0; i < 3; i++) {
      const closed = await ev(`(() => {
        const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)');
        if (b) { b.click(); return true; }
        return false;
      })()`);
      if (!closed) break;
      await sleep(500);
    }
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  if (MODE === "recover") {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*recover/*", requestStage: "Request" }] });
  }
  if (MODE === "replied") {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/feedback*", requestStage: "Request" }] });
  }

  /* ================= 找回密码 / 导航 ================= */
  if (MODE === "recover") {
    await send("Page.navigate", { url: `${BASE}/?flat=1` });
    await sleep(1300);
    await ev(`localStorage.removeItem('dorm.token'); 'anon'`);
    await goto("login");
    await ev(`document.querySelector('.login__forgot').click(); 'ok'`);
    await sleep(900);

    const fonts = await ev(`(() => {
      const t = document.querySelector('.recover__title');
      if (!t) return null;
      const cs = getComputedStyle(t);
      return { family: cs.fontFamily, weight: cs.fontWeight, size: cs.fontSize, text: t.textContent.trim() };
    })()`);
    rec("验证身份标题用阿里妈妈数黑体", !!fonts && fonts.family.includes("Alimama ShuHeiTi") && fonts.weight === "700" && fonts.size === "22px",
      fonts ? `${fonts.family.split(",")[0]} ${fonts.size}/${fonts.weight} 「${fonts.text}」` : "无标题");

    // 进到第 2 步
    await ev(`(() => {
      const set = (el, v) => { const p = Object.getOwnPropertyDescriptor(el.constructor.prototype,'value').set; p.call(el, v); el.dispatchEvent(new Event('input',{bubbles:true})); };
      set(document.querySelector('#rc-sid'), '20230001');
      set(document.querySelector('#rc-dpwd'), 'abc12345');
      return 'ok';
    })()`);
    await sleep(300);
    await ev(`document.querySelector('.recover__submit').click(); 'ok'`);
    await sleep(1800);
    const step2 = await ev(`(() => { const r = document.querySelector('.recover'); return { step: r?.getAttribute('data-step'), title: document.querySelector('.recover__title')?.textContent.trim(), accounts: document.querySelectorAll('.recover__acc').length }; })()`);
    await shot("rec-02");

    // 原生返回键：第 2 步 → 第 1 步
    await ev(`window.__dormBack && window.__dormBack(); 'ok'`);
    await sleep(900);
    const afterBack = await ev(`(() => { const r = document.querySelector('.recover'); return { step: r?.getAttribute('data-step'), title: document.querySelector('.recover__title')?.textContent.trim() }; })()`);
    rec("第 2 步按返回键回到第 1 步", step2.step === "2" && afterBack.step === "1",
      `step2=${step2.step}(${step2.title}, 账号 ${step2.accounts}) → back=${afterBack.step}(${afterBack.title})`);

    // 第 1 步再按返回：退回登录页
    await ev(`window.__dormBack && window.__dormBack(); 'ok'`);
    await sleep(900);
    const backToLogin = await ev(`(() => ({ recover: !!document.querySelector('.recover'), loginShown: document.querySelector('.login-layer')?.getAttribute('data-show') }))()`);
    rec("第 1 步按返回键退回登录页", !backToLogin.recover && backToLogin.loginShown === "true",
      JSON.stringify(backToLogin));

    /* --- 反馈浮层里点导航：不应先闪「我的」 --- */
    await send("Page.navigate", { url: `${BASE}/?flat=1` });
    await sleep(1300);
    const tok = await login();
    await goto("me");
    // boot 里要走一次 /api/auth/me，真 token 通常 1~3s 落定，别用固定等待
    let authedNow = null;
    for (let i = 0; i < 15; i++) {
      authedNow = await ev(`(() => ({ authed: document.querySelector('.app')?.getAttribute('data-show'), token: !!localStorage.getItem('dorm.token') }))()`);
      if (authedNow && authedNow.authed === "true") break;
      await sleep(800);
    }
    rec("测试账号登录态就绪", authedNow && authedNow.authed === "true",
      `token=${tok ? "有" : "无"} data-show=${authedNow && authedNow.authed}`);

    await dismissSheets();

    await ev(`(() => { const row=document.querySelector('.listrow[data-key="feedback"]'); const b=row && row.querySelector('.listrow__value'); b && b.click(); return !!b; })()`);
    await sleep(1000);
    const opened = await ev(`!!document.querySelector('.fb')`);
    rec("从「我的」进入意见反馈", opened === true, `fb=${opened}`);

    await ev(`(() => {
      const btn = [...document.querySelectorAll('.nav__item')][0];
      btn.click();
      return 'ok';
    })()`);
    await sleep(70);
    const flash = await ev(`(() => {
      const panes = [...document.querySelectorAll('.pane')];
      const mePane = panes[panes.length - 1];
      const c = getComputedStyle(mePane);
      return { meOpacity: c.opacity, fb: !!document.querySelector('.fb'),
        activeHome: panes[0].getAttribute('data-active') === 'true',
        navActive: [...document.querySelectorAll('.nav__item')].findIndex((b) => b.getAttribute('data-active') === 'true') };
    })()`);
    rec("浮层里点导航不再闪「我的」", Number(flash.meOpacity) < 0.02 && flash.fb === false && flash.activeHome === true && flash.navActive === 0,
      `我的不透明度=${flash.meOpacity} 浮层=${flash.fb} home激活=${flash.activeHome} 导航高亮索引=${flash.navActive}`);
  }

  /* ================= 记录 → 详情 ================= */
  if (MODE === "detail") {
    await send("Page.navigate", { url: `${BASE}/?flat=1` });
    await sleep(1300);
    await login();
    await goto("me");
    for (let i = 0; i < 15; i++) {
      if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
      await sleep(800);
    }
    await dismissSheets();
    await ev(`(() => { const row=document.querySelector('.listrow[data-key="feedback"]'); const b=row && row.querySelector('.listrow__value'); b && b.click(); return !!b; })()`);
    await sleep(900);
    await ev(`document.querySelector('.fb__record').click(); 'ok'`);
    // 记录要现拉接口，偶尔 2.5s 还没回来，轮询等它落地再断言
    for (let i = 0; i < 12; i++) {
      if ((await ev(`document.querySelectorAll('.fb__rec').length`)) > 0) break;
      await sleep(600);
    }
    const list = await ev(`(() => {
      const items = [...document.querySelectorAll('.fb__rec')];
      return { n: items.length, first: items[0] && { code: items[0].querySelector('.fb__rmeta')?.textContent.trim(), title: items[0].querySelector('.fb__rtitle')?.textContent.trim(), h: Math.round(items[0].getBoundingClientRect().height) } };
    })()`);
    rec("记录列表有数据", list && list.n >= 1, `共 ${list && list.n} 条 首条=${list && JSON.stringify(list.first)}`);

    await ev(`document.querySelector('.fb__rec').click(); 'ok'`);
    await sleep(1600);
    await shot("detail");

    const d = await ev(`(() => {
      const root = document.querySelector('.fb');
      const q = (s) => document.querySelector(s);
      const abs = (el) => { if (!el) return null; let x = 0, y = 0, n = el; while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x: Math.round(x*10)/10, y: Math.round(y*10)/10, w: Math.round(el.offsetWidth*10)/10, h: Math.round(el.offsetHeight*10)/10 }; };
      return {
        step: root && root.getAttribute('data-step'),
        title: q('.fbd__title') && q('.fbd__title').textContent.trim(),
        code: q('.fbd__code') && q('.fbd__code').textContent.trim(),
        pill: q('.fbd__pill') && q('.fbd__pill').textContent.trim(),
        meta: abs(q('.fbd__card--meta')),
        body: abs(q('.fbd__card--body')),
        steps: abs(q('.fbd__card--steps')),
        reply: abs(q('.fbd__card--reply')),
        foot: abs(q('.fbd__foot')),
        btn: abs(q('.fbd__btn')),
        more: abs(q('.fbd__more')),
        fbZ: Number(getComputedStyle(root).zIndex) || 0,
        chromeZ: Number(getComputedStyle(q('.chrome') || document.body).zIndex) || 0,
        tag: q('.fbd__tag') && q('.fbd__tag').textContent.trim(),
        ctitle: q('.fbd__ctitle') && q('.fbd__ctitle').textContent.trim(),
        values: [...document.querySelectorAll('.fbd__value')].map(e => e.textContent.trim()),
        stepTexts: [...document.querySelectorAll('.fbd__step')].map(e => e.textContent.trim()),
        clip: (() => { const r = q('.fbd__card--reply'); return r ? r.getBoundingClientRect().bottom <= 844 : false; })(),
        jsErr: window.__jsErr || 0,
      };
    })()`);

    rec("进入反馈详情", d.step === "detail" && d.title === "反馈详情", `step=${d.step} title=${d.title}`);
    rec("详情标题 95/66 200×24、Sarasa 600 17px", await ev(`(() => { const e=document.querySelector('.fbd__title'); const cs=getComputedStyle(e); const el=e; let x=0,y=0,n=el; while(n){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;} return Math.abs(x-95)<1.2 && Math.abs(y-66)<1.2 && el.offsetHeight===24 && cs.fontWeight==='600' && cs.fontSize==='17px' && !cs.fontFamily.includes('Alimama'); })()`), "");
    rec("编号与状态胶囊", /^FB-\d{8}-\d{4}$/.test(d.code || "") && ["待处理", "已回复"].includes(d.pill), `${d.code} / ${d.pill}`);
    rec("提交信息卡 16/150 358×108", near(d.meta && d.meta.x, 16) && near(d.meta.y, 150) && near(d.meta.w, 358) && near(d.meta.h, 108), JSON.stringify(d.meta));
    rec("反馈内容卡 16/272 358×168", near(d.body.x, 16) && near(d.body.y, 272) && near(d.body.w, 358) && near(d.body.h, 168), JSON.stringify(d.body));
    rec("处理进度卡 16/454 358×84", near(d.steps.x, 16) && near(d.steps.y, 454) && near(d.steps.w, 358) && near(d.steps.h, 84), JSON.stringify(d.steps));
    rec("回复卡 16/552 358×132", near(d.reply.x, 16) && near(d.reply.y, 552) && near(d.reply.w, 358) && near(d.reply.h, 132), JSON.stringify(d.reply));
    rec("底部操作 0/700 390×144、按钮 16/716 358×54", near(d.foot.y, 700) && near(d.foot.h, 144) && near(d.btn.x, 16) && near(d.btn.y, 716) && near(d.btn.w, 358) && near(d.btn.h, 54), `${JSON.stringify(d.foot)} btn=${JSON.stringify(d.btn)}`);
    rec("次级操作 16/780 358×16", near(d.more && d.more.x, 16) && near(d.more.y, 780) && near(d.more.w, 358) && near(d.more.h, 16), JSON.stringify(d.more));
    // 设计稿 73:394 没有底部导航，浮层必须压住 chrome（25）的导航条，否则按钮被挡
    rec("详情页底部导航被浮层盖住", d.fbZ > d.chromeZ, `.fb z=${d.fbZ} .chrome z=${d.chromeZ}`);
    // 学号取 session.studentId：未绑定晚寝账号时按设计落「—」，
    // 已绑定应命中 4 位 + **** + 2 位的脱敏格式。两种都算合理。
    const maskedOk = /^\d{4}\*{4}\d{2}$/.test(d.values[1] || "") || d.values[1] === "—";
    rec("提交信息四组值已填充",
      d.values.length === 4 && !!d.values[0] && d.values[0] !== "—" && maskedOk &&
      !!d.values[2] && d.values[2] !== "—" && !!d.values[3] && d.values[3] !== "—",
      d.values.join(" | "));
    rec("处理进度三段文案", d.stepTexts.length === 3 && d.stepTexts[0].startsWith("已入库"), d.stepTexts.join(" / "));
    // 后端只有一个 content 字段：一段话时不能既当标题又当正文贴两遍
    const dup = await ev(`(() => {
      const card = document.querySelector('.fbd__card--body');
      const txt = (card.querySelector('.fbd__ctext')?.textContent || '').trim();
      const all = (card.innerText || '').replace(/\\s+/g, '');
      const t = txt.replace(/\\s+/g, '');
      let n = 0, i = 0;
      while (t && (i = all.indexOf(t, i)) >= 0) { n++; i += t.length; }
      return { hasTitle: !!card.querySelector('.fbd__ctitle'), lead: !!card.querySelector('.fbd__ctext--lead'), text: txt.slice(0, 20), n };
    })()`);
    rec("只有一段话标题/正文不重复", !dup.hasTitle && dup.lead === true && dup.n === 1,
      `有标题=${dup.hasTitle} lead=${dup.lead} 出现次数=${dup.n} 正文=${dup.text}`);
    rec("详情页没有 JS 异常", !d.jsErr, `jsErr=${d.jsErr}`);

    // 返回记录
    await ev(`document.querySelector('.fb__back').click(); 'ok'`);
    await sleep(1000);
    const back = await ev(`document.querySelector('.fb') && document.querySelector('.fb').getAttribute('data-step')`);
    rec("详情返回记录列表", back === "records", `step=${back}`);
  }

  /* ================= 已回复终态（固定样本） ================= */
  if (MODE === "replied") {
    await send("Page.navigate", { url: `${BASE}/?flat=1` });
    await sleep(1300);
    await login();
    await goto("me");
    for (let i = 0; i < 15; i++) {
      if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
      await sleep(800);
    }
    await dismissSheets();
    await ev(`(() => { const row=document.querySelector('.listrow[data-key="feedback"]'); const b=row && row.querySelector('.listrow__value'); b && b.click(); return !!b; })()`);
    await sleep(900);
    await ev(`document.querySelector('.fb__record').click(); 'ok'`);
    for (let i = 0; i < 12; i++) {
      if ((await ev(`document.querySelectorAll('.fb__rec').length`)) > 0) break;
      await sleep(600);
    }

    const pill = await ev(`(() => {
      const r = document.querySelector('.fb__rec');
      const s = r && r.querySelector('.fb__status');
      return { text: s && s.textContent.trim(), bg: s && getComputedStyle(s).backgroundColor, h: r && Math.round(r.getBoundingClientRect().height) };
    })()`);
    rec("列表：已回复胶囊 lime、卡高 156", pill.text === "已回复" && pill.bg === "rgb(190, 242, 47)" && pill.h === 156, JSON.stringify(pill));

    await ev(`document.querySelector('.fb__rec').click(); 'ok'`);
    await sleep(1400);
    await shot("detail-replied");

    const r = await ev(`(() => {
      const q = (s) => document.querySelector(s);
      const nodes = [...document.querySelectorAll('.fbd__node')];
      return {
        step: q('.fb')?.getAttribute('data-step'),
        pill: q('.fbd__pill')?.textContent.trim(),
        pillOn: q('.fbd__pill')?.getAttribute('data-on'),
        nodesOn: nodes.filter((n) => n.getAttribute('data-on') === 'true').length,
        steps: [...document.querySelectorAll('.fbd__step')].map((e) => e.textContent.trim()),
        reply: q('.fbd__replytext')?.textContent.trim(),
        at: q('.fbd__replyat')?.textContent.trim(),
        shots: document.querySelectorAll('.fbd__shot').length,
        note: q('.fbd__shotnote')?.textContent.trim(),
        jsErr: window.__jsErr || 0,
      };
    })()`);
    rec("详情：状态为已回复", r.step === "detail" && r.pill === "已回复" && r.pillOn === "true", `pill=${r.pill} data-on=${r.pillOn}`);
    rec("详情：进度三节点全亮", r.nodesOn === 3 && r.steps.join("|").includes("已回复"), `亮 ${r.nodesOn} 个 / ${r.steps.join(" ")}`);
    rec("详情：官方回复正文与时间", /切月/.test(r.reply || "") && /^回复于 /.test(r.at || ""), `${r.reply} · ${r.at}`);
    // 3 张图必须都出来（以前 slice(0,2) 只渲染两张）
    const sg = await ev(`(() => {
      const sh = [...document.querySelectorAll('.fbd__shot')];
      const note = document.querySelector('.fbd__shotnote');
      const card = document.querySelector('.fbd__card--body');
      const nr = note && note.getBoundingClientRect();
      const last = sh[sh.length - 1] && sh[sh.length - 1].getBoundingClientRect();
      return {
        n: sh.length,
        xs: sh.map((e) => Math.round(e.getBoundingClientRect().left)),
        cardX: card && Math.round(card.getBoundingClientRect().left),
        rel: sh.map((e) => Math.round(e.getBoundingClientRect().left - card.getBoundingClientRect().left)),
        note: note && note.textContent.trim(),
        noteX: nr && Math.round(nr.left),
        overlap: !!(nr && last && nr.left < last.right - 0.5),
      };
    })()`);
    rec("详情：3 张截图全部渲染", r.shots === 3 && sg.n === 3 && sg.rel.join(",") === "18,82,146",
      `shots=${r.shots} 相对卡片=${sg.rel.join(",")}`);
    rec("详情：附件说明不压第三张", sg.note === "点击看原图" && sg.noteX >= sg.cardX + 202 && !sg.overlap,
      `note=${sg.note} 相对卡片 x=${sg.noteX - sg.cardX} 重叠=${sg.overlap}`);

    // 点击缩略图 → 原图浮层
    await ev(`document.querySelector('.fbd__shot').click(); 'ok'`);
    await sleep(600);
    const viewer = await ev(`(() => { const v = document.querySelector('.fbd__viewer'); return { on: !!v, img: !!(v && v.querySelector('img')) }; })()`);
    await ev(`document.querySelector('.fbd__viewer')?.click(); 'ok'`);
    await sleep(500);
    const viewer2 = await ev(`!!document.querySelector('.fbd__viewer')`);
    rec("点击截图打开原图、点一下关闭", viewer.on && viewer.img && viewer2 === false, `打开=${viewer.on} 带图=${viewer.img} 关闭后还在=${viewer2}`);
    rec("已回复页无 JS 异常", !r.jsErr, `jsErr=${r.jsErr}`);
  }

  console.log(results.join("\n"));
  console.log(`\n${pass}/${pass + fail} 通过`);
  ws.close();
  chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(results.join("\n"));
  console.error("FAIL " + e.message);
  process.exit(2);
});
