// 把六张 780x1688 的实现截图拼成一张总览图（3 列 x 2 行，2x 降采样到 390x844）
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

function decode(file) {
  const f = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (p < f.length) {
    const len = f.readUInt32BE(p);
    const t = f.toString("ascii", p + 4, p + 8);
    const d = f.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      ct = d[9];
    } else if (t === "IDAT") idat.push(d);
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
  return { w, h, ch, data: out };
}

function encode(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const T = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c;
  }
  const crc = (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (t, b) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(b.length);
    const tb = Buffer.from(t, "ascii");
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([tb, b])));
    return Buffer.concat([l, tb, b, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ih),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const NAMES = ["login", "home", "tasks", "locations", "logs", "me"];
const COLS = 3, ROWS = 2, GAP = 18, PAD = 22;
const TW = 390, TH = 844;

const W = PAD * 2 + COLS * TW + (COLS - 1) * GAP;
const H = PAD * 2 + ROWS * TH + (ROWS - 1) * GAP;
const canvas = Buffer.alloc(W * H * 3);
// 背景 #EDEDF1
for (let i = 0; i < W * H; i++) {
  canvas[i * 3] = 237;
  canvas[i * 3 + 1] = 237;
  canvas[i * 3 + 2] = 241;
}

NAMES.forEach((name, idx) => {
  const img = decode(path.join(__dirname, "app", `${name}.png`));
  const c = idx % COLS, r = Math.floor(idx / COLS);
  const ox = PAD + c * (TW + GAP);
  const oy = PAD + r * (TH + GAP);
  const sc = img.w / TW; // 2
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const sx = Math.floor(x * sc), sy = Math.floor(y * sc);
      // 圆角遮罩
      const rad = 26;
      const dx = x < rad ? rad - x : x > TW - 1 - rad ? x - (TW - 1 - rad) : 0;
      const dy = y < rad ? rad - y : y > TH - 1 - rad ? y - (TH - 1 - rad) : 0;
      const outside = Math.sqrt(dx * dx + dy * dy) > rad;
      const si = (sy * img.w + sx) * img.ch;
      const di = ((oy + y) * W + (ox + x)) * 3;
      if (outside) continue;
      canvas[di] = img.data[si];
      canvas[di + 1] = img.data[si + 1];
      canvas[di + 2] = img.data[si + 2];
    }
  }
});

fs.writeFileSync(path.join(__dirname, "overview.png"), encode(W, H, canvas));
console.log("overview.png", W + "x" + H);
