// 区域色块 bbox：node qa/bbox.cjs <png> <x0> <x1> <y0> <y1> <hex> [tol]
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
  return { w, h, rgb };
}

const file = process.argv[2];
const x0 = +process.argv[3], x1 = +process.argv[4], y0 = +process.argv[5], y1 = +process.argv[6];
const hex = (process.argv[7] || "#1A1A1A").replace("#", "");
const tol = +(process.argv[8] || 24);
const tgt = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const img = decode(file);
let ax = 1e9, bx = -1, ay = 1e9, by = -1;
for (let y = y0; y < Math.min(y1, img.h); y++) {
  for (let x = x0; x < Math.min(x1, img.w); x++) {
    const c = img.rgb(x, y);
    if (Math.abs(c[0] - tgt[0]) <= tol && Math.abs(c[1] - tgt[1]) <= tol && Math.abs(c[2] - tgt[2]) <= tol) {
      if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y;
    }
  }
}
const s = img.w > 500 ? 2 : 1;
if (bx < 0) console.log(`${file.split("/").pop()} 无匹配`);
else console.log(`${file.split("/").pop()} #${hex}  y ${(ay / s).toFixed(1)}..${(by / s).toFixed(1)}  x ${(ax / s).toFixed(1)}..${(bx / s).toFixed(1)}  h${((by - ay + 1) / s).toFixed(1)} w${((bx - ax + 1) / s).toFixed(1)}`);
