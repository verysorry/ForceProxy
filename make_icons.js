'use strict';
// Generates minimal PNG icons for ForceProxy
// Colors: blue circle with white "F" letter
// Run once: node make_icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  // Build raw RGBA pixel data
  const cx = size / 2, cy = size / 2, r = size / 2;
  const data = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r - 0.5) {
        // Blue background: #1a73e8
        data[idx]     = 0x1a;
        data[idx + 1] = 0x73;
        data[idx + 2] = 0xe8;
        data[idx + 3] = 255;
      } else if (dist <= r + 0.5) {
        // Anti-aliased edge
        const alpha = Math.round((r + 0.5 - dist) * 255);
        data[idx]     = 0x1a;
        data[idx + 1] = 0x73;
        data[idx + 2] = 0xe8;
        data[idx + 3] = alpha;
      } else {
        // Transparent
        data[idx + 3] = 0;
      }
    }
  }

  // Draw white "F" letter
  drawLetter(data, size);

  return encodePNG(size, size, data);
}

function drawLetter(data, size) {
  const s = size;
  // Letter "F" proportions scaled to icon size
  const lw = Math.max(1, Math.round(s * 0.12)); // line width
  const x0 = Math.round(s * 0.30);
  const x1 = Math.round(s * 0.70);
  const y0 = Math.round(s * 0.20);
  const y1 = Math.round(s * 0.80);
  const ym = Math.round(s * 0.50);

  function fillRect(rx, ry, rw, rh) {
    for (let y = ry; y < ry + rh && y < s; y++) {
      for (let x = rx; x < rx + rw && x < s; x++) {
        if (x < 0 || y < 0) continue;
        const idx = (y * s + x) * 4;
        if (data[idx + 3] > 0) { // only inside circle
          data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255; data[idx+3] = 255;
        }
      }
    }
  }

  // Vertical stroke
  fillRect(x0, y0, lw, y1 - y0);
  // Top horizontal
  fillRect(x0, y0, x1 - x0, lw);
  // Middle horizontal (shorter)
  fillRect(x0, ym - Math.floor(lw/2), Math.round((x1 - x0) * 0.75), lw);
}

function encodePNG(width, height, rgba) {
  const chunks = [];

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT: filter + raw scanlines
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter type None
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  chunks.push(makeChunk('IDAT', compressed));

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeB, data, crc]);
}

function crc32(buf) {
  let c = 0xFFFFFFFF;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let v = i;
      for (let j = 0; j < 8; j++) v = (v & 1) ? (0xEDB88320 ^ (v >>> 1)) : (v >>> 1);
      t[i] = v;
    }
    return t;
  })());
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const iconsDir = path.join(__dirname, 'icons');
for (const size of [16, 48, 128]) {
  const png = createPNG(size);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
}
console.log('Done.');
