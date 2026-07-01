import type { CategoryInfo, Difficulty, Puzzle } from './types';

/** 프리셋 카테고리 (마지막 자유입력은 별도 처리) */
export const CATEGORIES: CategoryInfo[] = [
  { key: 'person',  label: '인물',       emoji: '👤', bg: 'lib',    prompt: '동서양 역사·현대를 아우르는 실존 유명 인물 (정치가·예술가·과학자·탐험가·운동선수 등 다양한 분야 · 한국/아시아 인물도 포함)' },
  { key: 'movie',   label: '영화·드라마', emoji: '🎬', bg: 'lib',    prompt: '한국·미국·일본·유럽 등 세계 각국의 영화나 드라마 작품 (고전~현대, 장르 무관)' },
  { key: 'anime',   label: '애니·만화',   emoji: '🌸', bg: 'kitchen',prompt: '일본 애니메이션·만화 작품 또는 그 속 캐릭터 (클래식~최신, 장르 무관)' },
  { key: 'game',    label: '게임·캐릭터', emoji: '🎮', bg: 'lib',    prompt: '비디오 게임 작품 또는 게임 속 유명 캐릭터 (콘솔·PC·모바일 무관)' },
  { key: 'music',   label: '음악·가수',   emoji: '🎵', bg: 'kitchen',prompt: '클래식·팝·락·K-POP·재즈·힙합 등 장르를 아울러 유명 음악가·밴드 또는 노래 제목' },
  { key: 'food',    label: '음식·요리',   emoji: '🍜', bg: 'kitchen',prompt: '전 세계 각국의 음식, 요리, 식재료, 디저트, 음료 (아시아·유럽·중동·아메리카 포함)' },
  { key: 'animal',  label: '동물',        emoji: '🐾', bg: 'garden', prompt: '육지·바다·하늘을 아우르는 실존 동물 (포유류·조류·어류·파충류·곤충·심해생물 포함)' },
  { key: 'place',   label: '장소·건축',   emoji: '🗺️', bg: 'garden', prompt: '세계 각국의 유명 도시·나라·자연경관·역사적 건축물·랜드마크 (아시아·아프리카·남미도 포함)' },
  { key: 'history', label: '역사 사건',   emoji: '📜', bg: 'lib',    prompt: '고대부터 현대까지 세계사·한국사의 중요한 사건·전쟁·혁명·조약·발견' },
  { key: 'science', label: '과학·발명',   emoji: '🔬', bg: 'lib',    prompt: '과학적 발견, 유명 발명품, 우주·물리·생물·화학·의학 분야의 현상이나 이론 또는 과학자' },
  { key: 'myth',    label: '신화·전설',   emoji: '🏛️', bg: 'garden', prompt: '그리스·로마·북유럽·한국·이집트·일본·중국 등 세계 각국의 신화 속 인물·사건·신·괴물' },
  { key: 'sport',   label: '스포츠·선수', emoji: '⚽', bg: 'garden', prompt: '축구·야구·농구·테니스·수영·격투기 등 다양한 종목의 유명 선수, 팀, 대회, 역사적 경기' },
  { key: 'otaku',   label: '오타쿠',      emoji: '🎴', bg: 'lib',    prompt: '오타쿠 서브컬처 전반에서, "그 분야 팬이라면 누구나 알 만한 대표적이고 유명한 대상"만 정답으로 골라라. 아래 영역을 번갈아 다루되 애니·만화로만 쏠리지는 마라: ① 유명 비디오게임 작품·캐릭터(JRPG·미소녀게임·비주얼노벨·리듬게임 등) ② 저명한 성우(声優) ③ 널리 알려진 VTuber·인터넷 방송인 ④ 유명 애니/게임송·오타쿠계 아이돌 ⑤ 대표적 라이트노벨 ⑥ 코미케 등 누구나 아는 동인·굿즈 문화의 대표 사례 ⑦ 아키하바라 등 유명 성지·행사 ⑧ 애니메이션·만화 작품/캐릭터. 핵심: 마이너하거나 검증하기 어려운 딥컷(특정 니코니코 밈, 무명 캐릭터 등)은 절대 고르지 마라 — 위키백과에 독립 항목이 있을 만큼 유명하고, 팬이라면 힌트로 충분히 떠올릴 수 있는 대상이어야 한다.' },
];

