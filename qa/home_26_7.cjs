// 首页 26:7（02 总览）1:1 验收 —— 签到记录日历版
//   node qa/home_26_7.cjs [端口]
//
// 数据用固定样本（CDP Fetch 拦截 /api/*）：线上 QA 账号没绑晚寝、没有任务，
// 只能看到空状态，量不到主卡时间/位置/日历日格。样本里的接口形状与后端一致。
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9540 + Math.floor(Math.random() * 40);
const WEB = Number(process.argv[2] || process.env.QA_PORT || 5297);
const BASE = `http://127.0.0.1:${WEB}`;
const OUT = path.join(process.cwd(), "qa", "fbx");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const results = [];
const rec = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   [" + detail + "]" : ""}`);
  ok ? pass++ : fail++;
};
const near = (a, b, t = 1.2) => a !== null && a !== undefined && Math.abs(a - b) <= t;

/* ---------- 固定样本 ---------- */
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth(), TODAY = now.getDate();
const pad2 = (n) => String(n).padStart(2, "0");
const iso = (day, h, mi, s) => `${Y}-${pad2(M + 1)}-${pad2(day)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
const LOC = { id: 2, name: "3 号公寓 · 502", lat: "31.67381", lng: "118.555756", address: "3 号公寓 · 502", is_default: true };
const TASK_A = { id: 37, sign_time: "23:30", mode: "daily", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: true, status: "waiting" };
const TASK_B = { id: 38, sign_time: "22:10", mode: "once", sign_date: null, remark: "", location_id: 2, location: LOC, enabled: false, status: "waiting" };
// 本月已签 3 天（1 / 2 / 4 号），另有一条失败日志不该被算成已签
const OK_DAYS = TODAY >= 5 ? [1, 2, 4] : [1];
const LOGS = [
  ...OK_DAYS.map((d, i) => ({ id: 900 + i, schedule_id: 37, run_at: iso(d, 23, 30, 2), success: true, detail: "scheduled", msg: "auto · 签到成功" })),
  { id: 890, schedule_id: 37, run_at: iso(OK_DAYS[OK_DAYS.length - 1], 22, 0, 12), success: false, detail: "manual", msg: "未到签到时间！" },
];
const ROUTES = {
  "GET /api/auth/me": { success: true, msg: "ok", data: { id: 65, username: "qacheck_1793717807", has_dorm_account: true, student_id: "20230001" } },
  "GET /api/dorm-account": { success: true, msg: "ok", data: { student_id: "20230001", nickname: "QA 一号" } },
  "GET /api/locations": { success: true, msg: "ok", data: [LOC] },
  "GET /api/schedules": { success: true, msg: "ok", data: [TASK_A, TASK_B] },
  "GET /api/logs": { success: true, msg: "ok", data: LOGS },
  "POST /api/auth/logout": { success: true, msg: "ok", data: null },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "h67-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", "--no-proxy-server",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()) break; } catch {}
    await sleep(200);
  }
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Fetch.requestPaused") {
      const p = m.params;
      const url = new URL(p.request.url);
      const key = `${p.request.method} ${url.pathname}`;
      const origin = p.request.headers.Origin || p.request.headers.origin || BASE;
      const cors = [
        { name: "Access-Control-Allow-Origin", value: origin },
        { name: "Access-Control-Allow-Credentials", value: "true" },
        { name: "Access-Control-Allow-Headers", value: "authorization,content-type" },
        { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" },
      ];
      if (p.request.method === "OPTIONS") {
        send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 204, responseHeaders: cors, body: "" }).catch(() => {});
        return;
      }
      const body = ROUTES[key];
      const isNotice = url.pathname.startsWith("/update/");
      if (isNotice) {
        // 26:7 画的是「没有公告」的首页；公告会整体下推内容，量尺寸时先关掉
        send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 404, responseHeaders: cors, body: "{}" }).catch(() => {});
        return;
      }
      if (body) {
        send("Fetch.fulfillRequest", {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [...cors, { name: "Content-Type", value: "application/json; charset=utf-8" }],
          body: Buffer.from(JSON.stringify(body)).toString("base64"),
        }).catch(() => {});
      } else {
        // 没准备的接口给空成功，避免 404 把 boot 打挂
        send("Fetch.fulfillRequest", {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [...cors, { name: "Content-Type", value: "application/json; charset=utf-8" }],
          body: Buffer.from(JSON.stringify({ success: true, msg: "ok", data: null })).toString("base64"),
        }).catch(() => {});
      }
      return;
    }
    if (m.id && wait.has(m.id)) {
      const q = wait.get(m.id);
      wait.delete(m.id);
      m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result);
    }
  };
  function send(method, params = {}) {
    return new Promise((res, rej) => {
      const mid = ++id;
      wait.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || "").slice(0, 200));
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }, { urlPattern: "*://*/update/*", requestStage: "Request" }] });

  await send("Page.navigate", { url: `${BASE}/?flat=1` });
  await sleep(1200);
  await ev(`localStorage.setItem('dorm.token','qa-token'); localStorage.removeItem('dorm.notice.seen'); 'ok'`);
  await send("Page.navigate", { url: `${BASE}/?flat=1&r=home#home` });
  await sleep(2200);
  for (let i = 0; i < 15; i++) {
    if ((await ev(`document.querySelector('.app')?.getAttribute('data-show')`)) === "true") break;
    await sleep(800);
  }
  await sleep(700);
  // 关掉可能弹出的绑定面板
  for (let i = 0; i < 3; i++) {
    const closed = await ev(`(() => { const b = document.querySelector('.sheet__actions .sheet__btn:not(.sheet__btn--primary)'); if (b) { b.click(); return true; } return false; })()`);
    if (!closed) break;
    await sleep(400);
  }

  const h = await ev(`(() => {
    const abs = (el) => { if (!el) return null; let x = 0, y = 0, n = el; while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { x: +x.toFixed(1), y: +y.toFixed(1), w: +el.offsetWidth.toFixed(1), h: +el.offsetHeight.toFixed(1) }; };
    const q = (s) => document.querySelector(s);
    const cs = (s, p) => { const e = q(s); return e ? getComputedStyle(e)[p] : null; };
    const card = q('.signcal');
    const c = card && card.getBoundingClientRect();
    const rel = (el) => { if (!el || !c) return null; const r = el.getBoundingClientRect(); return { x: +(r.left - c.left).toFixed(1), y: +(r.top - c.top).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    const days = [...document.querySelectorAll('.signcal__day')];
    return {
      hero: abs(q('.hero')),
      heroRadius: cs('.hero', 'borderTopLeftRadius'),
      heroBg: cs('.hero', 'backgroundColor'),
      label: abs(q('.hero__label')),
      labelText: q('.hero__label')?.textContent.trim(),
      time: q('.hero__time') ? Object.assign(abs(q('.hero__time')), { t: q('.hero__time').textContent.trim(), c: cs('.hero__time', 'color'), f: cs('.hero__time', 'fontSize') }) : null,
      pill: q('.hero__pill') ? Object.assign(abs(q('.hero__pill')), { r: cs('.hero__pill', 'borderTopLeftRadius'), t: q('.hero__pill').textContent.trim() }) : null,
      place: q('.hero__place') ? Object.assign(abs(q('.hero__place')), { t: q('.hero__place').textContent.trim() }) : null,
      cta: q('.hero__cta') ? Object.assign(abs(q('.hero__cta')), { r: cs('.hero__cta', 'borderTopLeftRadius'), t: q('.hero__cta').textContent.trim() }) : null,
      statA: abs(q('.stat--a')),
      statB: abs(q('.stat--b')),
      statAR: cs('.stat--a', 'borderTopLeftRadius'),
      sectionTitle: q('.section-title') ? Object.assign(abs(q('.section-title')), { t: q('.section-title').textContent.trim(), f: cs('.section-title', 'fontSize') }) : null,
      allBtn: q('.section-link') ? Object.assign(abs(q('.section-link')), { t: q('.section-link').textContent.trim() }) : null,
      cardBox: abs(card),
      cardRadius: cs('.signcal', 'borderTopLeftRadius'),
      month: card && Object.assign(rel(q('.signcal__month')), { t: q('.signcal__month').textContent.trim(), f: getComputedStyle(q('.signcal__month')).fontSize }),
      grid: rel(q('.signcal__grid')),
      cell0: rel(days[0]),
      cell1: rel(days[1]),
      gapX: days[1] ? +(days[1].getBoundingClientRect().left - days[0].getBoundingClientRect().right).toFixed(1) : null,
      cells: days.length,
      ok: days.filter((d) => d.dataset.ok === 'true').length,
      miss: days.filter((d) => d.dataset.miss === 'true').length,
      okBg: (() => { const d = days.find((x) => x.dataset.ok === 'true'); return d ? getComputedStyle(d).backgroundColor : null; })(),
      missBg: (() => { const d = days.find((x) => x.dataset.miss === 'true'); return d ? getComputedStyle(d).backgroundColor : null; })(),
      grayBg: (() => { const d = days.find((x) => x.dataset.ok !== 'true' && x.dataset.miss !== 'true'); return d ? getComputedStyle(d).backgroundColor : null; })(),
      stats: rel(q('.signcal__stats')),
      statText: q('.signcal__stats')?.textContent.replace(/\\s+/g, ''),
      art: rel(q('.signcal__art')),
      jsErr: window.__jsErr || 0,
    };
  })()`);

  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, "home-26-7.png"), Buffer.from(shot.data, "base64"));

  rec("主卡 20/136 350×196、圆角 26、纯黑", near(h.hero?.x, 20) && near(h.hero.y, 136) && near(h.hero.w, 350) && near(h.hero.h, 196) && h.heroRadius === "26px" && h.heroBg === "rgb(26, 26, 26)",
    `${JSON.stringify(h.hero)} ${h.heroRadius} ${h.heroBg}`);
  rec("「今晚签到」42/158", near(h.label?.x, 42) && near(h.label.y, 158) && h.labelText === "今晚签到", `${JSON.stringify(h.label)} ${h.labelText}`);
  rec("时间 40/176、lime、23:30", near(h.time?.x, 40) && near(h.time.y, 176) && h.time.t === "23:30" && h.time.c === "rgb(190, 242, 47)",
    `${JSON.stringify(h.time)}`);
  rec("状态胶囊 280/160 68×26、圆角 13", near(h.pill?.x, 280) && near(h.pill.y, 160) && near(h.pill.w, 68) && near(h.pill.h, 26) && h.pill.r === "13px",
    JSON.stringify(h.pill));
  rec("位置 42/240 显示默认位置名", near(h.place?.x, 42) && near(h.place.y, 240) && h.place.t === LOC.name, JSON.stringify(h.place));
  rec("立即签到 212/272 136×42、圆角 14", near(h.cta?.x, 212) && near(h.cta.y, 272) && near(h.cta.w, 136) && near(h.cta.h, 42) && h.cta.r === "14px",
    JSON.stringify(h.cta));
  rec("指标卡 20/348 与 199/348、171×88", near(h.statA?.x, 20) && near(h.statA.y, 348) && near(h.statA.w, 171) && near(h.statA.h, 88) &&
    near(h.statB?.x, 199) && near(h.statB.y, 348), `${JSON.stringify(h.statA)} ${JSON.stringify(h.statB)}`);
  rec("分区标题 25/463、15px、「签到记录」", near(h.sectionTitle?.x, 24.97, 1.4) && near(h.sectionTitle.y, 463.3, 1.4) && h.sectionTitle.f === "15px" && h.sectionTitle.t === "签到记录",
    `${JSON.stringify(h.sectionTitle)} ${h.sectionTitle?.t}`);
  rec("「全部 ›」270/464", near(h.allBtn?.x, 270) && near(h.allBtn.y, 464), JSON.stringify(h.allBtn));
  rec("日历卡 18/494 350×209、圆角 20", near(h.cardBox?.x, 18) && near(h.cardBox.y, 494) && near(h.cardBox.w, 350) && near(h.cardBox.h, 209) && h.cardRadius === "20px",
    `${JSON.stringify(h.cardBox)} ${h.cardRadius}`);
  rec("月份 18/14 76×28、20px", near(h.month?.x, 18) && near(h.month.y, 14) && near(h.month.w, 76) && near(h.month.h, 28) && h.month.f === "20px",
    `${JSON.stringify(h.month)} ${h.month?.t}`);
  rec("日格网 30/61 起、首格 20×20、列距 7", near(h.grid?.x, 30) && near(h.grid.y, 61) && near(h.cell0?.x, 30) && near(h.cell0.w, 20) && near(h.cell0.h, 20) && near(h.gapX, 7),
    `grid=${JSON.stringify(h.grid)} cell0=${JSON.stringify(h.cell0)} gapX=${h.gapX}`);
  rec("日格数量等于本月天数", h.cells === new Date(Y, M + 1, 0).getDate(), `cells=${h.cells} 应为 ${new Date(Y, M + 1, 0).getDate()}`);

  // 日历必须由 logs 推导：已签天数 == 本月成功日志去重天数；漏签 == 今天之前没签的天数
  const okSet = new Set(LOGS.filter((l) => l.success).map((l) => Number(l.run_at.slice(8, 10))));
  const expectOk = [...okSet].filter((d) => d >= 1).length;
  const expectMiss = Math.max(0, TODAY - 1 - expectOk);
  rec("已签天数与成功日志一致", h.ok === expectOk, `日格已签 ${h.ok} / 日志成功去重 ${expectOk}`);
  rec("漏签天数 = 今天之前未签", h.miss === expectMiss, `日格漏签 ${h.miss} / 期望 ${expectMiss}`);
  rec("三态配色 已签 80% lime、漏签 #e5484d、未到 #f0f0f3",
    h.okBg === "rgba(190, 242, 47, 0.8)" && h.missBg === "rgb(229, 72, 77)" && h.grayBg === "rgb(240, 240, 243)",
    `${h.okBg} / ${h.missBg} / ${h.grayBg}`);
  rec("统计行 18/146 文案「累计签到 N 次」", near(h.stats?.y, 146) && /^累计签到\d+次$/.test(h.statText || ""), `${JSON.stringify(h.stats)} ${h.statText}`);
  rec("铅笔装饰 270/138 64×64", near(h.art?.x, 270) && near(h.art.y, 138) && near(h.art.w, 64) && near(h.art.h, 64), JSON.stringify(h.art));
  rec("首页无 JS 异常", !h.jsErr, `jsErr=${h.jsErr}`);

  // 「全部 ›」应该跳到日志页
  await ev(`(() => { const b=document.querySelector('.section-link') || document.querySelector('.signcal'); b && b.click(); return 'ok'; })()`);
  await sleep(900);
  const jumped = await ev(`(() => { const panes=[...document.querySelectorAll('.pane')]; return panes.findIndex((p) => p.getAttribute('data-active') === 'true'); })()`);
  rec("点日历卡进入日志页", jumped === 3, `activePane=${jumped}（0 home / 1 tasks / 2 locations / 3 logs / 4 me）`);

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
