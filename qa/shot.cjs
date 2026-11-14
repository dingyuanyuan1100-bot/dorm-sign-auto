// 截图工具：无头 Chrome 抓图后，裁出 390x844 舞台（2x），用于 1:1 比对
const { execFileSync } = require("child_process");
const fs = require("fs");
const zlib = require("zlib");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const W = 390,
  H = 844,
  DPR = 2;

function decode(buf) {
  let p = 8,
    width = 0,
    height = 0,
    bd = 8,
    ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = d.readUInt32BE(0);
      height = d.readUInt32BE(4);
      bd = d[8];
      ct = d[9];
    } else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * ch);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { width, height, ch, data: out };
}

function encodeRGB(width, height, data) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, body])) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function crop(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * img.width + x0) * img.ch;
    const dst = y * w * 3;
    for (let x = 0; x < w; x++) {
      out[dst + x * 3] = img.data[src + x * img.ch];
      out[dst + x * 3 + 1] = img.data[src + x * img.ch + 1];
      out[dst + x * 3 + 2] = img.data[src + x * img.ch + 2];
    }
  }
  return out;
}

const shots = [
  ["login", "http://127.0.0.1:5275/?flat=1"],
  ["home", "http://127.0.0.1:5275/?flat=1#home"],
  ["tasks", "http://127.0.0.1:5275/?flat=1#tasks"],
  ["locations", "http://127.0.0.1:5275/?flat=1#locations"],
  ["logs", "http://127.0.0.1:5275/?flat=1#logs"],
  ["me", "http://127.0.0.1:5275/?flat=1#me"],
];

const outDir = process.argv[2] || "C:\\Users\\Administrator\\WorkBuddy\\2026-11-01-20-10-47\\qa\\app";
fs.mkdirSync(outDir, { recursive: true });

for (const [name, url] of shots) {
  const tmp = `${outDir}\\_raw_${name}.png`;
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--force-device-scale-factor=${DPR}`,
      "--window-size=508,939",
      "--virtual-time-budget=4200",
      `--screenshot=${tmp}`,
      url,
    ],
    { stdio: "ignore" },
  );
  const img = decode(fs.readFileSync(tmp));
  const data = crop(img, 0, 0, W * DPR, H * DPR);
  fs.writeFileSync(`${outDir}\\${name}.png`, encodeRGB(W * DPR, H * DPR, data));
  fs.unlinkSync(tmp);
  console.log(`${name}.png  ${W * DPR}x${H * DPR}`);
}