export const DIFFICULTIES: { key: Difficulty; label: string; note: string }[] = [
  { key: 'easy', label: '쉬움', note: '대중적인 정답 · 힌트도 비교적 친절' },
  { key: 'normal', label: '보통', note: '적당한 난이도' },
  { key: 'hard', label: '어려움', note: '까다로운 정답 · 힌트가 함축적' },
];

const HARD_SELECTION_RULE = [
  '【어려움 전용 — 정답 선택 절차, 반드시 이 순서대로】',
  '  STEP 1. 이 카테고리·주제에서 가장 먼저 떠오르는 후보 5개를 머릿속으로 나열해라.',
  '  STEP 2. 그 5개를 전부 제외 목록에 넣어라. 이것들은 너무 유명하다.',
  '  STEP 3. 제외 목록에 없는 것들 중에서 위키백과 독립 항목이 있는 대상을 골라라.',
  '  STEP 4. 그 대상이 "해당 분야를 꽤 아는 사람도 힌트 없이는 바로 못 맞힐 수준"인지 확인해라.',
  '  → STEP 2의 제외 목록에 있는 것이 answer로 나오면 반드시 다시 골라라.',
  '  → 힌트는 함축적으로, maxHints는 3~4.',
].join('\n');

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  easy: '정답은 누구나 알 만한 아주 대중적인 것으로 고르고, maxHints는 5~7 사이로 넉넉하게 잡아라.',
  normal: '정답은 적당히 알려진 것으로 고르고, maxHints는 4~6 사이로 잡아라.',
  hard: HARD_SELECTION_RULE,
};

/** 팬/마니아 대상 카테고리는 난이도 기준을 한 단계 올려야 함 */
const OTAKU_DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  easy:   '플레이어는 이미 오타쿠/팬이다. 쉬움이라도 "원피스·나루토·드래곤볼" 급의 국민 작품이 아니면 쉽지 않다. 팬이라면 누구나 바로 아는 대표작·대표 캐릭터로 고르고, maxHints는 5~7.',
  normal: '팬 사이에서 유명하지만 일반인은 모를 수도 있는 작품·캐릭터·성우·노래 등 세컨드티어급으로 골라라. "유명하긴 한데 바로 떠오르진 않는" 수준. maxHints는 4~6.',
  hard: HARD_SELECTION_RULE + '\n오타쿠 카테고리 추가 금지: 원피스·나루토·드래곤볼·귀멸·진격·에반게리온·포켓몬·디즈니·마블 같은 세계적 메이저 IP는 STEP 1 목록에 자동 포함으로 간주하고 절대 출제 금지.',
};

/**
 * 매 출제마다 정답의 첫 글자(초성)를 강제로 지정해 답안 공간을 확정적으로 분산.
 * 모델이 '가장 유명한 소수 정답'으로 수렴하는 걸 코드 레벨에서 차단한다.
 */
const CHOSEONG_HINTS: [string, string][] = [
  ['ㄱ', '가·거·고·구·그·기·까·꼬 등'],
  ['ㄴ', '나·너·노·누·느·니 등'],
  ['ㄷ', '다·더·도·두·드·디·따·또 등'],
  ['ㄹ', '라·레·로·루·리 등 (외래어 포함)'],
  ['ㅁ', '마·머·모·무·므·미 등'],
  ['ㅂ', '바·버·보·부·브·비·빠 등'],
  ['ㅅ', '사·서·소·수·스·시·싸 등'],
  ['ㅇ', '아·어·오·우·으·이 등'],
  ['ㅈ', '자·저·조·주·즈·지·짜 등'],
  ['ㅊ', '차·처·초·추·치 등'],
  ['ㅋ', '카·커·코·쿠·크·키 등'],
  ['ㅌ', '타·터·토·투·티 등'],
  ['ㅍ', '파·퍼·포·푸·프·피 등'],
  ['ㅎ', '하·허·호·후·흐·히 등'],
];

