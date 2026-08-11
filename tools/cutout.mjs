#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   생성 이미지 후처리 — 배경 제거 + 게임 규격(400×658)으로 리사이즈

   [왜 단순 색상 제거를 안 쓰나]
   "배경색과 같은 픽셀을 전부 지운다"로 하면 아메의 **검은 머리카락과 검정
   치마**가 같이 지워진다(배경이 검정으로 나올 때). 그래서 색이 아니라
   **연결성**으로 지운다 — 테두리에서 시작해 비슷한 색으로 이어지는 영역만
   번져나가며(flood fill) 지운다. 캐릭터 안쪽의 같은 색은 테두리와 끊겨 있어
   살아남는다. 캐릭터 주위의 흰 스티커 테두리가 자연스러운 방벽 역할을 한다.

   사용법: node tools/cutout.mjs tmp/gen/choten_santa_1.png [--out public/char/choten_santa.png]
           node tools/cutout.mjs tmp/gen/*.png            (여러 장 한 번에)
   ════════════════════════════════════════════════════════════════════ */
import sharp from 'sharp';
import { resolve, basename, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

const TARGET_H = 658;   // public/char/*.png 규격
const TARGET_W = 400;
const TOLERANCE = 38;   // 배경으로 볼 색 거리 (0~255). 그라데이션 배경 대비 여유

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

/** 테두리에서 시작하는 flood fill 로 배경 픽셀에 alpha=0 을 찍는다 */
function cutBackground(data, w, h) {
  const idx = (x, y) => (y * w + x) * 4;
  // 네 모서리 색의 평균을 배경색으로 잡는다(한 곳이 캐릭터에 닿아도 흔들리지 않게 중앙값 사용)
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
    const i = idx(x, y); return [data[i], data[i + 1], data[i + 2]];
  });
  const med = (k) => corners.map((c) => c[k]).sort((a, b) => a - b)[1];
  const bg = [med(0), med(1), med(2)];

  const near = (i) =>
    Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) <= TOLERANCE * 3;

  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }

  let cut = 0;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (seen[p]) continue;
    const i = p * 4;
    if (!near(i)) continue;
    seen[p] = 1;
    data[i + 3] = 0;
    cut++;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // flood fill 은 "테두리에서 이어진" 배경만 지운다. 초텐쨩의 리본 고리 안쪽처럼
  // 캐릭터에 둘러싸여 끊긴 배경은 남는다. 배경을 초록 스크린으로 강제해 두었고
  // 두 캐릭터 팔레트에는 초록이 없으므로, 초록일 때만 전역으로 한 번 더 지운다.
  // 반드시 "쨍한 원색"일 때만 전역 제거를 한다. 배경이 연한 민트로 나왔을 때
  // 초텐쨩의 민트 머리카락이 통째로 지워진 적이 있다 — 배경이 캐릭터 색과
  // 가까우면 색만 보고 지우는 건 어떤 방식이든 안전하지 않다.
  const isGreenScreen = Math.max(...bg) - Math.min(...bg) > 110;
  if (isGreenScreen) {
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] !== 0 && near(i)) { data[i + 3] = 0; cut++; }
    }
  }
  return { cut, bg, isGreenScreen };
}

async function cutFile(file) {
  const src = resolve(file);
  const img = sharp(src).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const data = await img.raw().toBuffer();

  const { cut, bg, isGreenScreen } = cutBackground(data, w, h);
  const pct = ((cut / (w * h)) * 100).toFixed(1);

  // 남은 캐릭터의 실제 경계로 잘라낸 뒤 규격에 맞춰 축소 — 생성물마다 여백이
  // 달라서, 여백째 리사이즈하면 캐릭터 크기가 들쭉날쭉해진다.
  let out = sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .trim({ threshold: 1 });

  const trimmed = await out.toBuffer();
  const outPath = arg('out')
    ? resolve(arg('out'))
    : resolve(dirname(src), basename(src).replace(/\.png$/, '_cut.png'));
  mkdirSync(dirname(outPath), { recursive: true });

  await sharp(trimmed)
    .resize({ width: TARGET_W, height: TARGET_H, fit: 'contain',
              background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  console.log(`✅ ${basename(outPath)}  배경 ${pct}% 제거 (bg rgb ${bg.join(",")}${isGreenScreen ? ", 크로마키" : ""}) → ${meta.width}×${meta.height} alpha=${meta.hasAlpha}`);
}

// --out 의 "값"까지 입력으로 오해하면 결과물을 한 번 더 처리해 이중 리사이즈가 된다
const argv = process.argv.slice(2);
const files = argv.filter((a, i) =>
  a.endsWith('.png') && !a.startsWith('--') && argv[i - 1] !== '--out');
if (!files.length) { console.error('사용법: node tools/cutout.mjs <png...> [--out <경로>]'); process.exit(1); }
for (const f of files) await cutFile(f);
