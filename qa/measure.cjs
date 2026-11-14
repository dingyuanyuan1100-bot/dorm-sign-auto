// 极简 PNG 解码 + 布局量测：用于验证 React 渲染与设计稿坐标是否一致
const fs = require("fs");
const zlib = require("zlib");

function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let width = 0,
    height = 0,
    bitDepth = 8,
    colorType = 6,
    interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error("unsupported png");
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch) throw new Error("unsupported color type " + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

const hex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

function pixel(img, x, y) {
  const i = (y * img.width + x) * img.ch;
  return hex(img.data[i], img.data[i + 1], img.data[i + 2]);
}

// 在给定行上，找出与背景色不同的连续区间
function runsOnRow(img, y, bg, tol = 8) {
  const runs = [];
  let start = null;
  for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * img.ch;
    const d =
      Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]);
    const diff = d > tol;
    if (diff && start === null) start = x;
    if (!diff && start !== null) {
      if (x - start > 2) runs.push([start, x - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, img.width - 1]);
  return runs;
}

function bounds(img, target, tol = 10) {
  let minX = 1e9,
    minY = 1e9,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * img.ch;
      if (
        Math.abs(img.data[i] - target[0]) <= tol &&
        Math.abs(img.data[i + 1] - target[1]) <= tol &&
        Math.abs(img.data[i + 2] - target[2]) <= tol
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const files = process.argv.slice(2);
for (const f of files) {
  const img = decode(f);
  const S = img.width / 390; // 2x 缩放
  const ink = bounds(img, [26, 26, 26]);
  const lime = bounds(img, [190, 242, 47]);
  console.log(`\n=== ${f}  ${img.width}x${img.height} scale=${S} ===`);
  console.log(`ink  bbox: x ${(ink.minX / S).toFixed(1)}..${((ink.maxX + 1) / S).toFixed(1)}  y ${(ink.minY / S).toFixed(1)}..${((ink.maxY + 1) / S).toFixed(1)}`);
  console.log(`lime bbox: x ${(lime.minX / S).toFixed(1)}..${((lime.maxX + 1) / S).toFixed(1)}  y ${(lime.minY / S).toFixed(1)}..${((lime.maxY + 1) / S).toFixed(1)}`);
  // 顶部白色卡片扫描：找每一行里白色区间的左右边界
  const bg = [245, 245, 247];
  const rows = [140, 200, 300, 350, 420, 500, 600, 700];
  for (const r of rows) {
    const y = Math.round(r * S);
    const runs = runsOnRow(img, y, bg);
    if (runs.length) {
      console.log(
        `  y=${r}: ` + runs.map(([a, b]) => `${(a / S).toFixed(0)}..${((b + 1) / S).toFixed(0)}`).join("  |  "),
      );
    }
  }
}