/**
 * 매 출제마다 샘플링을 흩뜨리기 위한 "출제 기조" 풀.
 * 시대 × 지역 × 결(角)을 각각 독립 추첨해 조합 공간을 크게 넓힌다 —
 * 단일 축 한 줄로는 모델이 비슷한 정답으로 수렴하기 쉬워, 3차원으로 분산한다.
 * 어느 차원이든 정확성·대중성·난이도를 해치면서까지 억지로 맞추지는 않는 "소프트 선호".
 */
const ERA_POOL = [
  '아주 오래된 고전·고대',
  '근대(19세기~20세기 초)',
  '20세기 중후반',
  '비교적 최근·현대',
  '시대 무관 (가장 적합한 것 우선)',
];
const REGION_POOL = [
  '한국',
  '일본·중화권 등 동아시아',
  '서유럽·북미',
  '동유럽·러시아',
  '중동·아프리카',
  '중남미·동남아 등 비주류권',
  '지역 무관 (가장 적합한 것 우선)',
];
const ANGLE_POOL = [
  '누구나 알지만 이 카테고리에서 의외로 잘 안 다뤄지는 것',
  '대중문화에서 자주 회자된 것',
  '교과서·정통 분야에서 중요하게 다뤄지는 것',
  '한 시대를 풍미했지만 요즘은 덜 언급되는 것',
];

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 출제 프롬프트 버전 — 프롬프트를 고칠 때마다 올린다. 서버 DB에 태깅해 A/B 분석에 쓴다. */
export const PROMPT_VERSION = 'v1';

/** 이번 출제의 다양성 축 (시대·지역·결). 저장용으로 밖에서 뽑아 프롬프트에 주입한다. */
export interface GenAxes { era: string; region: string; angle: string; }
export function pickGenAxes(): GenAxes {
  return { era: pick(ERA_POOL), region: pick(REGION_POOL), angle: pick(ANGLE_POOL) };
}

const OTAKU_CATEGORY_KEYS = new Set(['otaku', 'anime', 'game']);

/**
 * 카테고리 키별 상시 금지 정답.
 * 진짜로 절대 출제해선 안 되는 대상만 여기에 넣는다 (예: 저작권 민감, 실존 불분명 등).
 * 단순히 "자주 나온다"는 이유로 넣으면 안 됨 — 그건 제외 목록(플레이 이력)으로 충분하다.
 */
const ALWAYS_EXCLUDE: Record<string, string[]> = {};

/**
 * 출제용 system instruction.
 * Gemini가 정답·힌트·탈락임계값을 엄격한 JSON으로 비밀리에 만들게 한다.
 * 규칙은 중복 없이 단일 출처로 정리한다 — 같은 지침을 여러 곳에 반복하면
 * 모델이 우선순위를 헷갈리고 토큰만 늘어난다.
 */
