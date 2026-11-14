/* 线上验收：https://175.24.230.58 的 React 页面
   用法: node qa/live_shot.cjs [token] [宽x高] */
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9377;
const BASE = "https://175.24.230.58/";
const SIZE = (process.argv[3] || "390x844").split("x").map(Number);
const TOKEN = process.argv[2] || "";
const DESKTOP = process.argv[4] === "desktop";
const OUT = path.join(__dirname, "live");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
  spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });

  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 0; const pend = new Map();
  const logs = [], fails = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      logs.push(m.params.args.map((a) => a.value || a.description || a.type).join(" ").slice(0, 220));
    }
    if (m.method === "Runtime.exceptionThrown") {
      logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 220));
    }
    if (m.method === "Network.responseReceived") {
      const r = m.params.response;
      if (r.status >= 400) fails.push(`${r.status} ${r.url.slice(0, 120)}`);
    }
    if (m.method === "Network.loadingFailed") {
      fails.push(`FAILED ${m.params.errorText} ${(m.params.type || "")}`);
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
  const shot = async (name, opts = {}) => {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, ...opts });
    const p = path.join(OUT, name);
    fs.writeFileSync(p, Buffer.from(r.data, "base64"));
    return p;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: SIZE[0], height: SIZE[1], deviceScaleFactor: 2, mobile: true,
  });
  if (!DESKTOP) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  if (TOKEN) {
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try{localStorage.setItem("dorm.token","${TOKEN}")}catch(e){}`,
    });
  }

  await send("Page.navigate", { url: BASE });
  await sleep(4200);
  const first = await shot(`00-entry-${SIZE[0]}x${SIZE[1]}.png`);

  const probe = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const txt = document.body.innerText.replace(/\\s+/g, " ").trim();
    return JSON.stringify({
      title: document.title,
      origin: location.origin,
      boot: !!q("#boot-splash"),
      stage: !!q(".stage"),
      deviceFrame: !!q(".device"),
      nav: !!q(".nav"),
      login: !!q(".login"),
      heading: (q("h1")?.innerText || "").slice(0, 40),
      text: txt.slice(0, 180),
      token: (localStorage.getItem("dorm.token") || "").slice(-6),
      apiBase: (window.__dorm_api_base__ || ""),
      size: [innerWidth, innerHeight],
    });
  })()`);

  // 若已登录，逐页截一张；未登录则模拟登录后再截
  let steps = [];
  const routeTo = async (label) => {
    const hit = await evalJs(`(() => {
      const b = [...document.querySelectorAll(".nav__item")].find(x => x.getAttribute("aria-label") === "${label}");
      if (!b) return 0; b.click(); return 1;
    })()`);
    await sleep(1200);
    return hit;
  };
  return { ws, send, evalJs, shot, probe, first, routeTo, steps, logs, fails, sleep, SIZE, OUT };
})()
  .then(async (ctx) => {
    const { send, evalJs, shot, routeTo, sleep, SIZE, logs, fails } = ctx;
    console.log("PROBE", ctx.probe);

    const authed = await evalJs(`!!document.querySelector(".nav")`);
    const shots = [ctx.first];
    const visited = [];

    if (authed) {
      for (const [label, name] of [["任务", "tasks"], ["我的", "me"], ["总览", "home"]]) {
        await routeTo(label);
        shots.push(await shot(`01-${name}-${SIZE[0]}x${SIZE[1]}.png`));
        visited.push(name + " -> " + (await evalJs(`document.body.innerText.slice(0,60).replace(/\\s+/g," ")`)));
      }
    } else {
      // 未登录：走登录接口拿 token 后重载
      const login = await evalJs(`(async () => {
        try {
          const r = await fetch("/api/auth/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }),
          });
          const j = await r.json();
          return JSON.stringify({ status: r.status, ok: !!j?.data?.token });
        } catch (e) { return "ERR " + e.message }
      })()`);
      console.log("LOGIN", login);
      if (login && login.includes('"ok":true')) {
        await evalJs(`(async () => {
          const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "qacheck_1793717807", password: "Qa123456" }) });
          const j = await r.json();
          localStorage.setItem("dorm.token", j.data.token);
          return "set";
        })()`);
        await send("Page.reload");
        await sleep(3800);
        shots.push(await shot(`02-home-${SIZE[0]}x${SIZE[1]}.png`));
        // 未绑定会自动弹绑定层：验收时先关掉，才能看到页面本身
        const closed = await evalJs(`(() => {
          const b = [...document.querySelectorAll("button")].find(x => (x.innerText || "").trim() === "取消");
          if (!b) return 0; b.click(); return 1;
        })()`);
        console.log("AUTO_BIND_SHEET_CLOSED", closed);
        await sleep(600);
        for (const [label, name] of [["任务", "tasks"], ["我的", "me"], ["总览", "home"]]) {
          await routeTo(label);
          shots.push(await shot(`03-${name}-${SIZE[0]}x${SIZE[1]}.png`));
          visited.push(name + " -> " + (await evalJs(`document.body.innerText.slice(0,60).replace(/\\s+/g," ")`)));
        }
      }
    }

    const ratio = await evalJs(`(() => {
      const el = document.querySelector(".seg") || document.querySelector(".nav");
      const r = el?.getBoundingClientRect();
      const st = document.querySelector(".stage");
      const m = st ? getComputedStyle(st).transform : "none";
      return JSON.stringify({ el: el?.className, rect: r ? [Math.round(r.width), Math.round(r.height)] : null,
        ratio: r ? +(r.width / r.height).toFixed(3) : null, transform: m });
    })()`);

    console.log("RATIO", ratio);
    console.log("VISITED", visited.join(" | "));
    console.log("SHOTS", shots.join("\n"));
    console.log("CONSOLE_ERRORS", logs.length ? logs.slice(0, 8).join(" / ") : "none");
    console.log("HTTP_FAILS", fails.length ? [...new Set(fails)].slice(0, 8).join(" / ") : "none");
    ctx.ws.close();
    process.exit(0);
  })
  .catch((e) => { console.error("ERR", e.message); process.exit(1); });
