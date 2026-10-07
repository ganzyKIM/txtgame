#!/usr/bin/env node
/* public/char/*.png 의 캐릭터 크기·위치를 폼별로 통일한다.

   제미나이가 표정마다 따로 그린 컷이라 같은 캐릭터인데도 키가 5% 가까이 다르고
   가로 위치도 30px 씩 어긋나 있어, 표정이 바뀔 때마다 캐릭터가 커졌다 작아졌다 한다.
   각 컷의 알파 바운딩 박스를 재서:
     · 높이를 폼의 기본(교복) 세트 중앙값에 맞춰 살짝 확대/축소(LANCZOS)
     · 발끝(박스 아래) y 와 가로 중심 x 를 같은 기준점으로 이동
   한다. 캔버스 400×658 은 그대로. 의상 컷도 같은 기준을 쓴다 — 캐릭터 키는 하나다.

   사용: node tools/char-normalize.mjs [--dry] [--only choten|ame]
   멱등: 이미 맞춰진 파일은 건드리지 않는다. */
import sharp from 'sharp';
import { readdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'public/char');
const W = 400, H = 658, ALPHA_MIN = 16;
const COSTUMES = ['kimono', 'bunny', 'pajama', 'lounge', 'casual', 'summer', 'knit', 'nurse', 'saint', 'swim'];
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;

async function bbox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > ALPHA_MIN) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error(`빈 이미지: ${file}`);
  // 가로 기준은 박스 중심이 아니라 알파 질량중심 — 팔을 뻗은 컷은 박스 중심이
  // 팔 쪽으로 쏠려서 그걸로 맞추면 오히려 몸이 좌우로 튄다. 팔은 몸통·머리에
  // 비해 얇아서 질량중심은 몇 px 밖에 안 움직인다
  let sum = 0, cnt = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = data[(y * width + x) * channels + 3];
      if (a > ALPHA_MIN) { sum += x * a; cnt += a; }
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: sum / cnt, width, height };
}

const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const isDefaultSkin = (form, name) => {
  const rest = name.slice(form.length + 1);
  return !COSTUMES.some((c) => rest === c || rest.startsWith(c + '_'));
};

for (const form of ['choten', 'ame']) {
  if (ONLY && ONLY !== form) continue;
  const names = readdirSync(DIR).filter((f) => f.endsWith('.png') && f.startsWith(form + '_')).map((f) => f.slice(0, -4)).sort();
  const boxes = new Map();
  for (const n of names) boxes.set(n, await bbox(resolve(DIR, n + '.png')));
  const base = names.filter((n) => isDefaultSkin(form, n)).map((n) => boxes.get(n));
  const ref = { h: median(base.map((b) => b.h)), bot: median(base.map((b) => b.y1)), cx: median(base.map((b) => b.cx)) };
  console.log(`${form}: 기준 높이 ${ref.h}px · 발끝 y=${ref.bot} · 중심 x=${ref.cx}  (교복 ${base.length}컷 중앙값)`);

  let changed = 0;
  for (const n of names) {
    const b = boxes.get(n);
    if (b.width !== W || b.height !== H) { console.log(`  ! ${n}: 캔버스 ${b.width}×${b.height} — 건너뜀`); continue; }
    const scale = ref.h / b.h;
    const dy = ref.bot - b.y1 * scale;
    const dx = ref.cx - b.cx * scale;
    if (Math.abs(scale - 1) < 0.004 && Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5) continue;
    changed++;
    console.log(`  ${n.padEnd(28)} h=${b.h}→${ref.h} (×${scale.toFixed(3)})  dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
    if (DRY) continue;

    const file = resolve(DIR, n + '.png');
    const nw = Math.round(W * scale), nh = Math.round(H * scale);
    const PAD = 300; // 어느 방향으로 밀어도 잘리지 않게 넉넉히 두른 뒤 원래 크기로 잘라낸다
    const left = Math.round(PAD - dx), top = Math.round(PAD - dy);
    // sharp 는 한 체인 안에서 resize/extend/extract 순서를 자기 규칙으로 재배열하므로
    // 단계를 버퍼로 끊는다 — 안 그러면 extract 가 resize 전 좌표로 잘려 범위를 벗어난다
    const scaled = await sharp(file)
      .resize(nw, nh, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
      .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    const out = await sharp(scaled).extract({ left, top, width: W, height: H }).png({ compressionLevel: 9 }).toBuffer();
    const tmp = file + '.tmp';
    await sharp(out).toFile(tmp);
    renameSync(tmp, file);
  }
  console.log(`${form}: ${changed}/${names.length}컷 ${DRY ? '조정 대상' : '조정함'}`);
}