export function buildSetupPrompt(categoryLabel: string, theme: string, difficulty: Difficulty, recentAnswers: string[] = [], categoryDetail = '', categoryKey = '', diffCalib = '', axes?: GenAxes, failurePatterns: string[] = []): string {
  const ax = axes ?? pickGenAxes();
  const seed = Math.floor(Math.random() * 99991) + 10000;
  const [cho, choEg] = CHOSEONG_HINTS[Math.floor(Math.random() * CHOSEONG_HINTS.length)];
  const diffGuide = OTAKU_CATEGORY_KEYS.has(categoryKey)
    ? OTAKU_DIFFICULTY_GUIDE[difficulty]
    : DIFFICULTY_GUIDE[difficulty];

  // ── 이번 출제 기조 (소프트 선호) ──
  const biasLines = [
    '· 이번 출제 기조 (가능하면 반영하되, 정확성·대중성·난이도를 해치면서까지 억지로 맞추진 마라):',
    `    - 시대: ${ax.era}`,
    `    - 지역: ${ax.region}`,
    `    - 결: ${ax.angle}`,
  ];
  if (difficulty !== 'hard') {
    biasLines.push(`· 초성 가이드: 가능하면 정답 첫 초성을 '${cho}'(${choEg})로 맞춰라. 맞는 실존 정답이 없으면 자유. 초성을 위해 없는 대상을 지어내지 마라.`);
  }

  // ── 금지 정답: 상시 금지 + 플레이 이력 ──
  const alwaysBanned = ALWAYS_EXCLUDE[categoryKey] ?? [];
  const allBanned = [...new Set([...alwaysBanned, ...recentAnswers])];
  const exclusionLines = allBanned.length > 0
    ? [
        `· [금지 정답 ${allBanned.length}개 — 절대 반복 금지] 아래 목록과 같은 대상은 표현을 어떻게 바꿔도 출제 금지. 하나라도 해당하면 즉시 다른 정답으로:`,
        '    ① 동일 대상  ② 표기만 다른 같은 대상(한글/영문/약칭/띄어쓰기)  ③ 같은 대상의 다른 매체·버전·시즌(예: "은하철도 999"가 있으면 "은하철도 999(영화)"도 금지)  ④ 상위 시리즈/스핀오프/리메이크/속편',
        allBanned.map(a => `      • ${a}`).join('\n'),
      ]
    : [];

  // Level 3: 누적된 검증 탈락 패턴 — 같은 실수 반복 방지
  const failureLines = failurePatterns.length > 0
    ? [
        `· [이 카테고리에서 반복적으로 탈락한 패턴 — 절대 반복하지 마라]:`,
        failurePatterns.map(p => `      • ${p}`).join('\n'),
      ]
    : [];

  return [
    '너는 추리 퀴즈 게임의 출제자다. 아래 조건으로 단 하나의 정답을 비밀리에 정하고, 그 정답을 맞히기 위한 힌트들을 만든다.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '【0순위 규칙 — 위키백과 실존 검증】',
    '정답은 한국어(ko.wikipedia.org) 또는 영어(en.wikipedia.org) 위키백과에 "그 대상만 다루는 독립 문서"가 실제로 존재해야 한다.',
    '존재가 조금이라도 의심되면 즉시 다른 정답으로 교체하라. 이 규칙은 난이도·초성·기조 등 다른 모든 지침보다 우선한다.',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '【출제 조건】',
    `· 카테고리: ${categoryLabel}${categoryDetail ? ` — ${categoryDetail}` : ''}`,
    `· 주제·컨셉: ${theme || '지정 없음 (카테고리 안에서 자유롭게 흥미로운 정답을)'}`,
    `· 난이도: ${diffGuide}`,
    ...biasLines,
    diffCalib ? `· ${diffCalib}` : '',
    ...exclusionLines,
    ...failureLines,
    `· 랜덤 시드 ${seed} — 매 출제마다 다른 정답을 골라라.`,
    '',
    '【정답 선택 규칙】',
    '1. 실존: 0순위 규칙을 반드시 통과. 가상·허구·지어낸 대상 금지. (정답은 인물/작품/사건/장소/동식물/개념 등 다양한 형태 가능)',
    '2. 대중성: "해당 카테고리를 좋아하는 일반인 대다수가 이름을 들으면 바로 아는" 수준이어야 한다. 마니아·전문가만 아는 딥컷, 소규모 인디·지역 팀, 검색해도 정보가 거의 없는 대상 금지. (단, 난이도가 어려움이면 위 난이도 지침을 우선한다.)',
    '3. 표기: answer는 한국어 위키백과 문서 제목 기준의 공식 풀네임. 약칭·별명·성(姓)만 쓰기 금지. (예: "미쿠"X→"하츠네 미쿠"O, "손흥민"O)',
    '4. 범주 함정 금지: 힌트가 사실상 특정 구체 대상(예: 고지라)을 묘사한다면, 그것을 포함하는 상위범주(예: 거대괴수 장르)를 정답으로 두지 마라. 힌트가 가리키는 가장 자연스러운 대상을 정답으로 삼아라.',
    '',
    '【힌트 작성 규칙】',
    '· 개수 6~8개. "넓고 모호 → 점점 구체적·결정적" 순서. 앞 1~2개는 범주 수준(특정 불가), 마지막 1~2개는 결정적 단서.',
    '· 정보 계단: 매 힌트가 이전에 없던 새 사실 하나를 더해 후보를 좁힌다(대표작·연도·수상·외형·대사·소속 등 구체적 사실). 시대·지역·외형·업적·관련 인물·별칭 등 측면을 골고루.',
    '· 어조: 전부 존댓말 평서문(~입니다/~습니다/~합니다). 반말·감탄형 금지.',
    `· 카테고리 노출 금지: 플레이어는 카테고리("${categoryLabel}")를 이미 안다. "이 카테고리의 ~입니다", "한국/일본의 유명한 ~입니다"처럼 카테고리 선택만으로 자명한 내용 금지. 정답을 좁히는 구체적 특징만.`,
    '· 정답 이름(또는 그 일부·외국어 표기)을 힌트에 직접 노출 금지. 틀린 사실(환각) 절대 금지.',
    '',
    '【출력 전 체크리스트 — 셋 다 통과해야 출력】',
    '  1. 위키백과 독립 문서가 존재하는가? (실패하면 나머지 볼 것 없이 정답 교체)',
    '  2. 선택한 난이도에 맞는 정답인가?',
    '  3. 금지 목록에 걸리지 않는가?',
    '',
    '【출력 형식】 순수 JSON 하나만. 코드펜스(```)나 설명 문장 금지.',
    '· maxHints: 적정 실력자가 그 안에 맞혀야 하는 힌트 수 상한. 난이도 지침을 따르되 hints 개수 이하.',
    '· acceptable: 정답으로 인정할 표기 변형(한글/영어/약칭/띄어쓰기) 3~6개.',
    '{"answer": string, "hints": string[], "maxHints": number, "acceptable": string[]}',
  ].join('\n');
}

