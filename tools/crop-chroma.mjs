#!/usr/bin/env node
/* 화면 캡처에서 크로마(초록/파랑/마젠타) 배경 영역만 잘라낸다.

   제미나이 채팅에서 원본 다운로드가 걸릴 때가 있어서, 이미지를 화면에 크게
   띄워 캡처하는 경로를 쓴다. 그 캡처에는 페이지의 흰 여백까지 들어오므로
   cutout 하기 전에 이 단계로 크로마 사각형만 남긴다.

   사용법: node tools/crop-chroma.mjs tmp/gen/capture.png [--out tmp/gen/cropped.png]
*/
import sharp from 'sharp';
import { resolve, dirname, basename } from 'node:path';
import { mkdirSync } from 'node:fs';

const file = process.argv.find((a, i) => i >= 2 && a.endsWith('.png') && process.argv[i - 1] !== '--out');
const outArg = process.argv.indexOf('--out') !== -1 ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (!file) { console.error('사용법: node tools/crop-chroma.mjs <png> [--out <경로>]'); process.exit(1); }

const src = resolve(file);
const img = sharp(src).ensureAlpha();
const { width: w, height: h } = await img.metadata();
const d = await img.raw().toBuffer();

/** 어떤 채널이든 나머지 두 채널보다 확실히 높으면 크로마 픽셀로 본다 */
const isChroma = (i) => {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn > 90 && mx > 110;
};

let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (!isChroma((y * w + x) * 4)) continue;
  n++;
  if (x < x0) x0 = x; if (x > x1) x1 = x;
  if (y < y0) y0 = y; if (y > y1) y1 = y;
}
if (n < 1000) { console.error('✖ 크로마 영역을 못 찾았다'); process.exit(1); }

const out = outArg ? resolve(outArg) : resolve(dirname(src), basename(src).replace(/\.png$/, '_crop.png'));
mkdirSync(dirname(out), { recursive: true });
await sharp(src).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toFile(out);
console.log(`✅ ${basename(out)}  크로마 영역 ${x0},${y0} ~ ${x1},${y1} (${x1 - x0 + 1}x${y1 - y0 + 1})`);
