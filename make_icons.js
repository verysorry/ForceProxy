'use strict';
// Generates minimal PNG icons for ForceProxy
// Design: white "P" on a blue rounded square — a nod to the European parking
// sign (P → "proxy"). Blue matches the popup header (#1a73e8).
// Run once: node make_icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size) {
  // Build raw RGBA pixel data
  const cx = size / 2, cy = size / 2;
  const half = size / 2;        // full-bleed tile (edges touch the canvas)
  const radius = size * 0.22;   // rounded-corner radius
  const data = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Signed distance to the rounded rectangle (negative = inside).
      const d = roundRectSDF(x + 0.5 - cx, y + 0.5 - cy, half, half, radius);
      // Coverage across a 1px anti-aliased edge.
      let cov = 0.5 - d;
      if (cov <= 0) { data[idx + 3] = 0; continue; } // outside the tile
      if (cov > 1) cov = 1;                           // fully inside
      // Blue background: #1a73e8
      data[idx]     = 0x1a;
      data[idx + 1] = 0x73;
      data[idx + 2] = 0xe8;
      data[idx + 3] = Math.round(cov * 255);
    }
  }

  // Draw the white "P"
  drawP(data, size);

  return encodePNG(size, size, data);
}

// Signed distance from point (px,py), measured from the rect center, to a
// rounded rectangle with half-extents (hx,hy) and corner radius r.
function roundRectSDF(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function drawP(data, size) {
  const s = size;
  // "P" proportions scaled to icon size.
  const lw = Math.max(1, Math.round(s * 0.12)); // stroke width
  const x0 = Math.round(s * 0.30);              // left edge of stem
  const x1 = Math.round(s * 0.70);              // right edge of bowl
  const y0 = Math.round(s * 0.17);              // top
  const y1 = Math.round(s * 0.83);              // bottom of stem
  const ym = Math.round(s * 0.56);              // bottom of the bowl

  function fillRect(rx, ry, rw, rh) {
    for (let y = ry; y < ry + rh && y < s; y++) {
      for (let x = rx; x < rx + rw && x < s; x++) {
        if (x < 0 || y < 0) continue;
        const idx = (y * s + x) * 4;
        if (data[idx + 3] > 0) { // only paint inside the tile
          data[idx] = 255; data[idx+1] = 255; data[idx+2] = 255; data[idx+3] = 255;
        }
      }
    }
  }

  fillRect(x0, y0, lw, y1 - y0);       // vertical stem (full height)
  fillRect(x0, y0, x1 - x0, lw);       // top bar of the bowl
  fillRect(x1 - lw, y0, lw, ym - y0);  // right bar of the bowl
  fillRect(x0, ym - lw, x1 - x0, lw);  // bottom bar (closes the loop; counter stays blue)
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
