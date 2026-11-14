// 设计稿连通域测量：按颜色掩膜连通块，输出 bbox
const fs = require("fs");
const zlib = require("zlib");
const Q = "C:/Users/Administrator/WorkBuddy/2026-11-01-20-10-47/qa/";

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

function components(img, match, minArea) {
  const { w, h } = img;
  const seen = new Uint8Array(w * h);
  const res = [];
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (match(img.rgb(x, y))) mask[y * w + x] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    if (!mask[idx] || seen[idx]) continue;
    const stack = [idx]; seen[idx] = 1;
    let ax = x, ay = y, bx = x, by = y, n = 0;
    while (stack.length) {
      const q = stack.pop(); const qy = (q / w) | 0, qx = q - qy * w; n++;
      if (qx < ax) ax = qx; if (qx > bx) bx = qx; if (qy < ay) ay = qy; if (qy > by) by = qy;
      const nb = [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    if (n >= minArea) res.push({ x: ax, y: ay, w: bx - ax + 1, h: by - ay + 1, area: n });
  }
  return res.sort((a, b) => a.y - b.y || a.x - b.x);
}

const file = process.argv[2] || Q + "f-home.png";
const img = decode(file);
const near = (c, r, g, b, tol = 18) => Math.abs(c[0] - r) < tol && Math.abs(c[1] - g) < tol && Math.abs(c[2] - b) < tol;

console.log(`# ${file}  ${img.w}x${img.h}`);
const groups = {
  "LIME  #BEF22F": (c) => near(c, 190, 242, 47, 30),
  "WHITE #FFFFFF": (c) => near(c, 255, 255, 255, 6),
  "INK   #1A1A1A": (c) => near(c, 26, 26, 26, 14),
  "CHIP  #F0F0F3": (c) => near(c, 240, 240, 243, 4),
};
for (const [name, fn] of Object.entries(groups)) {
  const cs = components(img, fn, name.startsWith("INK") ? 400 : 120);
  console.log(`\n-- ${name} (${cs.length}) --`);
  for (const c of cs.slice(0, 24)) console.log(`   x${c.x} y${c.y} w${c.w} h${c.h} area${c.area}`);
}
