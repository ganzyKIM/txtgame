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
  // 배경색 = 테두리 픽셀의 최빈색. 네 모서리만 보면 안 된다 — 제미나이는
  // 이미지를 둥근 모서리로 렌더링해서, 화면 캡처의 코너는 페이지 흰 배경이다.
  const bucket = new Map();
  const note = (x, y) => {
    const i = idx(x, y);
    const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
    const e = bucket.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
    bucket.set(key, e);
  };
  // 테두리에서 살짝 안쪽(4px)을 훑는다. 맨 가장자리는 둥근 모서리·안티에일리어싱
  // 때문에 배경과 페이지가 섞인 중간색이라 최빈색이 엉뚱하게 잡힌다.
  const IN = Math.min(4, Math.floor(Math.min(w, h) / 4));
  for (let x = IN; x < w - IN; x++) { note(x, IN); note(x, h - 1 - IN); }
  for (let y = IN; y < h - IN; y++) { note(IN, y); note(w - 1 - IN, y); }
  const top = [...bucket.values()].sort((a, b) => b.n - a.n)[0];
  const bg = [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];

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
  // ── ② 남은 배경 얼룩 제거 ───────────────────────────────────
  // 캐릭터에 드롭섀도우가 걸려 있으면 배경색이 그림자와 섞여, 원래 배경색과는
  // 꽤 다른 "어두운 초록" 얼룩이 머리카락 사이 등에 남는다. 색 거리로는 못 잡지만
  // **배경 채널이 나머지 두 채널을 압도한다**는 성질은 그대로라 그걸로 잡는다.
  // (캐릭터 팔레트에 그 원색이 없을 때만 안전하므로 크로마키일 때만 적용)
  const domCh = bg.indexOf(Math.max(...bg));
  // 밝기만 다르고 **색조는 같다**는 성질로 배경 잔재를 잡는다. "배경 채널이
  // 제일 높다"로 잡으면 안 된다 — 마젠타 배경은 지배 채널이 빨강이라,
  // 초텐쨩의 빨간 나비넥타이가 통째로 지워졌다. 마젠타처럼 두 채널이 함께
  // 높은 배경은 채널 하나만 봐서는 구분이 안 된다.
  const bgRatio = bg.map((v) => v / Math.max(...bg));
  if (isGreenScreen) {
    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      if (data[i + 3] === 0) continue;
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      if (mx < 24) continue;   // 거의 검정은 채널 비율이 의미 없다
      const dr = Math.abs(data[i] / mx - bgRatio[0])
               + Math.abs(data[i + 1] / mx - bgRatio[1])
               + Math.abs(data[i + 2] / mx - bgRatio[2]);
      if (dr < 0.22) { data[i + 3] = 0; cut++; }
    }
  }

  // ── ③ 작은 섬 제거 ─────────────────────────────────────────
  // 제미나이 워터마크(우하단 ✦)처럼 배경색과 살짝 달라 살아남은 조각을 지운다.
  const minIsland = Math.max(64, Math.round(w * h * 0.0004));
  const compId = new Int32Array(w * h).fill(-1);
  for (let p0 = 0; p0 < w * h; p0++) {
    if (data[p0 * 4 + 3] === 0 || compId[p0] !== -1) continue;
    const cells = [p0]; compId[p0] = p0;
    for (let qi = 0; qi < cells.length; qi++) {
      const q = cells[qi], qx = q % w, qy = (q / w) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (data[np * 4 + 3] === 0 || compId[np] !== -1) continue;
        compId[np] = p0; cells.push(np);
      }
    }
    if (cells.length < minIsland) for (const q of cells) { data[q * 4 + 3] = 0; cut++; }
  }

  // ── ④ 가장자리 스필 보정 ────────────────────────────────────
  // 경계 픽셀은 배경색이 옅게 섞여 색 테두리가 남는다. 알파 경계에서 안쪽으로
  // 몇 겹만 배경 채널을 눌러 준다(안쪽 색조는 건드리지 않는다).
  const SPILL_BAND = 3;
  let despilled = 0;
  for (let pass = 0; pass < SPILL_BAND; pass++) {
    const alphaSnap = Uint8Array.from({ length: w * h }, (_, p) => data[p * 4 + 3]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alphaSnap[p] === 0) continue;
      let edge = false;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge = true; break; }
        if (alphaSnap[ny * w + nx] === 0) { edge = true; break; }
      }
      if (!edge) continue;
      const i = p * 4;
      // 먼저 **배경 쪽으로 물든 픽셀**만 남긴다. 이 관문이 없으면 배경 채널이
      // 원래 높은 색까지 배경 취급해서 눌러버린다 — 마젠타 배경에서 초텐쨩의
      // 분홍 피부와 빨간 나비넥타이가 시커멓게 죽었다. 지우기(0.22)보다는
      // 느슨하게 잡아야 덜 물든 바깥 한두 겹까지 닦인다.
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const dr = mx < 24 ? 9 :
        Math.abs(data[i] / mx - bgRatio[0])
        + Math.abs(data[i + 1] / mx - bgRatio[1])
        + Math.abs(data[i + 2] / mx - bgRatio[2]);
      if (dr < 0.45) {
        const others = [0, 1, 2].filter((c) => c !== domCh).map((c) => data[i + c]);
        // 상한을 "나머지 두 채널의 최댓값"으로만 잡는다. 평균까지 끌어내리면
        // 초텐쨩의 민트(초록이 원래 높은 색)가 파랗게 변한다 — 실제로 그랬다.
        const cap = Math.max(...others);
        if (data[i + domCh] > cap) { data[i + domCh] = cap; despilled++; }
      }
      // 다음 패스가 한 겹 더 안쪽을 보도록 임시로 경계 표시를 옮긴다
      if (pass < SPILL_BAND - 1) alphaSnap[p] = 0;
    }
  }
  return { cut, bg, isGreenScreen, despilled };
}

