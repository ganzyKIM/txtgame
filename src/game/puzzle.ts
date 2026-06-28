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
  { key: 'otaku',   label: '오타쿠',      emoji: '🎴', bg: 'lib',    prompt: '오타쿠 서브컬처 전반. 아래 하위 영역을 매번 번갈아 폭넓게 다루고, 절대 애니·만화로만 쏠리지 마라: ① 비디오게임 작품·캐릭터(JRPG·미소녀게임·비주얼노벨·리듬게임 등) ② 성우(声優) ③ VTuber·인터넷 방송인 ④ 애니/게임송·오타쿠계 아이돌 ⑤ 라이트노벨 ⑥ 동인·코미케·피규어·프라모델 등 굿즈 문화 ⑦ 아키하바라 등 성지·행사 ⑧ 구체적 고유명사로 특정되는 밈·캐릭터·작품·인물(추상적 용어·장르·현상 자체는 금지 — 반드시 이름으로 특정되는 개별 대상) ⑨ 애니메이션·만화 작품/캐릭터. 이번 정답은 가능한 한 ①~⑧에서 우선 고르고, ⑨(애니·만화)는 가끔만 선택해 전체에서 소수가 되도록 하라. 일본 중심 오타쿠 문화 전반을 균형 있게 아우른다.' },
];

export const DIFFICULTIES: { key: Difficulty; label: string; note: string }[] = [
  { key: 'easy', label: '쉬움', note: '대중적인 정답 · 힌트도 비교적 친절' },
  { key: 'normal', label: '보통', note: '적당한 난이도' },
  { key: 'hard', label: '어려움', note: '까다로운 정답 · 힌트가 함축적' },
];

