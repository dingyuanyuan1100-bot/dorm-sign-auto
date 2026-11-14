// 通用 PNG 解码/编码/裁剪（支持 RGB / RGBA / 调色板灰度）
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

const TBL = (() => {
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  return T;
})();
const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = TBL[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function encodeRGB(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (t, b) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(b.length);
    const tb = Buffer.from(t, "ascii"); const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([tb, b])));
    return Buffer.concat([l, tb, b, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// 裁剪并放大（scale 为整数倍，最近邻）
function crop(img, x0, y0, w, h, scale = 1) {
  const W = w * scale, H = h * scale;
  const o = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = img.rgb(x0 + ((x / scale) | 0), y0 + ((y / scale) | 0));
    const d = (y * W + x) * 3;
    o[d] = c[0]; o[d + 1] = c[1]; o[d + 2] = c[2];
  }
  return encodeRGB(W, H, o);
}

module.exports = { decode, encodeRGB, crop };

if (require.main === module) {
  const [, , src, out, x0, y0, w, h, s] = process.argv;
  const img = decode(src);
  fs.writeFileSync(out, crop(img, +x0, +y0, +w, +h, +(s || 2)));
  console.log(`crop ${w}x${h} @${s}x -> ${out}`);
}