/** 코드펜스/잡텍스트를 걷어내고 첫 번째 JSON 객체를 파싱 */
function extractJson(text: string): unknown {
  let t = text.trim();
  // ```json ... ``` 제거
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 첫 { 부터 마지막 } 까지
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('JSON을 찾을 수 없습니다.');
  }
  return JSON.parse(t.slice(start, end + 1));
}

export function parsePuzzle(
  raw: string,
  categoryLabel: string,
  theme: string,
): Puzzle {
  const obj = extractJson(raw) as Record<string, unknown>;
  const answer = String(obj.answer ?? '').trim();
  const hints = Array.isArray(obj.hints)
    ? obj.hints.map((h) => String(h).trim()).filter(Boolean)
    : [];
  const acceptable = Array.isArray(obj.acceptable)
    ? obj.acceptable.map((a) => String(a).trim()).filter(Boolean)
    : [];
  let maxHints = Number(obj.maxHints);
  if (!Number.isFinite(maxHints) || maxHints < 1) maxHints = Math.max(3, Math.ceil(hints.length * 0.6));
  // 안전장치: 힌트 수를 넘지 않게, 최소 2 이상 (첫 힌트 자동공개 후 최소 한 번은 더 열 수 있게)
  maxHints = Math.max(2, Math.min(maxHints, hints.length));

  if (!answer || hints.length < 2) {
    throw new Error('출제 결과가 올바르지 않습니다. (정답/힌트 부족)');
  }
  if (!acceptable.includes(answer)) acceptable.unshift(answer);

  return { answer, category: categoryLabel, theme, hints, maxHints, acceptable };
}

