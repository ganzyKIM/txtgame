import type { CategoryInfo, Difficulty, Puzzle } from './types';

/** 프리셋 카테고리 (마지막 자유입력은 별도 처리) */
export const CATEGORIES: CategoryInfo[] = [
  { key: 'person',  label: '인물',       emoji: '👤', prompt: '동서양 역사·현대를 아우르는 실존 유명 인물 (정치가·예술가·과학자·탐험가·운동선수 등 다양한 분야 · 한국/아시아 인물도 포함)' },
  { key: 'movie',   label: '영화·드라마', emoji: '🎬', prompt: '한국·미국·일본·유럽 등 세계 각국의 영화나 드라마 작품 (고전~현대, 장르 무관)' },
  { key: 'anime',   label: '애니·만화',   emoji: '🌸', prompt: '일본 애니메이션·만화 작품 또는 그 속 캐릭터 (클래식~최신, 장르 무관)' },
  { key: 'game',    label: '게임·캐릭터', emoji: '🎮', prompt: '비디오 게임 작품 또는 게임 속 유명 캐릭터 (콘솔·PC·모바일 무관)' },
  { key: 'music',   label: '음악·가수',   emoji: '🎵', prompt: '클래식·팝·락·K-POP·재즈·힙합 등 장르를 아울러 유명 음악가·밴드 또는 노래 제목' },
  { key: 'food',    label: '음식·요리',   emoji: '🍜', prompt: '전 세계 각국의 음식, 요리, 식재료, 디저트, 음료 (아시아·유럽·중동·아메리카 포함)' },
  { key: 'animal',  label: '동물',        emoji: '🐾', prompt: '육지·바다·하늘을 아우르는 실존 동물 (포유류·조류·어류·파충류·곤충·심해생물 포함)' },
  { key: 'place',   label: '장소·건축',   emoji: '🗺️', prompt: '세계 각국의 유명 도시·나라·자연경관·역사적 건축물·랜드마크 (아시아·아프리카·남미도 포함)' },
  { key: 'history', label: '역사 사건',   emoji: '📜', prompt: '고대부터 현대까지 세계사·한국사의 중요한 사건·전쟁·혁명·조약·발견' },
  { key: 'science', label: '과학·발명',   emoji: '🔬', prompt: '과학적 발견, 유명 발명품, 우주·물리·생물·화학·의학 분야의 현상이나 이론 또는 과학자' },
  { key: 'myth',    label: '신화·전설',   emoji: '🏛️', prompt: '그리스·로마·북유럽·한국·이집트·일본·중국 등 세계 각국의 신화 속 인물·사건·신·괴물' },
  { key: 'sport',   label: '스포츠·선수', emoji: '⚽', prompt: '축구·야구·농구·테니스·수영·격투기 등 다양한 종목의 유명 선수, 팀, 대회, 역사적 경기' },
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
 * 출제용 system instruction.
 * Gemini가 정답·힌트·탈락임계값을 엄격한 JSON으로 비밀리에 만들게 한다.
 */
export function buildSetupPrompt(categoryLabel: string, theme: string, difficulty: Difficulty, recentAnswers: string[] = []): string {
  const seed = Math.floor(Math.random() * 99991) + 10000;
  const axis = DIVERSITY_AXES[Math.floor(Math.random() * DIVERSITY_AXES.length)];
  const [cho, choEg] = CHOSEONG_HINTS[Math.floor(Math.random() * CHOSEONG_HINTS.length)];
  return [
    '너는 추리 퀴즈 게임의 출제자다. 아래 조건으로 단 하나의 정답을 비밀리에 정하고, 그 정답을 맞히기 위한 힌트들을 만든다.',
    '',
    `[카테고리] ${categoryLabel}`,
    theme ? `[주제·컨셉] ${theme}` : '[주제·컨셉] (지정 없음 — 카테고리 안에서 자유롭게 흥미로운 정답을 골라라)',
    `[난이도 지침] ${DIFFICULTY_GUIDE[difficulty]}`,
    `[랜덤 시드] ${seed} — 이 시드는 매 출제마다 다르다. 시드가 다르면 정답도 반드시 달라져야 한다. 절대 직전과 같은 부류의 "가장 유명한 정답"으로 기계적으로 수렴하지 마라.`,
    `[★초성 강제★] 이번 정답의 한글 표기 첫 글자는 반드시 초성 '${cho}' 소리(${choEg})로 시작해야 한다. 이 제약을 그 무엇보다 최우선으로 지켜라. '${cho}'(으)로 시작하지 않는 정답은 절대 허용되지 않는다. (이 카테고리·주제에서 '${cho}' 초성 정답이 도저히 없을 때만, 가장 덜 흔한 다른 초성으로 바꾸되 유명한 1순위 정답은 피하라.)`,
    `[이번 다양성 축] 이번엔 "${axis}" 쪽을 우선 고려해라. (카테고리와 부자연스러우면 무시하고, 대신 평소 잘 고르지 않던 신선한 정답을 골라라.)`,
    recentAnswers.length > 0
      ? [
          `[절대 금지 정답 ${recentAnswers.length}개] 아래 정답들은 이미 출제된 적 있다. 이 목록에 있는 것과 동일하거나, 표기만 다른 같은 대상, 또는 매우 유사한 정답은 절대 선택하지 마라:`,
          recentAnswers.map(a => `  • ${a}`).join('\n'),
          '  → 위 목록의 시대·지역·장르 편중도 파악해, 아직 다루지 않은 영역에서 골라라.',
        ].join('\n')
      : '',
    '[다양성 지침] 카테고리 전체 공간에서 고르게 샘플링해라.',
    '  • 지역(아시아·유럽·아메리카·아프리카 등)과 시대(고대~현대)를 골고루 넘나들어라.',
    '  • 동일 인물·작품·장소가 반복되지 않도록 폭넓게 선택해라.',
    '  • 금지 목록이 특정 시대나 지역에 편중돼 있다면, 그 반대편 영역에서 정답을 골라라.',
    '  • "가장 유명한 한두 개"가 머릿속에 먼저 떠오르면, 그건 일부러 피하고 세 번째·네 번째 후보를 골라라.',
    '',
    '규칙:',
    '1. 정답(answer)은 구체적인 하나의 대상이어야 한다 (사람/작품/사물/장소 등의 고유한 이름).',
    '2. hints는 6~10개. 반드시 "가장 작고 모호한 힌트 → 점점 구체적이고 결정적인 힌트" 순서로 정렬한다. 첫 힌트만 보고는 거의 알 수 없어야 하고, 마지막 힌트는 거의 정답을 가리켜야 한다.',
    '3. 힌트 안에는 정답의 이름(또는 그 일부)을 절대 직접 쓰지 마라.',
    '4. maxHints는 이 문제를 "적절한 실력자라면 그 안에 맞혀야 하는" 힌트 공개 수의 상한이다. 난이도 지침을 따르되 hints 개수를 넘지 않게 한다.',
    '5. acceptable에는 정답으로 인정할 표기 변형(한글/영어/약칭/띄어쓰기 차이 등)을 3~6개 넣는다.',
    '',
    '출력은 아래 형식의 순수 JSON 하나만. 코드펜스(```)나 설명 문장을 절대 덧붙이지 마라:',
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
    '너는 추리 퀴즈의 정답 판정관이다. 유저의 추측이 정답과 같은 대상을 가리키는지 의미로 판정하라.',
    '표기 차이(띄어쓰기/대소문자/한영/약칭/별명/동일 인물·작품의 다른 이름)는 정답으로 인정한다.',
    '다른 대상을 가리키면 오답이다.',
    '',
    `[정답] ${answer}`,
    `[유저 추측] ${guess}`,
    '',
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
