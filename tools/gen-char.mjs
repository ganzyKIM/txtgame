#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   캐릭터 이미지 변형 생성기 (개발용 자산 파이프라인)

   기존 public/char/*.png 를 **레퍼런스로 넣어서** 복장·포즈·표정만 바꾼
   변형을 뽑는다. 캐릭터 일관성의 핵심은 프롬프트가 아니라 레퍼런스 이미지다 —
   텍스트로만 설명하면 리본 개수, 허벅지 하트, 통굽 구두 같은 디테일이 매번 흔들린다.

   [게임 런타임이 아니라 개발 도구다]
   유저가 볼 때 생성하면 (1) 볼 때마다 과금, (2) 몇 초씩 지연, (3) 사람마다
   다른 그림이 나온다. 그래서 여기서 후보를 여러 장 뽑아 **사람이 고르고**
   public/char/ 에 커밋하는 방식으로 쓴다.

   사용법:
     GEMINI_API_KEY=... node tools/gen-char.mjs --char choten --name santa \
       --prompt "빨간 산타 복장, 흰 털 트리밍, 산타 모자" --n 4

   결과: tmp/gen/<char>_<name>_1.png ... (tmp/ 는 gitignore 대상)

   옵션:
     --char   choten | ame            (필수)
     --name   저장 파일명 접미사        (필수)
     --prompt 바꾸고 싶은 것만 한국어/영어로  (필수)
     --n      후보 장수 (기본 3)
     --ref    레퍼런스 파일 추가 지정 (기본: default + 표정 1종)
     --chroma green|magenta|blue  배경 스크린 색. 의상 색과 겹치면 바꿔라
   ════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/* 캐릭터 설계 고정값 — 레퍼런스 이미지가 주 역할이지만, 모델이 놓치기 쉬운
   "절대 바뀌면 안 되는 것"을 글로도 한 번 더 못박는다. */
/* chroma: 배경 스크린 색. 반드시 그 캐릭터 팔레트에 **없는** 색이어야 한다.
   초텐쨩은 민트색 머리카락이 있어서 초록 배경을 쓰면 머리가 같이 잘려나간다
   (실제로 당했다). 그래서 초텐=마젠타, 아메=초록으로 나눠 쓴다. */
/* 의상 색과도 겹치면 안 되므로 --chroma 로 갈아끼울 수 있게 한다.
   (산타=빨강 의상일 때 마젠타 배경을 쓰면 옷에 구멍이 뚫린다 — 실제로 당했다) */
const CHROMA = {
  green:   { name: '순수 초록(#00FF00)',   rgb: [0, 255, 0] },
  magenta: { name: '순수 마젠타(#FF00FF)', rgb: [255, 0, 255] },
  blue:    { name: '순수 파랑(#0000FF)',   rgb: [0, 0, 255] },
};