/** 괄호·버전 접미사를 제거한 기본 이름 (예: "은하철도 999(영화)" → "은하철도 999") */
export function baseName(answer: string): string {
  return answer.replace(/\s*[(（【[][^)）】\]]*[)）】\]]\s*$/, '').trim();
}

/** 정답 비교용 정규화: 공백·문장부호·대소문자 제거 */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`’“”（）【】]/g, '').trim();
}

/**
 * 새로 생성된 퍼즐의 정답이 최근 정답 목록과 "사실상 같은 대상"으로 충돌하는지.
 * 정답·괄호제거형·acceptable 변형을 모두 정규화해 대조하므로,
 * 표기만 살짝 바꾼 중복(영화판/만화판/약칭/띄어쓰기 차이 등)까지 잡아낸다.
 * 프롬프트의 소프트 가드를 뚫고 나온 중복을 코드 레벨에서 확정적으로 차단하는 용도.
 */
export function collidesWithRecent(puzzle: Puzzle, recent: string[]): boolean {
  const recentKeys = new Set<string>();
  for (const r of recent) {
    const k = normKey(r); if (k) recentKeys.add(k);
    const b = normKey(baseName(r)); if (b) recentKeys.add(b);
  }
  if (recentKeys.size === 0) return false;
  const forms = [puzzle.answer, baseName(puzzle.answer), ...puzzle.acceptable];
  return forms.some((f) => {
    const k = normKey(f);
    return k.length > 0 && recentKeys.has(k);
  });
}

/**
 * 이의제기 판정 프롬프트.
 * 저장된 정답을 참고용으로만 제공하고, 오직 힌트 내용만으로 유저 추측을 판정한다.
 * 출제 AI가 환각 정답을 냈을 때를 대비해 힌트가 진실의 기준이 된다.
 */
export function buildAppealPrompt(revealedHints: string[], storedAnswer: string, guess: string): string {
  return [
    '너는 추리 퀴즈의 이의제기 심판관이다.',
    '출제된 정답이 틀렸을 가능성이 있으므로, 저장된 정답에 구애받지 말고 아래 힌트들만을 기준으로 유저의 추측이 맞는지 판정하라.',
    '',
    '[공개된 힌트]',
    revealedHints.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    '',
    `[저장된 정답] ${storedAnswer}  ← 참고용. 이것이 틀렸을 수 있으니 이 값에 끌려가지 마라.`,
    `[유저 추측] ${guess}`,
    '',
    '판정 기준:',
    '  ✔ 힌트들이 유저 추측을 더 잘 가리키면 → correct: true (이의제기 인용)',
    '  ✗ 힌트들이 저장된 정답을 더 잘 가리키면 → correct: false (기각)',
    '  ✗ 힌트들이 둘 다 가리키지 않으면 → correct: false (기각)',
    'reason에는 어떤 근거로 판단했는지 한 문장으로 설명하라. 정답을 직접 노출하지 마라.',
    '',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"correct": boolean, "reason": string}',
  ].join('\n');
}

/** 의미 판정용 프롬프트 (로컬 매칭 실패 시 폴백) */
export function buildJudgePrompt(answer: string, guess: string): string {
  return [
    '너는 추리 퀴즈의 정답 판정관이다. 유저의 추측이 [정답]과 "같은 대상"을 가리키면 정답으로 인정하라.',
    '',
    `[정답] ${answer}`,
    `[유저 추측] ${guess}`,
    '',
    '【정답 인정】 — 같은 대상을 가리키기만 하면 표기가 달라도 인정(유저에게 유도리를 준다):',
    '  • 띄어쓰기/대소문자/한영 표기 차이, 약칭·별명·통칭',
    '  • 정답이 풀네임인데 유저가 그 일부(이름만/성만/핵심어만)를 댔고, 그것이 명백히 [정답]을 가리킬 때 (예: 정답 "하츠네 미쿠" ← 추측 "미쿠")',
    '  • 동일 인물·작품·사건의 다른 이름',
    '【오답】:',
    '  • 서로 다른 구체적 대상. 같은 분야·종류·시대·주제거나 성격이 비슷해도, 다른 사건·인물·작품·장소면 오답.',
    '  • "비슷한 종류의 다른 것"은 절대 인정 금지 (예: 서로 다른 두 반란/전쟁/도시/작품은 오답).',
    '  • 유저 추측이 너무 짧거나 흔해서 [정답] 말고 다른 대상도 가리킬 수 있으면 오답.',
    '',
    '먼저 유저 추측이 무엇을 가리키는지 파악한 뒤 [정답]과 동일 대상인지만 따져라. 애매하면 오답.',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"correct": boolean, "reason": string}  // reason은 한국어 한 문장, 정답을 직접 노출하지 말 것',
  ].join('\n');
}

export function parseJudge(raw: string): { correct: boolean; reason: string } {
  const obj = extractJson(raw) as Record<string, unknown>;
  return {
    correct: Boolean(obj.correct),
    reason: String(obj.reason ?? '').trim(),
  };
}

/**
 * 출제 결과 2차 검증 프롬프트 (싼 모델 전용).
 * 출제 모델과 분리된 "두 번째 눈"으로 환각·힌트 불일치·스포일러를 잡는다.
 * 검증관은 정답을 알고 검사하므로(플레이어와 달리) 각 힌트가 정답을 정확히 묘사하는지
 * 사실 검증이 가능하다 — "힌트와 맞지 않는 정답"을 출제 단계에서 걸러내는 핵심 장치.
 */
export function buildVerifyPrompt(puzzle: Puzzle): string {
  return [
    '너는 추리 퀴즈 검수관이다. 아래 [정답]과 [힌트]를 검사해, 이 문제를 그대로 출제해도 되는지 판정하라.',
    '',
    `[정답] ${puzzle.answer}`,
    '[힌트]',
    puzzle.hints.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    '',
    '다음 중 하나라도 걸리면 ok=false (불합격):',
    '  ① 실존성: [정답]이 실제로 존재하지 않거나, 지어낸·검증 불가능한 대상이다. (위키백과에 실릴 만큼 분명히 실존하는 유명 대상이 아니면 불합격)',
    '  ② 힌트 불일치: 힌트 중 [정답]에 대한 사실이 아니거나, [정답]과 무관하거나, 다른 대상을 묘사하는 것이 하나라도 있다.',
    '  ③ 스포일러: 힌트에 [정답]의 이름(또는 명백한 일부·외국어 표기)이 직접 노출돼 있다.',
    '셋 다 문제없으면 ok=true.',
    '',
    '엄격하게 보되, 사소한 표현 차이만으로 불합격시키지는 마라. 핵심은 "환각·엉터리 정답"과 "정답과 안 맞는 힌트" 두 가지를 걸러내는 것이다.',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"ok": boolean, "problem": string}  // problem은 불합격 사유 한국어 한 문장(합격이면 빈 문자열)',
  ].join('\n');
}

export function parseVerify(raw: string): { ok: boolean; problem: string } {
  const obj = extractJson(raw) as Record<string, unknown>;
  return { ok: Boolean(obj.ok), problem: String(obj.problem ?? '').trim() };
}

/**
 * Stage 3: 힌트 린터 — 코드 레벨 결정론적 품질 검사.
 * AI 호출 없이 즉시 실행. 발견된 문제 목록 반환(빈 배열 = 통과).
 * ① 스포일러: 힌트에 정답 이름 포함
 * ② 중복: 완전히 같은 힌트
 * 카테고리 노출은 소프트 경고만(false positive 방지)
 */
export function lintHints(puzzle: Puzzle, categoryLabel: string): string[] {
  function nk(s: string): string {
    return s.toLowerCase().replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`'""（）【】]/g, '').trim();
  }
  const issues: string[] = [];
  const ansKey  = nk(puzzle.answer);
  const baseKey = nk(baseName(puzzle.answer));
  const catKey  = nk(categoryLabel);
  // 정답 구성 토큰 (3자 이상만 — 짧은 단어 오탐 방지)
  const ansTokens = puzzle.answer.split(/[\s·]/).map(nk).filter(t => t.length >= 3);

  const seenHints = new Set<string>();
  puzzle.hints.forEach((hint, i) => {
    const hk = nk(hint);

    // ① 스포일러
    if (ansKey.length >= 2 && hk.includes(ansKey)) {
      issues.push(`힌트 ${i + 1}: 정답 이름 직접 노출`);
    } else if (baseKey.length >= 2 && baseKey !== ansKey && hk.includes(baseKey)) {
      issues.push(`힌트 ${i + 1}: 정답 기본명 노출`);
    } else if (ansTokens.some(t => t.length >= 4 && hk.includes(t))) {
      issues.push(`힌트 ${i + 1}: 정답 토큰 노출 가능성`);
    }

    // ② 카테고리 이름 (첫 2개 힌트만, 명백한 경우만)
    if (i < 2 && catKey.length >= 3 && hk.includes(catKey)) {
      issues.push(`힌트 ${i + 1}: 카테고리명 직접 노출`);
    }

    // ③ 중복 힌트
    if (seenHints.has(hk)) issues.push(`힌트 ${i + 1}: 중복 힌트`);
    seenHints.add(hk);
  });

  return issues;
}

