// 找回密码 4 步流程截图（390x844 @2x）：登录 → 验证身份 → 选择账号 → 设置新密码 → 完成
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9334;
const WEB = Number(process.env.QA_PORT || 5294);
const BASE = `http://127.0.0.1:${WEB}`;
const W = 390,
  H = 844,
  DPR = 2;
const outDir = path.join(__dirname, "recover");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = async (u) => (await fetch(u)).json();

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dormrc-"));
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

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
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

  fs.mkdirSync(outDir, { recursive: true });
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, name + ".png"), Buffer.from(s.data, "base64"));
    console.log("shot", name);
  };

  await send("Page.navigate", { url: BASE + "/?flat=1" });
  await sleep(4200);
  await ev("localStorage.clear(); 'ok'");
  await shot("00-login");

  // 进入忘记密码
  await click(".login__forgot");
  await sleep(700);
  await shot("01-verify");

  // 先走一次错误分支
  await setVal("#rc-sid", "20230101");
  await setVal("#rc-dpwd", "badpass");
  await sleep(120);
  await click(".recover__submit");
  await sleep(1100);
  await shot("02-verify-error");

  // 正确密码
  await setVal("#rc-dpwd", "dorm123456");
  await sleep(120);
  await click(".recover__submit");
  await sleep(1100);
  await shot("03-accounts");

  // 选第 2 个账号
  await click(".recover__acc:nth-child(2)");
  await sleep(300);
  await shot("04-accounts-picked");

  await click(".recover__submit");
  await sleep(600);
  await shot("05-newpwd-empty");

  // 两次不一致
  await setVal("#rc-pwd", "abc12345");
  await setVal("#rc-pwd2", "abc1234");
  await sleep(150);
  await click(".recover__submit");
  await sleep(500);
  await shot("06-mismatch");

  // 一致后提交
  await setVal("#rc-pwd2", "abc12345");
  await sleep(200);
  await shot("07-newpwd-ok");
  await click(".recover__submit");
  await sleep(1100);
  await shot("08-done");

  await click(".recover__submit");
  await sleep(900);
  await shot("09-back-login");

  const flat = logs.filter((l) => l && !/Download the React DevTools/.test(l));
  if (flat.length) console.log("CONSOLE:\n" + flat.slice(0, 20).join("\n"));

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