const BIBLE = {
  choten: {
    chroma: 'magenta',
    refs: ['choten_default.png', 'choten_peace.png'],
    lock: [
      '파스텔 핑크+민트 그라데이션의 매우 긴 트윈테일. 리본처럼 생긴 머리카락 가닥이 몸 주위를 길게 휘감는다',
      '정수리 쪽은 밝은 크림/화이트 블론드, 왼쪽에 파스텔 리본과 별 모양 헤어핀',
      '크고 맑은 하늘색 눈',
      '홀로그램처럼 무지갯빛으로 반짝이는 파스텔 세일러 상의 + 큼직한 크림색 리본 + 하트 브로치',
      '오른쪽 허벅지에 작은 하트/별 무늬',
      '두꺼운 통굽의 파스텔 블루 메리제인 구두',
      '전체적으로 밝고 채도 낮은 파스텔 팔레트(핑크·민트·라벤더·크림)',
    ],
  },
  ame: {
    chroma: 'green',
    // 소품이 없는 것만 레퍼런스로 쓴다 — smoking/drug 를 넣으면 담배까지 따라 그린다
    refs: ['ame_default.png', 'ame_dere.png'],
    lock: [
      '검정에 가까운 짙은 트윈테일. 초텐쨩보다 짧고 끝이 뾰족하며 빨간 작은 리본',
      '왼쪽에 X자 헤어핀, 앞머리가 한쪽 눈을 살짝 가린다',
      '탁한 자주빛/모브 눈동자',
      '검은 초커에 붉은 하트 장식',
      '짙은 크림슨 상의 + 검정 하이웨이스트 서스펜더 스커트, 금색 하트 버클',
      '짙은 회색 니하이 삭스',
      '전체적으로 어둡고 채도 낮은 팔레트(블랙·크림슨·차콜)',
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
    '첨부한 레퍼런스 이미지와 **완전히 동일한 캐릭터**를 그려라. 같은 인물이어야 한다.',
    '',
    '■ 절대 유지 (레퍼런스와 똑같이):',
    ...b.lock.map((s) => `- ${s}`),
    '- 픽셀아트풍 디더링 셰이딩, 또렷한 윤곽선, 바깥쪽 흰색 스티커 테두리',
    '- 전신 정면 서 있는 구도',
    '',
    '■ 구도 (반드시 지킬 것):',
    '- 캐릭터 전체가 화면 안에 **완전히** 들어와야 한다. 모자 끝·머리 장식·머리카락·',
    '  신발 바닥 어느 것도 화면 밖으로 잘리면 안 된다.',
    '- 머리 위와 발 아래에 각각 화면 높이의 10% 이상 여백을 남겨라.',
    `- 배경은 **${chroma.name}** 단색으로 꽉 채워라. 그림자·질감·그라데이션 없이`,
    '  완전히 평평하고 **쨍한 원색**이어야 한다. 절대 연하게/파스텔로 만들지 마라.',
    '  (크로마키로 잘라낼 배경이라, 캐릭터에 없는 색이어야 한다)',
    '',
    '■ 이번에 바꿀 것:',
    `- ${change}`,
    '',
    '위에 적힌 "바꿀 것" 외에는 얼굴·체형·화풍·비율을 레퍼런스 그대로 유지할 것.',
    '레퍼런스에 담배 같은 소품이 들려 있어도, 요청에 없으면 따라 그리지 말고 손을 비워둘 것.',
    '텍스트나 워터마크를 넣지 말 것.',
  ].join('\n');
}

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('✖ GEMINI_API_KEY 환경변수가 없다.\n' +
      '  aistudio.google.com 에서 키를 받아 .env.local 에 GEMINI_API_KEY=... 로 넣거나\n' +
      '  GEMINI_API_KEY=... node tools/gen-char.mjs ... 형태로 넘겨라.');
    process.exit(1);
  }
  const char = arg('char'), name = arg('name'), change = arg('prompt');
  const n = Number(arg('n', 3));
  if (!BIBLE[char] || !name || !change) {
    console.error('✖ --char(choten|ame) --name <파일명> --prompt <바꿀 내용> 은 필수다.');
    process.exit(1);
  }

  const refFiles = arg('ref') ? [arg('ref')] : BIBLE[char].refs;
  const parts = [{ text: buildPrompt(char, change, arg('chroma')) }];
  for (const f of refFiles) {
    const p = resolve(ROOT, 'public/char', f);
    if (!existsSync(p)) { console.error(`✖ 레퍼런스 없음: ${p}`); process.exit(1); }
    parts.push({ inline_data: { mime_type: 'image/png', data: readFileSync(p).toString('base64') } });
  }
  console.log(`레퍼런스 ${refFiles.join(', ')} → "${change}" 후보 ${n}장`);

  const outDir = resolve(ROOT, 'tmp/gen');
  mkdirSync(outDir, { recursive: true });

  let saved = 0;
  for (let i = 1; i <= n; i++) {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) {
      console.error(`✖ ${i}번째 실패 (HTTP ${res.status}): ${(await res.text()).slice(0, 400)}`);
      continue;
    }
    const json = await res.json();
    const img = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
    if (!img) {
      // 모델이 이미지 대신 텍스트로 거절했을 때 이유를 보여준다
      const txt = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ');
      console.error(`✖ ${i}번째: 이미지가 안 왔다. ${txt ? '모델 응답: ' + txt.slice(0, 200) : JSON.stringify(json).slice(0, 200)}`);
      continue;
    }
    const b64 = (img.inlineData || img.inline_data).data;
    const out = resolve(outDir, `${char}_${name}_${i}.png`);
    writeFileSync(out, Buffer.from(b64, 'base64'));
    // 비용 산출용 — 이미지 1장이 몇 토큰으로 청구되는지 실측한다
    const u = json.usageMetadata || {};
    console.log(`  ✅ ${out}  [in ${u.promptTokenCount ?? '?'} / out ${u.candidatesTokenCount ?? '?'} / total ${u.totalTokenCount ?? '?'} 토큰]`);
    saved++;
  }
  console.log(saved ? `\n${saved}장 저장. 마음에 드는 걸 골라 public/char/ 로 옮겨라.` : '\n저장된 게 없다.');
}

main().catch((e) => { console.error(e); process.exit(1); });
