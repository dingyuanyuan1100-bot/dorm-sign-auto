// 找回密码交互反馈量化验收：
// 按压 / 聚焦 / 报错抖动 / 加载态 / 步骤转场 / 勾选回弹 / 强度条 / 成功脉冲 / Enter 提交 / 触感 / 降级
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9336;
const WEB = Number(process.env.QA_PORT || 5294);
const BASE = `http://127.0.0.1:${WEB}`;
const W = 390,
  H = 844,
  DPR = 2;
const outDir = path.join(__dirname, "recover");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();
const R = [];
const rec = (name, ok, detail) => {
  R.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`);
};

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormfb-"));
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
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      logs.push("EXC " + (msg.params.exceptionDetails?.text || ""));
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: true,
  });

  // 注入：记录 vibrate 调用 + 给 fetch 加 450ms 延迟（让加载态可观测）
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__hz = [];
      try {
        Object.defineProperty(navigator, "vibrate", {
          configurable: true,
          value: function (p) { window.__hz.push(p); return true; },
        });
      } catch (e) {}
      (function () {
        const _f = window.fetch;
        window.fetch = function () {
          const args = arguments, self = this;
          return new Promise(function (r) { setTimeout(r, 450); }).then(function () {
            return _f.apply(self, args);
          });
        };
      })();
    `,
  });

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.text || "") + " :: " + expr);
    return r.result.value;
  };

  const setVal = (sel, v) =>
    ev(
      `(function(){const el=document.querySelector(${JSON.stringify(sel)});` +
        `if(!el)return "__NOEL__";` +
        `const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;` +
        `s.call(el,${JSON.stringify(v)});` +
        `el.dispatchEvent(new Event('input',{bubbles:true}));return el.value;})()`,
    );

  const click = async (sel) => {
    const r = await ev(
      `(function(){const el=document.querySelector(${JSON.stringify(sel)});` +
        `if(!el)return "__NOEL__";el.click();return "ok";})()`,
    );
    if (r === "__NOEL__") throw new Error("找不到元素 " + sel);
    return r;
  };

  const center = (sel) =>
    ev(
      `(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;` +
        `const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );

  const press = async (sel, ms = 90) => {
    const p = await center(sel);
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: p.x,
      y: p.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(ms);
    const mid = await ev(
      `(function(){const el=document.querySelector(${JSON.stringify(sel)});` +
        `return getComputedStyle(el).transform;})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: p.x,
      y: p.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(40);
    return mid;
  };

  const styleOf = (sel, prop, pseudo) =>
    ev(
      `(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;` +
        `return getComputedStyle(el${pseudo ? `,${JSON.stringify(pseudo)}` : ""})[${JSON.stringify(prop)}];})()`,
    );

  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, name + ".png"), Buffer.from(s.data, "base64"));
  };

  // ---------- 进入流程 ----------
  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(4600);
  await ev("localStorage.clear(); 'ok'");
  // 入口按钮按压 → 松手即进入流程（顺带验证转场）
  const forgotTransform = await press(".login__forgot", 230);
  const forgotScale = (() => {
    const m = /matrix\(([\d.]+)/.exec(forgotTransform || "");
    return m ? Number(m[1]) : null;
  })();
  rec(
    "忘记密码入口按压反馈",
    forgotScale !== null && forgotScale > 0.93 && forgotScale < 0.99,
    `:active scale = ${forgotScale}`,
  );
  await sleep(600);
  const pageIn = await styleOf(".recover", "animationName");
  rec("进入找回流程有整屏转场", pageIn === "recoverPageIn", `animationName=${pageIn}`);
  await shot("fb-01-verify");

  // 1) 聚焦反馈
  const shadowIdle = await ev(
    `getComputedStyle(document.querySelector('#rc-sid').closest('.recover__field')).boxShadow`,
  );
  await ev(`document.querySelector('#rc-sid').focus(); 'ok'`);
  await sleep(320);
  const shadowFocus = await styleOf("#rc-sid", "boxShadow");
  const fieldFocus = await ev(
    `getComputedStyle(document.querySelector('#rc-sid').closest('.recover__field')).boxShadow`,
  );
  rec(
    "聚焦有描边反馈",
    /inset/.test(fieldFocus || "") && /rgb\(26, 26, 26\)/.test(fieldFocus || "") && fieldFocus !== shadowIdle,
    `field box-shadow = ${fieldFocus}`,
  );

  // 2) 按钮按压（等过渡走完再取稳态值）
  const pressTransform = await press(".recover__submit", 260);
  const pressScale = (() => {
    const m = /matrix\(([\d.]+)/.exec(pressTransform || "");
    return m ? Number(m[1]) : null;
  })();
  rec(
    "按钮按压缩放",
    pressScale !== null && pressScale > 0.96 && pressScale < 0.98,
    `:active scale = ${pressScale}（规范 0.968–0.978，实测 ${pressTransform}）`,
  );

  // 3) 学号校验失败 → 抖动 + 红边 + hint 入场
  await ev(`document.querySelector('#rc-sid').blur(); 'ok'`);
  await ev(
    `(function(){window.__shake=[];const el=document.querySelector('.recover__card');
      const t0=performance.now();let n=0;
      function tick(){const r=el.getBoundingClientRect();
        window.__shake.push([Math.round(performance.now()-t0), +r.left.toFixed(2)]);
        if(++n<30)requestAnimationFrame(tick);}
      requestAnimationFrame(tick);return 'go';})()`,
  );
  await click(".recover__submit");
  await sleep(120); // 抖动 420ms，150ms 内读 animationName 还在播
  const shakeCardAnim = await styleOf(".recover__card", "animationName");
  await sleep(400);
  const fieldErr = await ev(
    `(function(){const f=document.querySelector('.recover__field');return {err:f?.dataset.err,
      shadow:getComputedStyle(f).boxShadow};})()`,
  );
  const hintAnim = await styleOf(".recover__hint", "animationName");
  const shakeSeries = await ev("window.__shake");
  const lefts = (shakeSeries || []).map((s) => s[1]);
  const span = lefts.length ? Math.max(...lefts) - Math.min(...lefts) : 0;
  rec("错误时卡片抖动", shakeCardAnim === "shake", `animationName=${shakeCardAnim}`);
  rec("抖动真实位移", span >= 8, `位移幅度 ${span.toFixed(2)}px`);
  rec(
    "错误字段标红",
    fieldErr?.err === "true" && /rgb\(229, 72, 77\)/.test(fieldErr?.shadow || ""),
    `data-err=${fieldErr?.err} boxShadow=${fieldErr?.shadow}`,
  );
  rec("错误提示入场动画", hintAnim === "recoverHintIn", `animationName=${hintAnim}`);
  await shot("fb-02-error");

  // 4) 加载态：文案保留 + spinner + aria-busy + 禁用
  await setVal("#rc-sid", "20230101");
  await setVal("#rc-dpwd", "dorm123456");
  await sleep(150);
  const errCleared = await ev(
    `(function(){const f=document.querySelector('.recover__field');return {err:f?.dataset.err,
      hint:!!document.querySelector('.recover__hint')};})()`,
  );
  rec(
    "输入即清错误态",
    !errCleared?.hint && errCleared?.err === "false",
    `hint=${errCleared?.hint} data-err=${errCleared?.err}`,
  );
  await click(".recover__submit");
  await sleep(150);
  const busy = await ev(
    `(function(){const b=document.querySelector('.recover__submit');
      return {text:b.innerText.trim(), busy:b.dataset.busy, aria:b.getAttribute('aria-busy'),
        disabled:b.disabled, spinner:!!b.querySelector('.spinner'),
        flex:getComputedStyle(b).display};})()`,
  );
  rec(
    "加载中保留文案 + 转圈",
    /验证中/.test(busy.text) && busy.spinner && busy.aria === "true" && busy.disabled,
    `text="${busy.text}" aria-busy=${busy.aria} disabled=${busy.disabled} display=${busy.flex}`,
  );
  await shot("fb-03-loading");
  await sleep(700);

  // 5) 步骤转场方向
  const stepAnim = await ev(
    `(function(){const b=document.querySelector('.recover__body');
      return {name:getComputedStyle(b).animationName, dir:b.dataset.dir,
        dur:getComputedStyle(b).animationDuration};})()`,
  );
  const bodyAt0 = await ev(
    `(function(){const b=document.querySelector('.recover__body');
      const m=new DOMMatrixReadOnly(getComputedStyle(b).transform);return +m.m41.toFixed(2);})()`,
  );
  rec(
    "前进转场（从右入场）",
    stepAnim?.name === "recoverStepIn" && stepAnim?.dir === "1",
    `animation=${stepAnim?.name} dir=${stepAnim?.dir} dur=${stepAnim?.dur}`,
  );
  await shot("fb-04-accounts");

  // 6) 账号选中：勾选回弹 + 触感
  await click(".recover__acc:nth-child(2)");
  await sleep(120);
  const tickAnim = await styleOf(
    '.recover__acc[data-on="true"] .recover__acc-tick svg',
    "animationName",
  );
  const onCount = await ev(`document.querySelectorAll('.recover__acc[data-on="true"]').length`);
  rec("勾选回弹", tickAnim === "recoverTickPop", `animationName=${tickAnim}`);
  rec("单选互斥（仅 1 个选中）", onCount === 1, `data-on 数量 ${onCount}`);
  await shot("fb-05-picked");

  // 7) 后退方向
  await ev(`window.__hapticLenBefore = window.__hz.length; 'ok'`);
  await click(".recover__back");
  await sleep(120);
  const backAnim = await ev(
    `(function(){const b=document.querySelector('.recover__body');
      return {name:getComputedStyle(b).animationName, dir:b.dataset.dir};})()`,
  );
  rec(
    "后退转场（从左入场）",
    backAnim?.name === "recoverStepBack" && backAnim?.dir === "-1",
    `animation=${backAnim?.name} dir=${backAnim?.dir}`,
  );
  await click(".recover__submit"); // 回第 2 步
  await sleep(600);
  await click(".recover__submit"); // 进第 3 步
  await sleep(700);
  await shot("fb-06-newpwd");
  const btnIdleBg = await styleOf(".recover__submit", "backgroundColor");

  // 8) 强度条 + 规则
  await setVal("#rc-pwd", "abc12345");
  await sleep(260);
  const meter = await ev(
    `(function(){const on=document.querySelectorAll('.recover__meter i[data-on="true"]').length;
      const anims=[...document.querySelectorAll('.recover__meter i[data-on="true"]')]
        .map(i=>getComputedStyle(i).animationName);
      const rules=[...document.querySelectorAll('.recover__rules li')].map(l=>l.dataset.ok);
      const ready=document.querySelector('.recover__submit').dataset.ready;
      return {on, anims, rules, ready};})()`,
  );
  rec(
    "强度条分段点亮 + 填充动效",
    meter.on === 3 && meter.anims.every((a) => a === "recoverMeterFill"),
    `点亮 ${meter.on}/3 animation=${[...new Set(meter.anims)].join(",")}`,
  );
  rec("规则逐条转绿", meter.rules.every((r) => r === "true"), `rules=${meter.rules.join(",")}`);
  rec("规则全满足后按钮回到实色", meter.ready === "true", `data-ready=${meter.ready}`);
  const btnReadyBg = await styleOf(".recover__submit", "backgroundColor");
  rec(
    "未就绪按钮只降一档底色、不发灰",
    btnIdleBg === "rgb(217, 244, 140)" && btnReadyBg === "rgb(190, 242, 47)",
    `未就绪 ${btnIdleBg} → 就绪 ${btnReadyBg}`,
  );
  await shot("fb-07-strength");

  // 9) Enter 提交（确认密码框回车）
  await setVal("#rc-pwd2", "abc12345");
  await sleep(120);
  await ev(`document.querySelector('#rc-pwd2').focus(); 'ok'`);
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await sleep(900);

  // 10) 成功页脉冲
  const done = await ev(
    `(function(){const d=document.querySelector('.recover__done');
      if(!d)return null;const a=getComputedStyle(d,'::after');
      return {pop:getComputedStyle(d).animationName, ring:a.animationName,
        tick:getComputedStyle(d.querySelector('svg')).animationName,
        title:document.querySelector('.recover__donetitle')?.textContent};})()`,
  );
  rec(
    "成功勾选回弹 + 光环",
    done?.pop === "recoverDonePop" && done?.ring === "recoverDoneRing",
    `done=${done?.pop} ring=${done?.ring} tick=${done?.tick}`,
  );
  await shot("fb-08-done");

  // 11) 触感调用序列
  const hz = await ev("window.__hz");
  const flatHz = JSON.stringify(hz);
  rec(
    "触感反馈（错误 / 步进 / 成功）",
    flatHz.includes("[24,46,24]") && flatHz.includes("[9,26,9]") && flatHz.includes("[12,40,22]"),
    `序列=${flatHz}`,
  );
  rec("选中单个账号有轻触感", flatHz.includes("8"), `序列=${flatHz}`);

  // 12) 降级
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sleep(200);
  const reduced = await ev(
    `(function(){const d=document.querySelector('.recover__done');
      return {pop:getComputedStyle(d).animationName,
        ring:getComputedStyle(d,'::after').animationName,
        transit:getComputedStyle(document.querySelector('.recover__submit')).transitionDuration};})()`,
  );
  rec(
    "prefers-reduced-motion 全降级",
    reduced?.pop === "none" && reduced?.ring === "none",
    `pop=${reduced?.pop} ring=${reduced?.ring} transition=${reduced?.transit}`,
  );

  const flat = logs.filter((l) => l && !/Download the React DevTools/.test(l));
  if (flat.length) console.log("CONSOLE:\n" + flat.slice(0, 20).join("\n"));

  const passed = R.filter((r) => r.ok).length;
  console.log(`\n===== ${passed}/${R.length} PASS =====`);
  fs.writeFileSync(path.join(__dirname, "recover", "feedback_report.json"), JSON.stringify(R, null, 2));
  if (flat.length) console.log("存在控制台输出，见上。");

  ws.close();
  chrome.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* noop */
  }
  if (passed !== R.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
