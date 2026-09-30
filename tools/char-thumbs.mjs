#!/usr/bin/env node
/* 옷장 카드용 썸네일 생성 → public/char/thumb/<name>.png (높이 320, 레티나 2배 여유).

   원본 400×658 을 CSS 로 150px 높이에 욱여넣으면 브라우저 축소(특히
   image-rendering:pixelated 의 최근접 샘플링)로 선이 깨져 보인다. 미리 LANCZOS 로
   줄여 두면 그 문제가 없고 옷장이 열릴 때 내려받는 양도 1/10 이다.
   옷장이 보여주는 건 폼별 교복 + 의상 기본 컷뿐이라 그것만 만든다.

   사용: node tools/char-thumbs.mjs  (이미지 추가·정규화 후 다시 실행) */
import sharp from 'sharp';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'public/char');
const OUT = resolve(DIR, 'thumb');
const HEIGHT = 320;
const COSTUMES = ['kimono', 'bunny', 'pajama', 'lounge', 'casual', 'summer', 'knit', 'nurse', 'swim'];

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const form of ['choten', 'ame']) {
  for (const name of [`${form}_default`, ...COSTUMES.map((c) => `${form}_${c}`)]) {
    const src = resolve(DIR, name + '.png');
    if (!existsSync(src)) continue;
    await sharp(src)
      .resize({ height: HEIGHT, kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toFile(resolve(OUT, name + '.png'));
    n++;
  }
}
console.log(`thumb: ${n}장 → public/char/thumb`);
