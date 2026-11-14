// 从一个 1024 源图生成 Android 各密度图标（含 adaptive foreground，带 alpha）
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/* ---------- PNG 编解码（支持 RGB/RGBA） ---------- */
function decode(file) {
  const f = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 6, bd = 8;
  const idat = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p);
    const t = f.toString("ascii", p + 4, p + 8);
    const d = f.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error("only 8-bit png");
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!ch) throw new Error("unsupported color type " + ct);
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
  // 统一成 RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    rgba[i * 4] = out[j];
    rgba[i * 4 + 1] = ch >= 3 ? out[j + 1] : out[j];
    rgba[i * 4 + 2] = ch >= 3 ? out[j + 2] : out[j];
    rgba[i * 4 + 3] = ch === 4 ? out[j + 3] : ch === 2 ? out[j + 1] : 255;
  }
  return { w, h, data: rgba };
}

const TBL = (() => {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  return T;
})();
const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = TBL[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function encodeRGBA(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (t, b) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(b.length);
    const tb = Buffer.from(t, "ascii"); const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([tb, b])));
    return Buffer.concat([l, tb, b, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- 缩放（box filter，预乘 alpha 避免黑边） ---------- */
function resize(src, dw, dh) {
  const { w, h, data } = src;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * h) / dh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * w) / dw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * w + xx) * 4;
        const al = data[i + 3] / 255;
        r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += data[i + 3];
        n++;
      }
      const i = (y * dw + x) * 4;
      const aa = a / n;
      const k = aa > 0 ? (a / 255) : 1;
      out[i] = Math.round(r / k);
      out[i + 1] = Math.round(g / k);
      out[i + 2] = Math.round(b / k);
      out[i + 3] = Math.round(aa);
    }
  }
  return { w: dw, h: dh, data: out };
}

/* ---------- 圆角/圆形裁切 ---------- */
function roundMask(img, radiusRatio = 0.5) {
  const { w, h, data } = img;
  const cx = w / 2, cy = h / 2, r = (Math.min(w, h) / 2) * radiusRatio;
  const out = Buffer.from(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const i = (y * w + x) * 4;
    const a = Math.max(0, Math.min(1, r - d + 0.5));
    out[i + 3] = Math.round(data[i + 3] * a);
  }
  return { w, h, data: out };
}

/* ---------- 主流程 ---------- */
const RES = path.resolve(process.argv[2] || "../android/app/src/main/res");
const FULL = path.resolve(process.argv[3] || "icon_full.png");   // 1024 方图，青柠底 + 深色 logo
const FG = path.resolve(process.argv[4] || "icon_fg.png");       // 1024 透明底 + 深色 logo（自适应前景）

const full = decode(FULL);
const fg = decode(FG);
const roundSrc = fs.existsSync(path.resolve("qa/icon_round_src.png"))
  ? decode(path.resolve("qa/icon_round_src.png"))
  : full;

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

let count = 0;
for (const [d, size] of Object.entries(LAUNCHER)) {
  const dir = path.join(RES, `mipmap-${d}`);
  fs.mkdirSync(dir, { recursive: true });
  const sq = resize(full, size, size);
  fs.writeFileSync(path.join(dir, "ic_launcher.png"), encodeRGBA(size, size, sq.data));
  const rd = roundMask(resize(roundSrc, size, size));
  fs.writeFileSync(path.join(dir, "ic_launcher_round.png"), encodeRGBA(size, size, rd.data));
  count += 2;

  const fsz = FOREGROUND[d];
  const fimg = resize(fg, fsz, fsz);
  fs.writeFileSync(path.join(dir, "ic_launcher_foreground.png"), encodeRGBA(fsz, fsz, fimg.data));
  count += 1;
}

// 自适应图标背景色
const vals = path.join(RES, "values");
fs.mkdirSync(vals, { recursive: true });
fs.writeFileSync(
  path.join(vals, "ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#BEF22F</color>
</resources>
`,
);

console.log(`icons written: ${count} png -> ${RES}`);
