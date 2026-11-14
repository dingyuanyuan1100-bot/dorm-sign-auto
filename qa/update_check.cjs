/* 更新检测验收：静态站点 + 假清单（服务端 2.0.3 / 本地 2.0.2）
   用法: node qa/update_check.cjs [端口] */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9381;
const WEB = `http://127.0.0.1:${process.argv[2] || 5299}/`;
const OUT = path.join(__dirname, "update");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "upd-"));
  spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 180));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errs.push(m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 180));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
  };
  const sheetState = async () => JSON.parse(await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({
      open: !!s,
      title: s?.querySelector(".sheet__title")?.innerText || "",
      vers: [...(s?.querySelectorAll(".update__v") || [])].map(v => v.innerText),
      notes: [...(s?.querySelectorAll(".update__notes li") || [])].map(l => l.innerText.trim()),
      btns: [...(s?.querySelectorAll(".sheet__btn") || [])].map(b => b.innerText.trim()),
    });
  })()`));

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  await send("Page.navigate", { url: WEB });
  await sleep(5200); // 闪屏 1.15s + 启动检测延迟 1.6s

  const first = await sheetState();
  console.log("AUTO_PROMPT", JSON.stringify(first));
  await shot("01-auto-update-390x844.png");

  // 「稍后再说」→ 写入节流并关闭
  await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    [...s.querySelectorAll(".sheet__btn")].find(b => b.innerText.trim() === "稍后再说")?.click();
    return 1;
  })()`);
  await sleep(700);
  const snooze = await evalJs(`localStorage.getItem("dorm.update.snoozed")`);
  console.log("AFTER_LATER", JSON.stringify({ open: (await sheetState()).open, snooze }));

  // 重载：同版本 12 小时内不应再弹
  await send("Page.reload");
  await sleep(5200);
  console.log("AFTER_RELOAD", JSON.stringify(await sheetState()));

  // 手动检查：我的 → 关于 → 检查更新
  await evalJs(`(() => {
    const b = [...document.querySelectorAll(".nav__item")].find(x => x.getAttribute("aria-label") === "我的");
    b?.click(); return 1;
  })()`);
  await sleep(900);
  await evalJs(`(() => {
    const row = [...document.querySelectorAll("*")].find(e => e.children.length === 0 && e.innerText.trim() === "关于");
    (row?.closest("button") || row?.parentElement)?.click(); return 1;
  })()`);
  await sleep(900);
  const about = JSON.parse(await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    return JSON.stringify({ open: !!s, title: s?.querySelector(".sheet__title")?.innerText || "",
      rows: [...(s?.querySelectorAll(".detail__row") || [])].map(r => r.innerText.replace(/\\s+/g," ")) });
  })()`));
  console.log("ABOUT_SHEET", JSON.stringify(about));
  await shot("02-about-390x844.png");

  await evalJs(`(() => {
    const s = [...document.querySelectorAll(".sheet")].pop();
    [...s.querySelectorAll(".sheet__btn")].find(b => b.innerText.trim().startsWith("检查更新"))?.click();
    return 1;
  })()`);
  await sleep(2200);
  console.log("AFTER_MANUAL_CHECK", JSON.stringify(await sheetState()));
  await shot("03-manual-update-390x844.png");

  console.log("TAB", await evalJs(`document.body.innerText.replace(/\\s+/g," ").slice(0, 120)`));
  console.log("ERRORS", errs.length ? errs.slice(0, 5).join(" / ") : "none");
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
