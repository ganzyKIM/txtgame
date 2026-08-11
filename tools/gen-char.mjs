#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   캐릭터 이미지 변형 생성기 (개발용 자산 파이프라인)

   기존 public/char/*.png 를 **레퍼런스로 넣어서** 복장·포즈·표정만 바꾼
   변형을 뽑는다. 캐릭터 일관성의 핵심은 프롬프트가 아니라 레퍼런스 이미지다 —
   텍스트로만 설명하면 리본 개수, 허벅지 하트, 통굽 구두 같은 디테일이 매번 흔들린다.
   (제미나이 채팅 UI로도 해봤는데, 첨부가 스크린샷 경유라 해상도가 깎여서
    일관성이 크게 무너졌다. 원본 PNG를 그대로 넣는 이 API 경로가 훨씬 낫다.)

   프롬프트는 영어로 쓴다 — 한국어보다 이미지 모델이 훨씬 잘 따른다.

   [게임 런타임이 아니라 개발 도구다]
   유저가 볼 때 생성하면 (1) 볼 때마다 과금, (2) 몇 초씩 지연, (3) 사람마다
   다른 그림이 나온다. 후보를 여러 장 뽑아 **사람이 고르고** public/char/ 에
   커밋하는 방식으로만 쓴다.

   사용법:
     GEMINI_API_KEY=... node tools/gen-char.mjs --char choten --name kimono \
       --prompt "a traditional Japanese kimono" --chroma blue --n 4

   결과: tmp/gen/<char>_<name>_N.png  (tmp/ 는 gitignore 대상)

   옵션:
     --char   choten | ame                      (필수)
     --name   저장 파일명 접미사                  (필수)
     --prompt 바꿀 것만 영어로                    (필수)
     --n      후보 장수 (기본 3)
     --ref    레퍼런스 파일 직접 지정 (기본: default + 소품 없는 표정 1종)
     --chroma green|magenta|blue  배경 스크린 색. 의상 색과 겹치면 바꿔라
     --model  모델 이름 (기본 gemini-2.5-flash-image)
              후보: gemini-3.1-flash-lite-image / gemini-3.1-flash-image
                    / gemini-2.5-flash-image / gemini-3-pro-image
              ※ imagen-* 는 predict 전용이라 레퍼런스 이미지를 못 받는다 → 사용 불가
   ════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MODEL = 'gemini-2.5-flash-image';

/* 배경 스크린 색. 캐릭터 고정 팔레트뿐 아니라 **그때 입히는 의상 색**과도
   멀어야 한다 (산타=빨강일 때 마젠타 배경을 쓰면 옷에 구멍이 뚫린다). */
const CHROMA = {
  green:   'pure saturated green #00FF00',
  magenta: 'pure saturated magenta #FF00FF',
  blue:    'pure saturated blue #0000FF',
};

