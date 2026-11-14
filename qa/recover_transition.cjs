// 验收本轮三个修复：
// 1) 登录 → 找回流程：登录内容有退场过渡（不再是硬切）
// 2) 页面不再「出现后突然淡出再出现」——无关 re-render 不得重播步骤入场
// 3) 两处说明文案已删除，且卡片/按钮位置随之收敛
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9338;
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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormtr-"));
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
  // 让「进入流程」的采样有足够帧：打开 Animation domain 不需要，直接 rAF 采样

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

  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(4600);
  await ev("localStorage.clear(); 'ok'");

  // ---------- 1) 登录内容退场 ----------
  const fgBefore = await styleOf(".login__fg", "opacity");
  const fgVisibleBefore = await styleOf(".login__fg", "visibility");

  // 在页面内用 rAF 逐帧采样，避免测量本身被 CDP 往返延迟污染
  await ev(`(function(){
    window.__tr = {frames: [], t0: performance.now()};
    const fg = document.querySelector('.login__fg');
    function tick(){
      const now = performance.now() - window.__tr.t0;
      window.__tr.frames.push([
        Math.round(now),
        +getComputedStyle(fg).opacity,
        +new DOMMatrixReadOnly(getComputedStyle(fg).transform).a.toFixed(4),
      ]);
      if (now < 420) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return 'go';
  })()`);

  await click(".login__forgot");
  await sleep(520);
  const tr = await ev("window.__tr.frames");
  const mid = (tr || []).filter((f) => f[0] >= 40 && f[0] <= 180);
  const lastFrame = (tr || [])[tr.length - 1] || [0, 1, 1];
  const hasIntermediate = mid.some((f) => f[1] > 0.03 && f[1] < 0.97);
  rec(
    "登录内容有退场过渡（非硬切）",
    fgVisibleBefore === "visible" && Number(fgBefore) === 1 && hasIntermediate,
    `起始 opacity=${fgBefore}/${fgVisibleBefore}；过渡帧 ${JSON.stringify(mid.map((f) => [f[0], f[1]]))}`,
  );
  rec(
    "退场结束后登录内容彻底隐藏且不可点",
    Number(lastFrame[1]) === 0 && Number(lastFrame[2]) < 1,
    `末帧 t=${lastFrame[0]}ms opacity=${lastFrame[1]} scale=${lastFrame[2]}`,
  );
  const fgEnd = await ev(
    `(function(){const fg=document.querySelector('.login__fg');const cs=getComputedStyle(fg);
      const card=document.querySelector('.login__card').getBoundingClientRect();
      const hit=document.elementFromPoint(card.x+40, card.y+40);
      return {vis:cs.visibility, pe:cs.pointerEvents, hiddenBy: hit?.className||hit?.tagName};})()`,
  );
  rec(
    "隐藏后 visibility:hidden 且 pointer-events:none",
    fgEnd?.vis === "hidden" && fgEnd?.pe === "none",
    `visibility=${fgEnd?.vis} pointer-events=${fgEnd?.pe} 该点命中=${fgEnd?.hiddenBy}`,
  );
  const pageInOpacity = await styleOf(".recover", "opacity");
  rec(
    "找回流程已完全入场",
    Number(pageInOpacity) === 1,
    `recover opacity=${pageInOpacity}`,
  );

  // ---------- 3) 文案删除 ----------
  const copyGone = await ev(
    `(function(){return {
      tip: !!document.querySelector('.recover__tip'),
      hintline: !!document.querySelector('.recover__hintline'),
      labels: [...document.querySelectorAll('.recover__label')].map(e=>e.textContent.trim()),
      btn: document.querySelector('.recover__submit')?.innerText.trim(),
      cardH: +document.querySelector('.recover__card').getBoundingClientRect().height.toFixed(1),
      fieldBottom: +document.querySelectorAll('.recover__field')[1].getBoundingClientRect().bottom.toFixed(1),
      btnTop: +document.querySelector('.recover__submit').getBoundingClientRect().top.toFixed(1),
    };})()`,
  );
  rec(
    "第 1 步说明文案已删除",
    copyGone.tip === false,
    `.recover__tip 存在=${copyGone.tip}，字段底 ${copyGone.fieldBottom} → 按钮顶 ${copyGone.btnTop}（间距 ${(copyGone.btnTop - copyGone.fieldBottom).toFixed(1)}）`,
  );
  await shot("tr-01-verify");

  // ---------- 2) 无关 re-render 不得重播入场 ----------
  const beforeType = await ev(
    `(function(){const b=document.querySelector('.recover__body');
      return {anim:getComputedStyle(b).animationName, first:b.dataset.first,
        op:+getComputedStyle(b).opacity};})()`,
  );
  await ev(`(function(){
      window.__mon2 = {min: 1};
      const b = document.querySelector('.recover__body');
      let n = 0;
      function t(){ window.__mon2.min = Math.min(window.__mon2.min, +getComputedStyle(b).opacity);
        if (++n < 24) requestAnimationFrame(t); }
      requestAnimationFrame(t); return 'go';})()`);
  await setVal("#rc-sid", "2"); // 触发一次 React re-render
  await sleep(500);
  const afterType = await ev(
    `(function(){const b=document.querySelector('.recover__body');
      return {anim:getComputedStyle(b).animationName, first:b.dataset.first,
        op:+getComputedStyle(b).opacity, min:window.__mon2.min};})()`,
  );
  rec(
    "输入触发的 re-render 不重播步骤入场",
    afterType?.anim === "none" && afterType?.min === 1,
    `改前 anim=${beforeType?.anim} → 改后 anim=${afterType?.anim}，最低透明度=${afterType?.min}`,
  );

  // 真实复现：等后台自动检查更新（boot +12s）再改一次 state，看画面会不会闪
  await ev(`(function(){
      window.__mon3 = {min: 1, samples: 0};
      window.__mon3t = setInterval(function(){
        const b = document.querySelector('.recover__body');
        if (!b) return;
        window.__mon3.min = Math.min(window.__mon3.min, +getComputedStyle(b).opacity);
        window.__mon3.samples++;
      }, 40);
      return 'go';})()`);
  await sleep(9000);
  const mon3 = await ev(
    `(function(){clearInterval(window.__mon3t);
      const b=document.querySelector('.recover__body');
      return {min: window.__mon3.min, samples: window.__mon3.samples,
        anim:getComputedStyle(b).animationName, op:+getComputedStyle(b).opacity};})()`,
  );
  rec(
    "静置 9s（跨过自动检查更新）画面不闪",
    mon3?.min === 1,
    `采样 ${mon3?.samples} 次，最低透明度=${mon3?.min}，animation=${mon3?.anim}`,
  );

  // ---------- 第 2 步：文案删除 + 排版 ----------
  await setVal("#rc-sid", "20230101");
  await setVal("#rc-dpwd", "dorm123456");
  await sleep(120);
  await click(".recover__submit");
  await sleep(1200);
  const step2 = await ev(
    `(function(){return {
      hintline: !!document.querySelector('.recover__hintline'),
      step: document.querySelector('.recover__steptext')?.textContent.trim(),
      accs: document.querySelectorAll('.recover__acc').length,
      stepBottom: +document.querySelector('.recover__steptext').getBoundingClientRect().bottom.toFixed(1),
      accTop: +document.querySelector('.recover__acc').getBoundingClientRect().top.toFixed(1),
      cardH: +document.querySelector('.recover__card').getBoundingClientRect().height.toFixed(1),
    };})()`,
  );
  rec(
    "第 2 步说明文案已删除",
    step2.hintline === false,
    `步骤文字底 ${step2.stepBottom} → 首张账号卡顶 ${step2.accTop}（间距 ${(step2.accTop - step2.stepBottom).toFixed(1)}），账号 ${step2.accs} 个`,
  );
  await shot("tr-02-accounts");

  // ---------- 退回登录：找回流程也要有退场 ----------
  await click(".recover__back");
  await sleep(600);
  await ev(`(function(){
      window.__out = {frames: []};
      const el = document.querySelector('.recover');
      if (!el) { window.__out.frames.push([0,-1,-1]); return 'no'; }
      const t0 = performance.now();
      function tick(){
        const n = document.querySelector('.recover');
        const now = Math.round(performance.now() - t0);
        window.__out.frames.push([
          now,
          n ? +getComputedStyle(n).opacity : -1,
          n ? getComputedStyle(n).animationName : "gone",
        ]);
        if (now < 400) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick); return 'go';})()`);
  await click(".recover__back");
  await sleep(520);
  const out = await ev("window.__out.frames");
  const outMid = (out || []).filter((f) => f[0] >= 30 && f[0] <= 160);
  const gone = (out || []).some((f) => f[2] === "gone");
  rec(
    "退回登录同样有退场（不硬切）",
    outMid.some((f) => f[1] > 0.03 && f[1] < 0.97) && gone,
    `过渡帧 ${JSON.stringify(outMid.map((f) => [f[0], f[1], f[2]]))}，卸载=${gone}`,
  );
  await sleep(400);
  const backHome = await ev(
    `(function(){const fg=document.querySelector('.login__fg');
      return {op:+getComputedStyle(fg).opacity, vis:getComputedStyle(fg).visibility,
        recover: !!document.querySelector('.recover')};})()`,
  );
  rec(
    "回到登录页后登录内容恢复",
    backHome?.op === 1 && backHome?.vis === "visible" && backHome?.recover === false,
    `opacity=${backHome?.op} visibility=${backHome?.vis} recover 残留=${backHome?.recover}`,
  );
  await shot("tr-03-back-login");

  const flat = logs.filter((l) => l && !/Download the React DevTools/.test(l));
  if (flat.length) console.log("CONSOLE:\n" + flat.slice(0, 20).join("\n"));

  const passed = R.filter((r) => r.ok).length;
  console.log(`\n===== ${passed}/${R.length} PASS =====`);
  fs.writeFileSync(
    path.join(__dirname, "recover", "transition_report.json"),
    JSON.stringify(R, null, 2),
  );

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