/* 잘라낸 캐릭터에 드롭섀도우를 다시 입힌다.
   생성물의 그림자는 초록 배경 위에 그려져 있어서 배경을 지우면 같이 사라진다.
   원본 자산(public/char/*.png)을 실측한 값에 맞춰 여기서 다시 만든다:
   근사 검정(21,20,37) / 좌우 5~7px, 아래 8~9px 퍼짐 → blur 6, 아래로 3px. */
const SHADOW = { blur: 11, dx: 0, dy: 4, opacity: 0.42, color: { r: 21, g: 20, b: 37 } };

async function addDropShadow(pngBuf) {
  const { blur, dx, dy, opacity, color } = SHADOW;
  const { width, height } = await sharp(pngBuf).metadata();
  const pad = Math.ceil(blur * 2) + Math.max(Math.abs(dx), Math.abs(dy));
  const W = width + pad * 2, H = height + pad * 2;

  // 반드시 RGBA 상태에서 "투명"으로 확장한 뒤 알파를 뽑는다.
  // 1채널로 만든 뒤 extend 하면 여백이 투명이 아닌 값으로 차서 그림자가
  // 실루엣이 아니라 사각형으로 나온다 (실제로 그랬다).
  const padded = await sharp(pngBuf)
    .extend({ top: pad + dy, bottom: pad - dy, left: pad + dx, right: pad - dx,
              background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const mask = await sharp(padded)
    .extractChannel('alpha')
    .blur(blur)
    .linear(opacity, 0)          // 그림자 농도
    .toBuffer();

  const shadow = await sharp({ create: { width: W, height: H, channels: 3, background: color } })
    .joinChannel(mask)
    .png().toBuffer();

  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow }, { input: pngBuf, left: pad, top: pad }])
    .png().toBuffer();
}

async function cutFile(file) {
  const src = resolve(file);
  const img = sharp(src).ensureAlpha();
  const { width: w, height: h } = await img.metadata();
  const data = await img.raw().toBuffer();

  const { cut, bg, isGreenScreen, despilled } = cutBackground(data, w, h);
  const pct = ((cut / (w * h)) * 100).toFixed(1);

  // 남은 캐릭터의 실제 경계로 잘라낸 뒤 규격에 맞춰 축소 — 생성물마다 여백이
  // 달라서, 여백째 리사이즈하면 캐릭터 크기가 들쭉날쭉해진다.
  let out = sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .trim({ threshold: 1 });

  const trimmed = await addDropShadow(await out.toBuffer());
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
  console.log(`✅ ${basename(outPath)}  배경 ${pct}% 제거 (bg rgb ${bg.join(",")}${isGreenScreen ? ", 크로마키" : ""}) → ${meta.width}×${meta.height} alpha=${meta.hasAlpha}, 스필보정 ${despilled}px`);
}

// --out 의 "값"까지 입력으로 오해하면 결과물을 한 번 더 처리해 이중 리사이즈가 된다
const argv = process.argv.slice(2);
const files = argv.filter((a, i) =>
  a.endsWith('.png') && !a.startsWith('--') && argv[i - 1] !== '--out');
if (!files.length) { console.error('사용법: node tools/cutout.mjs <png...> [--out <경로>]'); process.exit(1); }
for (const f of files) await cutFile(f);
