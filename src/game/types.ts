export type Difficulty = 'easy' | 'normal' | 'hard';

/** 출제 모드 — center: 10문제 센터시험(총점), mock: 무제한 모의시험(1문제씩) */
export type ExamMode = 'center' | 'mock';

/** 센터시험 한 런의 문제 수 */
export const CENTER_QUESTIONS = 10;

export interface CategoryInfo {
  /** 내부 키 */
  key: string;
  /** 화면 라벨 */
  label: string;
  /** 버튼 이모지 */
  emoji: string;
  /** 출제 프롬프트에 들어가는 설명 */
  prompt: string;
}

/** Gemini가 비밀리에 생성하는 한 문제 */
export interface Puzzle {
  /** 정답 (유저에게 숨김) */
  answer: string;
  /** 카테고리 라벨 */
  category: string;
  /** 출제 주제/컨셉 */
  theme: string;
  /** 점점 구체화되는 힌트들 (작은 힌트 → 큰 힌트 순서) */
  hints: string[];
  /** 탈락 임계값 — 이보다 많이 열고도 못 맞히면 탈락 (AI가 적절히 산정) */
  maxHints: number;
  /** 정답으로 인정하는 표기 변형들 (로컬 즉시 매칭용) */
  acceptable: string[];
}

export type Phase = 'setup' | 'playing' | 'won' | 'lost';

export interface Guess {
  text: string;
  correct: boolean;
  reason: string;
}

export interface GameState {
  phase: Phase;
  puzzle: Puzzle | null;
  /** 현재까지 공개한 힌트 수 (1 이상이면 playing) */
  revealedCount: number;
  wrongGuesses: number;
  guesses: Guess[];
  difficulty: Difficulty;
}

export interface GameResult {
  category: string;
  theme: string;
  answer: string;
  hintsUsed: number;
  won: boolean;
  score: number;
  rank: string;
}
