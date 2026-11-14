// 启动图：青柠底 + 品牌 logo，按密度铺到各 drawable 目录
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const RES = path.resolve("dorm-app/android/app/src/main/res");
const SRC = path.resolve("qa/splash_src.png");

const TARGETS = [
  ["drawable", 480, 320],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
];

// 复用 icons.cjs 的解码/缩放：这里用一个独立的等比裁切实现，保证不变形
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
  const zlib = require("zlib");
  const ch = ct === 6 ? 4 : 3;
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

const TBL = (() => {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  return T;
})();
const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = TBL[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function encodeRGB(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const idat = require("zlib").deflateSync(raw, { level: 9 });
  const chunk = (t, b) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(b.length);
    const tb = Buffer.from(t, "ascii"); const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([tb, b])));
    return Buffer.concat([l, tb, b, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const src = decode(SRC);

for (const [dir, w, h] of TARGETS) {
  const d = path.join(RES, dir);
  if (!fs.existsSync(d)) continue;
  const out = Buffer.alloc(w * h * 3);
  // 等比铺满再居中裁切（solid 底色，边缘无差异）
  const scale = Math.max(w / src.w, h / src.h);
  const sw = src.w * scale, sh = src.h * scale;
  const ox = (sw - w) / 2, oy = (sh - h) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(src.w - 1, Math.max(0, Math.floor((x + ox) / scale)));
    const sy = Math.min(src.h - 1, Math.max(0, Math.floor((y + oy) / scale)));
    const i = (sy * src.w + sx) * src.ch, o = (y * w + x) * 3;
    out[o] = src.data[i]; out[o + 1] = src.data[i + 1]; out[o + 2] = src.data[i + 2];
  }
  fs.writeFileSync(path.join(d, "splash.png"), encodeRGB(w, h, out));
  console.log(dir, `${w}x${h}`);
}