const DIFFICULTY_GUIDE: Record<Difficulty, string> = {
  easy: '정답은 누구나 알 만한 아주 대중적인 것으로 고르고, maxHints는 5~7 사이로 넉넉하게 잡아라.',
  normal: '정답은 적당히 알려진 것으로 고르고, maxHints는 4~6 사이로 잡아라.',
  hard: '정답은 마니아도 헷갈릴 만큼 까다로운 것으로 고르고, 힌트는 더 함축적으로, maxHints는 3~5 사이로 빡빡하게 잡아라.',
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

/** 매 출제마다 샘플링을 흩뜨리기 위한 다양성 축 (소프트 가이드) */
const DIVERSITY_AXES = [
  '누구나 알지만 이 카테고리에서 자주 안 나오는 의외의 선택',
  '비서구권(아시아·아프리카·중동·중남미) 쪽',
  '비교적 최근·현대적인 것',
  '고전적이고 오래된 것',
  '교과서 1순위가 아닌, 살짝 마이너하지만 흥미로운 것',
  '서양 고전·근대 쪽',
  '대중문화에서 자주 다뤄진 것',
  '전문가·마니아가 좋아할 깊이 있는 것',
];

/**
 * 사실 정확도가 중요한 "지식 카테고리". 여기서는 의외성·마이너 압력을 빼고
 * (그 압력이 작은 모델을 모르는 영역으로 떠밀어 가공의 답을 짓게 만든다)
 * "충분히 검증·기록된 것" 안에서만 시드/지역/시대로 다양성을 확보한다.
 */
const FACT_STRICT_LABELS = new Set([
  '역사 사건', '과학·발명', '인물', '장소·건축', '신화·전설', '스포츠·선수',
]);

/** 지식 카테고리 전용 다양성 축 — 마이너·전문가-깊이 축을 제외해 모호한 영역으로 빠지지 않게 한다 */
const FACT_STRICT_AXES = [
  '누구나 알지만 이 카테고리에서 자주 안 나오는 의외의 선택',
  '비서구권(아시아·아프리카·중동·중남미) 쪽',
  '비교적 최근·현대적인 것',
  '고전적이고 오래된 것',
  '서양 고전·근대 쪽',
  '대중문화에서 자주 다뤄진 것',
];

/**
 * 출제용 system instruction.
 * Gemini가 정답·힌트·탈락임계값을 엄격한 JSON으로 비밀리에 만들게 한다.
 */
export function buildSetupPrompt(categoryLabel: string, theme: string, difficulty: Difficulty, recentAnswers: string[] = [], categoryDetail = ''): string {
  const seed = Math.floor(Math.random() * 99991) + 10000;
  const factStrict = FACT_STRICT_LABELS.has(categoryLabel);
  const axisPool = factStrict ? FACT_STRICT_AXES : DIVERSITY_AXES;
  const axis = axisPool[Math.floor(Math.random() * axisPool.length)];
  const [cho, choEg] = CHOSEONG_HINTS[Math.floor(Math.random() * CHOSEONG_HINTS.length)];
  const diversityBullet = factStrict
    ? '  • 정확성이 최우선이다. 유명세를 피하려고 모호한 대상을 고르지 마라 — "위키백과·교과서에 독립 항목으로 실릴 만큼" 분명히 기록된 실존 대상 안에서 다양성을 확보해라. 실존 여부가 조금이라도 의심되면 고르지 마라.'
    : '  • 매번 똑같은 정답만 반복하지 말고 충분히 알려진 실존 대상들 중에서 폭넓게 골라라.';

  return [
    '너는 추리 퀴즈 게임의 출제자다. 아래 조건으로 단 하나의 정답을 비밀리에 정하고, 그 정답을 맞히기 위한 힌트들을 만든다.',
    '',
    '[★절대원칙 — 실존·사실성★] 정답은 반드시 현실에 실제로 존재하는 검증 가능한 대상이어야 한다. 정답을 정한 직후 "이 대상이 백과사전·교과서에 실제로 기록되어 있는가?"를 스스로 확인하고, 조금이라도 확신이 서지 않으면 확실히 아는 다른 실존 대상으로 바꿔라. 아래의 초성·다양성 등 모든 제약보다 이 원칙이 우선한다 — 제약에 맞는 실존 정답이 없으면 제약을 양보하고 실존 정답을 골라라.',
    '',
    `[카테고리] ${categoryLabel}`,
    categoryDetail ? `[카테고리 상세 범위] ${categoryDetail}` : '',
    theme ? `[주제·컨셉] ${theme}` : '[주제·컨셉] (지정 없음 — 카테고리 안에서 자유롭게 흥미로운 정답을 골라라)',
    `[난이도 지침] ${DIFFICULTY_GUIDE[difficulty]}`,
    `[랜덤 시드] ${seed} — 매 출제마다 다른 시드로 다양한 정답을 골라라.`,
    `[초성 가이드] 가능하면 정답 한글 표기의 첫 초성을 '${cho}'(${choEg})로 맞춰라. 맞는 실존 정답이 없으면 초성은 자유롭게 바꿔라. 초성을 위해 없는 대상을 지어내는 것은 금지.`,
    `[다양성 축] 이번엔 "${axis}" 쪽을 우선 고려해라.`,
    recentAnswers.length > 0
      ? [
          `[금지 정답 ${recentAnswers.length}개] 이미 출제된 정답 — 동일하거나 표기만 다른 같은 대상은 절대 선택하지 마라:`,
          recentAnswers.map(a => `  • ${a}`).join('\n'),
        ].join('\n')
      : '',
    '[다양성 지침] 카테고리 전체에서 고르게 샘플링해라.',
    '  • 지역(아시아·유럽·아메리카·아프리카 등)과 시대(고대~현대)를 골고루 넘나들어라.',
    '  • 동일 인물·작품·장소가 반복되지 않도록 폭넓게 선택해라.',
    diversityBullet,
    '',
    '[출제 규칙]',
    '1. 정답은 실제로 존재하는 대상의 이름이어야 한다. 가상·허구·지어낸 대상은 금지.',
    '   • 정답은 특정 인물/작품/사건/장소/동식물/장르/사조/개념 등 다양한 형태가 될 수 있다.',
    '   • 단, "힌트들이 사실상 특정 구체 대상(예: 고지라)을 묘사하는데, 그것을 포함하는 상위범주(예: 거대괴수 장르)를 정답으로 두는 것"은 금지 — 힌트가 가리키는 가장 자연스러운 대상을 정답으로 삼아라.',
    '2. hints는 6~8개. "넓고 모호한 단서 → 점점 구체적·결정적인 단서" 순서로 정렬한다.',
    '3. [힌트 작성 원칙]',
    '   ① 어조: 모든 힌트를 존댓말 평서문("~입니다/~습니다/~합니다")으로 통일. 반말·감탄형 금지.',
    '   ② 정보의 계단: 각 힌트는 이전 힌트에 없던 새로운 사실 하나를 추가해 후보를 좁혀야 한다.',
    '   ③ 다각도: 시대·지역·분야·외형·업적·관련 인물·별칭 등 서로 다른 측면을 골고루 활용한다.',
    '   ④ 난이도 곡선: 앞 1~2개는 범주 수준(특정 불가), 중간은 구체 속성, 마지막 1~2개는 결정적 단서.',
    '   ⑤ 사실에 근거한 한두 문장으로 깔끔하게. 틀린 사실(환각) 절대 금지.',
    '   ⑥ 정답 이름(또는 그 일부·외국어 표기)을 힌트에 직접 노출하지 마라.',
    '4. maxHints: 적절한 실력자라면 그 안에 맞혀야 하는 힌트 수 상한. 난이도 지침을 따르되 hints 개수를 넘지 않게.',
    '5. acceptable: 정답으로 인정할 표기 변형(한글/영어/약칭/띄어쓰기 등) 3~6개.',
    '',
    '출력은 아래 형식의 순수 JSON 하나만. 코드펜스(```)나 설명 문장 금지:',
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

/** 의미 판정용 프롬프트 (로컬 매칭 실패 시 폴백) */
export function buildJudgePrompt(answer: string, guess: string): string {
  return [
    '너는 추리 퀴즈의 정답 판정관이다. 유저의 추측이 [정답]과 "정확히 같은 대상"을 가리킬 때만 정답으로 인정하라.',
    '정답 인정 = 같은 대상의 표기 차이일 때뿐: 띄어쓰기/대소문자/한영 표기/약칭/별명/동일 인물·작품·사건의 다른 이름.',
    '오답 = 서로 다른 구체적 대상일 때. 같은 분야·종류·시대·주제에 속하거나 성격이 비슷해도, 다른 사건·인물·작품·장소면 무조건 오답이다.',
    '특히 "비슷한 종류의 다른 것"을 절대 정답으로 인정하지 마라 (예: 서로 다른 두 반란/전쟁/도시/작품/인물은 오답).',
    '확신이 서지 않으면 오답으로 판정하라.',
    '',
    `[정답] ${answer}`,
    `[유저 추측] ${guess}`,
    '',
    '먼저 유저의 추측이 무엇을 가리키는지 스스로 파악한 뒤, 그것이 [정답]과 동일한 대상인지만 따져라.',
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