const BIBLE = {
  choten: {
    chroma: 'magenta',  // 민트 머리카락 때문에 초록 배경을 쓰면 머리가 잘려나간다
    refs: ['choten_default.png', 'choten_peace.png'],
    lock: [
      'extremely long twintails with a pastel PINK and MINT GREEN gradient',
      'long ribbon-like hair strands curling and flowing all around her body',
      'cream / white blonde hair at the crown, a pastel bow and a star hairpin',
      'large bright light-blue eyes',
      'small heart and star marks on her right thigh',
      'thick platform pastel blue mary jane shoes with ankle straps',
      'overall high-key pastel palette (pink, mint, lavender, cream)',
    ],
  },
  ame: {
    chroma: 'green',
    // 소품이 없는 것만 레퍼런스로 쓴다 — smoking/drug 를 넣으면 담배까지 따라 그린다
    refs: ['ame_default.png', 'ame_dere.png'],
    lock: [
      'near-black dark twintails, shorter and spikier than Choten, with a small red ribbon',
      'an X-shaped hairpin, front bangs partly covering one eye',
      'muted mauve / dusty purple eyes',
      'a black choker with a red heart charm',
      'dark charcoal knee-high socks',
      'overall dark low-key palette (black, crimson, charcoal)',
    ],
  },
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function buildPrompt(char, change, chromaKey) {
  const b = BIBLE[char];
  const chroma = CHROMA[chromaKey] ?? CHROMA[b.chroma];
  return [
    'Redraw the EXACT same character shown in the attached reference images.',
    'It must read as the same person: same face, same body proportions, same art style.',
    '',
    'MUST KEEP IDENTICAL to the references:',
    ...b.lock.map((s) => `- ${s}`),
    '- pixel-art style with dithered shading and crisp clean outlines',
    '',
    'RENDERING RULES:',
    '- Do NOT draw a white sticker outline or any white border around the character.',
    '  Instead apply a soft drop shadow to the whole character silhouette,',
    '  like a design tool drop-shadow effect. No shadow cast on the ground.',
    `- Background: completely flat ${chroma} filling the entire frame.`,
    '  No gradient, no texture, no scenery. It will be chroma-keyed out later,',
    '  so it must be a colour that appears nowhere on the character.',
    '',
    'COMPOSITION:',
    '- A single character only, full body, standing, facing the viewer.',
    '- Tall portrait aspect ratio, roughly 400 wide by 658 tall.',
    '- Leave at least 10% empty margin above her head and below her feet.',
    '  Nothing may be cropped — not hats, hair ornaments, hair, or shoes.',
    '',
    'CHANGE ONLY THIS:',
    `- ${change}`,
    '',
    'Everything not listed under "CHANGE ONLY THIS" stays exactly as in the references.',
    'If a reference shows a prop (a cigarette, a bottle), do not copy it — leave the hands empty.',
    'No text, no watermark, no signature.',
  ].join('\n');
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('✖ GEMINI_API_KEY 환경변수가 없다.\n' +
      '  .env.local 에 GEMINI_API_KEY=... 로 넣거나\n' +
      '  GEMINI_API_KEY=... node tools/gen-char.mjs ... 형태로 넘겨라.');
    process.exit(1);
  }
  const char = arg('char'), name = arg('name'), change = arg('prompt');
  const model = arg('model', DEFAULT_MODEL);
  const n = Number(arg('n', 3));
  if (!BIBLE[char] || !name || !change) {
    console.error('✖ --char(choten|ame) --name <파일명> --prompt <바꿀 내용(영어)> 은 필수다.');
    process.exit(1);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const refFiles = arg('ref') ? [arg('ref')] : BIBLE[char].refs;
  const parts = [{ text: buildPrompt(char, change, arg('chroma')) }];
  for (const f of refFiles) {
    const p = resolve(ROOT, 'public/char', f);
    if (!existsSync(p)) { console.error(`✖ 레퍼런스 없음: ${p}`); process.exit(1); }
    parts.push({ inline_data: { mime_type: 'image/png', data: readFileSync(p).toString('base64') } });
  }
  console.log(`[${model}] ref=${refFiles.join(', ')} → "${change}" 후보 ${n}장`);

  const outDir = resolve(ROOT, 'tmp/gen');
  mkdirSync(outDir, { recursive: true });

  let saved = 0, outTokens = 0;
  for (let i = 1; i <= n; i++) {
    const t0 = Date.now();
    const res = await fetch(`${endpoint}?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) {
      console.error(`✖ ${i}번째 실패 (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
      continue;
    }
    const json = await res.json();
    const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    if (!img) {
      const txt = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ');
      console.error(`✖ ${i}번째: 이미지가 안 왔다. ${txt ? '모델 응답: ' + txt.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
      continue;
    }
    const out = resolve(outDir, `${char}_${name}_${i}.png`);
    writeFileSync(out, Buffer.from((img.inlineData || img.inline_data).data, 'base64'));
    // 비용 산출용 — 이미지 1장이 몇 토큰으로 청구되는지 실측한다
    const u = json.usageMetadata || {};
    outTokens += u.candidatesTokenCount ?? 0;
    console.log(`  ✅ ${out}  [in ${u.promptTokenCount ?? '?'} / out ${u.candidatesTokenCount ?? '?'} 토큰, ${((Date.now() - t0) / 1000).toFixed(1)}초]`);
    saved++;
  }
  if (saved) console.log(`\n${saved}장 저장 (출력 토큰 합계 ${outTokens}). 골라서 public/char/ 로 옮겨라.`);
  else console.log('\n저장된 게 없다.');
}

main().catch((e) => { console.error(e); process.exit(1); });
