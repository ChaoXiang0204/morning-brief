#!/usr/bin/env node
/*
 * 產生桌面小工具用的圖示（icon-192.png、icon-512.png、apple-touch-icon.png）。
 * 純 Node 內建模組（zlib 做 PNG 壓縮），沒有外部套件，維持專案零相依原則。
 *
 * 用法：
 *   node scripts/gen-icons.mjs
 *
 * 圖案跟頁面天氣面板裡的「太陽從雲後探出來」是同一個造型，配色也取自
 * index.html 最上面的 CSS 變數（--sunf/--cloudf/--clouds/--g）。
 * 想換圖示風格，改下面 SUNF/CLOUDF/CLOUDS/BG_TOP/BG_BOTTOM 這幾個顏色常數，
 * 或調整 paint() 裡的形狀參數就好。
 */

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 跟 index.html 預設（warm）色板一致
const BG_TOP = [255, 227, 164];      // #FFE3A4
const BG_BOTTOM = [255, 224, 188];   // #FFE0BC
const SUNF = [245, 154, 40];         // #F59A28
const CLOUDF = [255, 253, 246];      // #FFFDF6
const CLOUDS = [201, 138, 46];       // #C98A2E

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function circle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function cloudMask(x, y, n) {
  const cx = 0.54 * n, cy = 0.64 * n;
  return (
    circle(x, y, cx - 0.19 * n, cy - 0.04 * n, 0.17 * n) ||
    circle(x, y, cx + 0.02 * n, cy - 0.13 * n, 0.21 * n) ||
    circle(x, y, cx + 0.22 * n, cy - 0.01 * n, 0.155 * n) ||
    (x >= cx - 0.32 * n && x <= cx + 0.32 * n && y >= cy - 0.03 * n && y <= cy + 0.19 * n)
  );
}

// 畫一張 n x n 的圖示，回傳 RGBA Buffer（每像素 4 bytes）
function paint(n) {
  const SS = 4;                        // 超取樣倍率，畫完再縮小做反鋸齒
  const N = n * SS;
  const buf = Buffer.alloc(N * N * 4);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let color = mix(BG_TOP, BG_BOTTOM, y / N);

      // 太陽（實心圓）
      if (circle(x, y, 0.37 * N, 0.40 * N, 0.225 * N)) {
        color = SUNF;
      }
      // 雲的外框（描邊效果：先畫大一圈的邊框色，再疊小一圈的雲身）
      if (cloudMask(x, y, N * 1.045)) {
        color = CLOUDS;
      }
      if (cloudMask(x, y, N)) {
        color = CLOUDF;
      }

      const i = (y * N + x) * 4;
      buf[i] = Math.round(color[0]);
      buf[i + 1] = Math.round(color[1]);
      buf[i + 2] = Math.round(color[2]);
      buf[i + 3] = 255;
    }
  }

  // box downsample：SS x SS 平均
  const out = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const si = ((y * SS + sy) * N + (x * SS + sx)) * 4;
          r += buf[si]; g += buf[si + 1]; b += buf[si + 2];
        }
      }
      const count = SS * SS;
      const i = (y * n + x) * 4;
      out[i] = Math.round(r / count);
      out[i + 1] = Math.round(g / count);
      out[i + 2] = Math.round(b / count);
      out[i + 3] = 255;
    }
  }
  return out;
}

/* ── 最小 PNG 編碼（簽章 + IHDR + IDAT + IEND），夠用就好 ── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, n) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // 每一列前面加一個 filter byte（0 = None）
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    rgba.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(n, filename) {
  const rgba = paint(n);
  const png = encodePNG(rgba, n);
  writeFileSync(join(ROOT, filename), png);
  console.log(`✓ ${filename}（${n}x${n}）`);
}

makeIcon(192, 'icon-192.png');
makeIcon(512, 'icon-512.png');
makeIcon(180, 'apple-touch-icon.png');