/**
 * Stage 2(재사용 경로): 정답이 확정된 상태에서 힌트만 새로 생성하는 프롬프트.
 * AI에게 정답을 고르는 역할을 맡기지 않으므로 정답 환각이 원천적으로 불가하다.
 */
export function buildHintOnlyPrompt(answer: string, categoryLabel: string, difficulty: Difficulty, categoryDetail = ''): string {
  const diffGuide = DIFFICULTY_GUIDE[difficulty];
  return [
    `너는 추리 퀴즈 출제자다. 정답은 이미 "${answer}"로 확정돼 있다. 이 정답에 대한 힌트만 새로 만들어라.`,
    '',
    `[카테고리] ${categoryLabel}${categoryDetail ? ` — ${categoryDetail}` : ''}`,
    `[정답] ${answer}  ← 이 값은 변경 불가. 힌트를 만들기 위한 참고 전용.`,
    `[난이도] ${diffGuide}`,
    '',
    '[힌트 작성 규칙]',
    '· 6~8개. 모호→구체 순(앞 1~2개 범주 수준, 마지막 1~2개 결정적).',
    '· 존댓말 평서문(~입니다/~습니다). 반말·감탄형 금지.',
    `· 카테고리("${categoryLabel}") 노출 금지. 정답 이름(또는 그 일부) 힌트에 직접 노출 금지.`,
    '· 각 힌트는 이전에 없던 새 사실 하나를 추가. 틀린 사실 절대 금지.',
    '',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"hints": string[], "maxHints": number, "acceptable": string[]}',
  ].join('\n');
}

/** 힌트 전용 응답 파싱 — answer는 호출부에서 제공 */
export function parseHintOnly(raw: string, answer: string, categoryLabel: string, theme: string, existingAcceptable: string[]): Puzzle {
  const obj = extractJson(raw) as Record<string, unknown>;
  const hints = Array.isArray(obj.hints) ? obj.hints.map(h => String(h).trim()).filter(Boolean) : [];
  const newAcceptable = Array.isArray(obj.acceptable) ? obj.acceptable.map(a => String(a).trim()).filter(Boolean) : [];
  const acceptable = [...new Set([answer, ...existingAcceptable, ...newAcceptable])];
  let maxHints = Number(obj.maxHints);
  if (!Number.isFinite(maxHints) || maxHints < 1) maxHints = Math.max(3, Math.ceil(hints.length * 0.6));
  maxHints = Math.max(2, Math.min(maxHints, hints.length));
  if (hints.length < 2) throw new Error('힌트가 부족합니다.');
  return { answer, category: categoryLabel, theme, hints, maxHints, acceptable };
}
