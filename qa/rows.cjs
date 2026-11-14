// 行剖面：给定 x 范围，列出暗色像素的 y 连续带（文本行位置）
const fs = require("fs");
const zlib = require("zlib");

function decode(file) {
  const f = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 6, plte = null;
  const idat = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p);
    const t = f.toString("ascii", p + 4, p + 8);
    const d = f.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
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
  const rgb = (x, y) => {
    const i = (y * w + x) * ch;
    if (plte) { const k = out[i] * 3; return [plte[k], plte[k + 1], plte[k + 2]]; }
    return [out[i], out[i + 1], out[i + 2]];
  };
  const lum = (x, y) => { const c = rgb(x, y); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  return { w, h, rgb, lum };
}

const file = process.argv[2];
const x0 = +process.argv[3], x1 = +process.argv[4], y0 = +process.argv[5], y1 = +process.argv[6];
const thr = +(process.argv[7] || 150);
const img = decode(file);
const rows = [];
for (let y = y0; y < Math.min(y1, img.h); y++) {
  let n = 0;
  for (let x = x0; x < Math.min(x1, img.w); x++) if (img.lum(x, y) < thr) n++;
  rows.push(n);
}
const bands = [];
let start = -1;
for (let i = 0; i <= rows.length; i++) {
  const on = i < rows.length && rows[i] > 0;
  if (on && start < 0) start = i;
  if (!on && start >= 0) { bands.push([y0 + start, y0 + i - 1]); start = -1; }
}
const scale = img.w > 500 ? 2 : 1;
console.log(`# ${file.split("/").pop()} x${x0}..${x1} thr<${thr}`);
for (const [a, b] of bands) {
  // 该带的水平范围
  let ax = 1e9, bx = -1;
  for (let y = a; y <= b; y++) for (let x = x0; x < x1; x++) if (img.lum(x, y) < thr) { if (x < ax) ax = x; if (x > bx) bx = x; }
  console.log(`  y ${(a / scale).toFixed(1)}..${(b / scale).toFixed(1)}  (h${((b - a + 1) / scale).toFixed(1)})   x ${(ax / scale).toFixed(1)}..${(bx / scale).toFixed(1)}`);
}
