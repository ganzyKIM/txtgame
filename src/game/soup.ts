/* ════════════════════════════════════════════════════════════════════
   바다거북 수프(수평사고 퀴즈) — 시나리오 출제 / 질문 응답 / 정답 판정
   ════════════════════════════════════════════════════════════════════ */

export interface SoupPuzzle {
  /** 짧은 제목 */
  title: string;
  /** 유저에게 보여줄 수수께끼 상황 */
  scenario: string;
  /** 숨겨진 진상 전체 (유저에게 숨김) */
  solution: string;
}

export type SoupVerdict = '예' | '아니오' | '상관없음' | '정답';

export interface SoupTurn {
  role: 'user' | 'gm';
  text: string;
  /** GM 응답일 때의 판정 */
  verdict?: SoupVerdict;
}

/** 다양성을 위한 분위기 시드 */
const MOODS = [
  '오싹한 호러', '뭉클한 감동', '소름 돋는 반전', '일상 속 기묘함',
  '죽음에 얽힌 트릭', '사소한 오해가 부른 비극', '시간·장소의 착각',
  '직업·역할의 함정', '동물이나 사물의 시점', '말장난·언어유희',
  '과학·자연현상 트릭', '따뜻한 미담으로 끝나는 반전',
];

/** 코드펜스/잡텍스트를 걷어내고 첫 번째 JSON 객체를 파싱 */
function extractJson(text: string): Record<string, unknown> {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('JSON을 찾을 수 없습니다.');
  }
  return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
}

/** 시나리오 출제용 system instruction */
export function buildSoupSetupPrompt(recentTitles: string[] = []): string {
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
  const seed = Math.floor(Math.random() * 99991) + 10000;
  return [
    '너는 "바다거북 수프"(수평사고 퀴즈, ラテラルシンキング)의 출제자다.',
    '겉보기엔 이상하고 모순돼 보이지만, 숨은 진상을 알면 "아하!" 하고 무릎을 치게 되는 수수께끼를 하나 만든다.',
    '',
    `[이번 분위기] ${mood}`,
    `[랜덤 시드] ${seed} — 이 시드에 따라 매번 전혀 다른 소재를 골라라.`,
    recentTitles.length > 0
      ? `[최근 출제 — 절대 비슷하게 만들지 마라]\n${recentTitles.map((t) => `  • ${t}`).join('\n')}`
      : '',
    '',
    '규칙:',
    '1. scenario(문제)는 유저에게 보여줄 짧은 상황 묘사다. 2~4문장. 기괴하거나 모순돼 보여서 "왜?"라는 의문이 들어야 한다.',
    '   단, scenario만 읽고 바로 답이 보이면 안 된다. 핵심 트릭은 숨겨라.',
    '2. solution(진상)은 그 상황이 왜 일어났는지에 대한 완전한 설명이다. 논리적으로 말이 되어야 하고, 읽으면 반드시 납득이 가야 한다.',
    '   유저는 예/아니오 질문을 던져 이 solution을 추리해낼 것이다. 그러니 solution은 명확하고 일관돼야 한다.',
    '3. 너무 잔인하거나 자극적인 소재는 피하고, 누구나 즐길 수 있는 톤으로.',
    '4. title은 8자 내외의 짧고 흥미로운 제목.',
    '',
    '출력은 아래 형식의 순수 JSON 하나만. 코드펜스(```)나 설명 문장을 절대 덧붙이지 마라:',
    '{"title": string, "scenario": string, "solution": string}',
  ].join('\n');
}

export function parseSoupPuzzle(raw: string): SoupPuzzle {
  const obj = extractJson(raw);
  const title = String(obj.title ?? '수수께끼').trim();
  const scenario = String(obj.scenario ?? '').trim();
  const solution = String(obj.solution ?? '').trim();
  if (!scenario || !solution) {
    throw new Error('출제 결과가 올바르지 않습니다. (시나리오/진상 부족)');
  }
  return { title, scenario, solution };
}

/** 유저의 예/아니오 질문에 답하는 프롬프트 */
export function buildSoupAnswerPrompt(puzzle: SoupPuzzle, question: string): string {
  return [
    '너는 바다거북 수프 퀴즈의 진행자다. 아래 [진상]을 알고 있고, 유저는 모른다.',
    '유저가 던지는 질문에 대해 [진상]에 비추어 정확히 답하라.',
    '',
    `[문제] ${puzzle.scenario}`,
    `[진상] ${puzzle.solution}`,
    `[유저 질문] ${question}`,
    '',
    '판정 규칙:',
    '• 진상에 비추어 "예"이면 verdict="예", "아니오"이면 "아니오".',
    '• 답이 진상과 무관하거나 중요하지 않으면 "상관없음".',
    '• 만약 유저의 질문이 사실상 진상의 핵심을 정확히 짚어냈다면 verdict="정답".',
    '• 예/아니오로 답할 수 없는 모호하거나 개방형 질문이면 "상관없음"으로 두고 comment로 "예/아니오로 물어봐줘" 식으로 안내.',
    '',
    'comment는 진행자 캐릭터의 짧은 한마디(선택). 진상을 직접 누설하지 마라.',
    '',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"verdict": "예"|"아니오"|"상관없음"|"정답", "comment": string}',
  ].join('\n');
}

export interface SoupAnswer {
  verdict: SoupVerdict;
  comment: string;
}

export function parseSoupAnswer(raw: string): SoupAnswer {
  const obj = extractJson(raw);
  let v = String(obj.verdict ?? '상관없음').trim();
  if (!['예', '아니오', '상관없음', '정답'].includes(v)) v = '상관없음';
  return { verdict: v as SoupVerdict, comment: String(obj.comment ?? '').trim() };
}

/** 유저가 외친 "최종 정답"을 진상과 대조 판정하는 프롬프트 */
export function buildSoupGuessPrompt(puzzle: SoupPuzzle, guess: string): string {
  return [
    '너는 바다거북 수프 퀴즈의 판정관이다. 유저가 진상을 맞혔는지 판정하라.',
    '세부 표현이 달라도 핵심 트릭·인과를 제대로 짚었다면 정답으로 인정한다.',
    '핵심을 비껴갔거나 결정적 부분이 틀리면 오답이다.',
    '',
    `[문제] ${puzzle.scenario}`,
    `[진상] ${puzzle.solution}`,
    `[유저의 추리] ${guess}`,
    '',
    '출력은 순수 JSON 하나만 (코드펜스/설명 금지):',
    '{"correct": boolean, "comment": string}  // comment는 한국어 한두 문장. 오답이면 진상을 누설하지 말고 살짝 힌트만.',
  ].join('\n');
}

export interface SoupGuessResult {
  correct: boolean;
  comment: string;
}

export function parseSoupGuess(raw: string): SoupGuessResult {
  const obj = extractJson(raw);
  return {
    correct: Boolean(obj.correct),
    comment: String(obj.comment ?? '').trim(),
  };
}
