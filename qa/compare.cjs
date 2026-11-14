// 设计稿 vs 实现 逐元素测距：设计稿 390x844(1x)，实现 780x1688(2x)
const fs = require("fs");
const zlib = require("zlib");

const PAL = "C:/Users/Administrator/WorkBuddy/2026-11-01-20-10-47/qa/";
const APP = "C:/Users/Administrator/WorkBuddy/2026-11-01-20-10-47/qa/app/";

function decode(file) {
  const f = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 6, bd = 8, plte = null;
  const idat = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p);
    const t = f.toString("ascii", p + 4, p + 8);
    const d = f.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (t === "PLTE") plte = d;
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  const lum = (x, y) => {
    const i = (y * w + x) * ch;
    if (plte) { const k = out[i] * 3; return 0.299 * plte[k] + 0.587 * plte[k + 1] + 0.114 * plte[k + 2]; }
    return 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
  };
  const rgb = (x, y) => {
    const i = (y * w + x) * ch;
    if (plte) { const k = out[i] * 3; return [plte[k], plte[k + 1], plte[k + 2]]; }
    return [out[i], out[i + 1], out[i + 2]];
  };
  return { w, h, lum, rgb };
}

// 在矩形内按亮度区间找边界
function bbox(img, t0, t1, x0, y0, x1, y1) {
  let ax = 1e9, ay = 1e9, bx = -1, by = -1;
  x1 = Math.min(x1, img.w); y1 = Math.min(y1, img.h);
  for (let y = Math.max(0, y0); y < y1; y++)
    for (let x = Math.max(0, x0); x < x1; x++) {
      const L = img.lum(x, y);
      if (L >= t0 && L <= t1) {
        if (x < ax) ax = x; if (x > bx) bx = x;
        if (y < ay) ay = y; if (y > by) by = y;
      }
    }
  return bx < 0 ? null : [ax, ay, bx + 1, by + 1];
}

// 区域定义：name, 亮度区间, 设计稿搜索框（1x）
const REGIONS = {
  home: [
    ["问候文字", 20, 140, 20, 78, 300, 132],
    ["Hero 卡", 0, 90, 0, 120, 390, 345],
    ["23:30 数字", 170, 235, 20, 150, 400, 235],
    ["立即签到按钮", 170, 235, 20, 258, 220, 330],
    ["统计卡1(白)", 248, 255, 0, 340, 190, 445],
    ["统计卡2(白)", 248, 255, 190, 340, 390, 445],
    ["启用任务文字", 20, 200, 30, 355, 170, 378],
    ["2/3 数字", 20, 120, 30, 378, 170, 425],
    ["签到任务标题", 20, 120, 10, 448, 200, 490],
    ["全部›", 100, 200, 250, 450, 390, 490],
    ["任务行1(白)", 248, 255, 0, 486, 390, 592],
    ["任务行1时间", 20, 120, 30, 500, 110, 545],
    ["每天胶囊", 225, 245, 100, 505, 200, 545],
    ["已签到胶囊", 170, 235, 200, 500, 380, 545],
    ["任务行1位置", 120, 200, 30, 540, 240, 570],
    ["任务行2(白)", 248, 255, 0, 588, 390, 690],
    ["底部导航", 0, 90, 0, 730, 390, 844],
  ],
};

const pairs = process.argv.slice(2);
const screens = pairs.length ? pairs : ["home"];

for (const s of screens) {
  const dFile = PAL + `f-${s}.png`;
  const aFile = APP + `${s}.png`;
  if (!fs.existsSync(dFile) || !fs.existsSync(aFile)) { console.log(`跳过 ${s}`); continue; }
  const D = decode(dFile), A = decode(aFile);
  const regions = REGIONS[s] || [];
  console.log(`\n===== ${s}  设计 ${D.w}x${D.h} / 实现 ${A.w}x${A.h} =====`);
  console.log("元素".padEnd(16), "设计(x,y,w,h)".padEnd(24), "实现(x,y,w,h)".padEnd(24), "Δx Δy Δw Δh");
  for (const [name, t0, t1, x0, y0, x1, y1] of regions) {
    const d = bbox(D, t0, t1, x0, y0, x1, y1);
    const a = bbox(A, t0, t1, x0 * 2, y0 * 2, x1 * 2, y1 * 2);
    const fmt = (b) => (b ? `${b[0]} ${b[1]} ${b[2] - b[0]} ${b[3] - b[1]}` : "—");
    let delta = "—";
    if (d && a) {
      const da = [a[0] / 2, a[1] / 2, a[2] / 2, a[3] / 2];
      delta = [da[0] - d[0], da[1] - d[1], (da[2] - da[0]) - (d[2] - d[0]), (da[3] - da[1]) - (d[3] - d[1])]
        .map((v) => (v >= 0 ? "+" : "") + v.toFixed(1)).join(" ");
    }
    console.log(name.padEnd(14), fmt(d).padEnd(24), fmt(a ? a.map((v) => Math.round(v * 10) / 10) : null).padEnd(24), delta);
  }
}
