// 用无头 Chrome 把设计稿 logo 渲染成 1024 方图（青柠底 / 透明底各一张）
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9347;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 设计稿 logo 路径（来自 Icons.jsx LogoMark，viewBox 107x128）
const LOGO =
  "M15.5626 90.0426L14.4934 88.9364C2.1728 75.9639 -2.8166 57.9131 1.5619 40.0634C6.5512 19.4986 24.2176 3.6601 45.3968 0.593C78.4894 -4.234 107 21.0573 107 52.8348C107 68.9246 96.8686 87.3274 83.7843 97.7858C82.1042 99.1434 79.6095 98.8417 78.184 97.2327L65.9652 83.7072C64.0814 81.6959 64.5396 78.4277 66.9834 77.0701C73.8056 73.1482 79.1513 66.8128 80.8823 59.1701C85.3625 39.2086 67.9507 21.7109 47.7897 25.7334C37.1491 27.8452 28.4941 36.2421 26.1522 46.7005C24.1157 55.9522 26.7631 65.1536 33.0762 71.6901L36.5382 75.26L36.4364 75.3606L68.7653 109.501C70.3945 111.211 70.2927 113.976 68.5617 115.585L56.4447 126.798C54.6119 128.457 51.7608 128.407 50.0807 126.597L15.6135 90.1934L15.5626 90.0426Z";

const html = (bg, logoRatio, W = 1024, H = 1024, dark = "#1A1A1A") => `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${W}px;height:${H}px;background:${bg};}
  .wrap{width:${W}px;height:${H}px;display:grid;place-items:center;}
  svg{display:block;}
</style></head><body><div class="wrap">
<svg width="${Math.round((H * logoRatio * 107) / 128)}" height="${Math.round(H * logoRatio)}" viewBox="0 0 107 128" fill="none">
<path fill="${dark}" d="${LOGO}"/></svg>
</div></body></html>`;

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "icon-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/json/version`); up = true; } catch { await sleep(200); }
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 1024, deviceScaleFactor: 1, mobile: false });
  // 透明背景（前景图用）
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

  const shoot = async (body, out) => {
    await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(body) });
    await sleep(700);
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(r.data, "base64"));
    console.log("wrote", out);
  };

  // 1) 方形图标：青柠底 + logo 占 58%
  await shoot(html("#BEF22F", 0.58), "qa/icon_full.png");
  // 2) 自适应前景：透明底 + logo 占 52%（留安全区）
  await shoot(html("transparent", 0.52), "qa/icon_fg.png");
  // 3) 圆形图标的方形源：logo 缩到 46% 免得贴边
  await shoot(html("#BEF22F", 0.46), "qa/icon_round_src.png");

  // 4) 启动图源：1280x1920 青柠底 + logo 占 16%
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1920, deviceScaleFactor: 1, mobile: false });
  await shoot(html("#BEF22F", 0.16, 1280, 1920), "qa/splash_src.png");

  ws.close();
  chrome.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
