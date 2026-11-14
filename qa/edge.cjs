// 采样图片四条边缘的像素颜色，定位黑边/黑框
// node qa/edge.cjs <png> [step]
const fs = require("fs");
const zlib = require("zlib");

function decode(file) {
  const f = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p);
    const t = f.toString("ascii", p + 4, p + 8);
    const d = f.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
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
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0, c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const file = process.argv[2];
const step = Number(process.argv[3] || 40);
const { w, h, ch, data } = decode(file);
const px = (x, y) => {
  const i = (y * w + x) * ch;
  return "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
};
const near = (c) => c[1] <= 0x22 && c[3] <= 0x22 && c[5] <= 0x22;
console.log(`size ${w}x${h}`);
// 逐列扫左/右边缘，找出暗色列
const darkCols = [];
for (let x = 0; x < Math.min(40, w); x++) {
  let n = 0;
  for (let y = 0; y < h; y += 4) if (near(px(x, y))) n++;
  darkCols.push(`${x}:${n}/${Math.ceil(h / 4)}`);
}
console.log("left cols", darkCols.join(" "));
const darkColsR = [];
for (let x = Math.max(0, w - 40); x < w; x++) {
  let n = 0;
  for (let y = 0; y < h; y += 4) if (near(px(x, y))) n++;
  darkColsR.push(`${x}:${n}/${Math.ceil(h / 4)}`);
}
console.log("right cols", darkColsR.join(" "));
let dark = 0;
for (let y = 0; y < Math.min(40, h); y++) { if (near(px(Math.floor(w / 2), y))) dark++; }
console.log("top center dark rows", dark);
let darkB = 0;
for (let y = Math.max(0, h - 40); y < h; y++) { if (near(px(Math.floor(w / 2), y))) darkB++; }
console.log("bottom center dark rows", darkB);
// 四角采样
for (const [label, x, y] of [["TL", 0, 0], ["TR", w - 1, 0], ["BL", 0, h - 1], ["BR", w - 1, h - 1], ["TL+8", 8, 8], ["BL+8", 8, h - 9]]) {
  console.log(label, px(Math.min(w - 1, x), Math.min(h - 1, y)));
}
// 竖线剖面（x = 2）每 step 行
const prof = [];
for (let y = 0; y < h; y += step) prof.push(`${y}:${px(2, y)}`);
console.log("x=2 profile", prof.join(" "));
