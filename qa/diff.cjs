// 设计稿 vs 实现 逐像素对比
// 输出：qa/cmp/<name>-pair.png（设计 | 实现 | 差分热图）与量化指标
const fs = require("fs");
const path = require("path");
const { decode, encodeRGB } = require("./img.cjs");

const RES = [375 * 1.04, 812 * 1.04]; // 390 x 844.48

function sample(img, sx, sy) {
  // 双线性采样，输入为归一化坐标（0..1）
  const W = img.w - 1, H = img.h - 1;
  const x = Math.min(W, Math.max(0, sx * W));
  const y = Math.min(H, Math.max(0, sy * H));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(W, x0 + 1), y1 = Math.min(H, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const p00 = img.rgb(x0, y0), p10 = img.rgb(x1, y0);
  const p01 = img.rgb(x0, y1), p11 = img.rgb(x1, y1);
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = p00[c] * (1 - fx) + p10[c] * fx;
    const b = p01[c] * (1 - fx) + p11[c] * fx;
    out[c] = a * (1 - fy) + b * fy;
  }
  return out;
}

function toRes(img, W, H) {
  const o = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = sample(img, x / (W - 1), y / (H - 1));
      const d = (y * W + x) * 3;
      o[d] = c[0]; o[d + 1] = c[1]; o[d + 2] = c[2];
    }
  }
  return o;
}

const W = Math.round(RES[0]), H = Math.round(RES[1]);

function load(file) {
  const img = decode(file);
  if (img.w === W && img.h === H) {
    const o = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = img.rgb(x, y), d = (y * W + x) * 3;
      o[d] = c[0]; o[d + 1] = c[1]; o[d + 2] = c[2];
    }
    return o;
  }
  return toRes(img, W, H);
}

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["login", "home", "tasks", "locations", "logs", "me"];

fs.mkdirSync("qa/cmp", { recursive: true });
const rows = [];

for (const name of names) {
  const dFile = `qa/now/${name}.png`;
  const aFile = `qa/app/${name}.png`;
  if (!fs.existsSync(dFile) || !fs.existsSync(aFile)) { console.log("skip", name); continue; }
  const D = load(dFile), A = load(aFile);

  // 差分（忽略 1px 内的抗锯齿差异，用 3x3 最小距离）
  const heat = Buffer.alloc(W * H * 3);
  const bad = [];
  let sum = 0, n = 0, over12 = 0;
  const rowBad = new Map();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const ar = A[i], ag = A[i + 1], ab = A[i + 2];
      // 邻域最小色差（容忍 1px 位移）
      let best = 1e9;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = (yy * W + xx) * 3;
        const e = Math.abs(D[j] - ar) + Math.abs(D[j + 1] - ag) + Math.abs(D[j + 2] - ab);
        if (e < best) best = e;
      }
      const e = best;
      sum += e; n++;
      const v = Math.min(255, e * 3);
      // 热图：黑底 + 红
      heat[i] = v; heat[i + 1] = Math.max(0, v - 120) >> 1; heat[i + 2] = 0;
      if (e > 90) {
        over12++;
        const b = Math.floor(y / 4) * 4;
        rowBad.set(b, (rowBad.get(b) || 0) + 1);
        if (bad.length < 40) bad.push([x, y, e]);
      }
    }
  }

  const pct = (over12 / n) * 100;
  const mae = sum / n / 3;
  const top = [...rowBad.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([y, c]) => `y${y}(${c})`).join(" ");

  // 三联图：设计 | 实现 | 热图
  const PW = W * 3 + 16;
  const pair = Buffer.alloc(PW * H * 3, 24);
  const put = (y, x, c) => { const d = (y * PW + x) * 3; pair[d] = c[0]; pair[d + 1] = c[1]; pair[d + 2] = c[2]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    put(y, x, [D[i], D[i + 1], D[i + 2]]);
    put(y, x + W + 8, [A[i], A[i + 1], A[i + 2]]);
    put(y, x + (W + 8) * 2, [heat[i], heat[i + 1], heat[i + 2]]);
  }
  fs.writeFileSync(`qa/cmp/${name}-pair.png`, encodeRGB(PW, H, pair));

  rows.push({ name, pct, mae, top });
}

console.log("screen      差异>90 占比   MAE   热点行");
for (const r of rows) {
  console.log(`${r.name.padEnd(11)} ${r.pct.toFixed(2).padStart(7)}%  ${r.mae.toFixed(1).padStart(5)}  ${r.top}`);
}
