
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9395;
const BASE = "https://175.24.230.58/";
const FAKE_CODE = Number(process.argv[2] || 22);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "relv-"));
  const child = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "--ignore-certificate-errors",
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
  let patched = 0, manifestHits = 0; const urls = [], dbg = [];

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      errs.push((m.params.exceptionDetails.exception?.description || "").slice(0, 160));
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errs.push(m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 160));
    }
    if (m.method !== "Fetch.requestPaused") return;
    const p = m.params, url = p.request.url;
    urls.push(url.replace("https://175.24.230.58", ""));
    try {
      if (url.includes("/update/version.json")) manifestHits++;
      if (url.includes("/assets/index-") && url.endsWith(".js") && FAKE_CODE !== 34) {
        const r = await send("Fetch.getResponseBody", { requestId: p.requestId });
        let body = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
        dbg.push({ len: body.length, b64: r.base64Encoded, hasVer: body.includes('Rr="2.0.10"'), hasCode: body.includes("wu=34"), head: body.slice(0, 60) });
        const before = body;
        body = body.replace('Rr="2.0.10"', FAKE_CODE === 22 ? 'Rr="2.0.9"' : 'Rr="2.0.10-beta11"')
                   .replace("wu=34", "wu=" + FAKE_CODE);
        if (body !== before) patched++;
        await send("Fetch.fulfillRequest", {
          requestId: p.requestId, responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: "application/javascript" },
            { name: "Cache-Control", value: "no-store" },
          ],
          body: Buffer.from(body, "utf8").toString("base64"),
        });
        return;
      }
      await send("Fetch.continueRequest", { requestId: p.requestId });
    } catch (e) {
      dbg.push({ error: String(e).slice(0, 200) });
      try { await send("Fetch.continueRequest", { requestId: p.requestId }); } catch 
    }
  };

  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Response" }] });
  await send("Page.navigate", { url: BASE });
  await sleep(7000);

  const dom = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    return {
      hasUpdateLayer: !!q(".update"),
      title: q(".sheet__title")?.textContent || "",
      oldV: q(".update__v--old")?.textContent || "",
      newV: q(".update__v--new")?.textContent || "",
      size: q(".update__size")?.textContent || "",
      notes: [...document.querySelectorAll(".update__notes li")].map(x => x.textContent.trim()),
      downloadBtn: q(".sheet__btn--primary")?.textContent || "",
      stage: q(".stage")?.className || "",
    };
  })()`);

  const report = {
    fakeCode: FAKE_CODE, patchedJs: patched, manifestRequests: manifestHits,
    ...dom, consoleErrors: errs.slice(0, 6),
    pass: FAKE_CODE === 34 ? (dom.hasUpdateLayer === false && patched === 0)
                           : (patched === 1 && dom.hasUpdateLayer === true && dom.newV === "v2.0.10"),
  };
  console.log(JSON.stringify(report, null, 2));
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  process.exit(report.pass ? 0 : 1);
})().catch((e) => { console.error("VERIFY_FAIL", e); process.exit(2); });
