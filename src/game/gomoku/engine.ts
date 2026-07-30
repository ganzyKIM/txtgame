/* ════════════════════════════════════════════════════════════════════
   오목(고모쿠) 엔진 — 순수 함수 모듈

   ── AI는 왜 직접 안 짰나 ────────────────────────────────────────
   홀덤은 규칙(족보·사이드팟)이 프로젝트 고유 요구에 맞물려 있어서 직접
   구현했지만, 오목 탐색은 이미 잘 풀린 문제라 검증된 라이브러리
   `@algorithm.ts/gomoku`(MIT, minimax + alpha-beta)를 쓴다. LLM은 쓰지
   않는다 — 전부 정해진 탐색 로직이라 응답이 즉시 나오고 비용이 0이다.

   ── 왜 워커가 필요한가 (실측) ───────────────────────────────────
   탐색은 동기 실행이다. 대부분의 수는 중앙값 1ms로 즉시 끝나지만 승부처에
   들어가면 꼬리가 매우 길다. hard 자기대국 808수 측정 결과:
     deepDepth=16 → p95 2.4s / p99 6.6s / 최악 12.3s
     deepDepth=12 → p95 1.7s / p99 5.6s / 최악  9.2s
     deepDepth=10 → p95 1.0s / p99 3.0s / 최악  5.2s
   메인 스레드에서 이걸 돌리면 그 시간 동안 리페인트·입력이 전부 멈춰
   탭이 죽은 것처럼 보인다. 그래서 탐색은 aiWorker.ts로 내보내고(aiClient.ts
   경유), 여기에 더해 hard의 deepDepth를 낮춰 대기 자체도 줄였다.

   ── 이 파일이 라이브러리 위에 얹는 것 ──────────────────────────
   1. 승리 판정 — 라이브러리가 승자 API를 노출하지 않아 직접 구현.
   2. 난이도 — 탐색 깊이/후보 수 + "실수율(blunder)". 깊이만 낮춰도
      여전히 4목을 다 막아버려서 초보가 이길 수 없다. 확률적으로 최선수
      대신 근처의 그럴듯한 수를 두게 해서 사람이 이길 틈을 만든다.
      실측 차단 실패율: easy 36% / normal 12% / hard 0%.
   3. 상황 분석 — 캐릭터 대사를 상황에 맞게 띄우기 위한 위협/차단 감지.
   ════════════════════════════════════════════════════════════════════ */

import { GomokuSolution, createScoreMap, createGomokuSearcher } from '@algorithm.ts/gomoku';

export const BOARD_SIZE = 15;
export const WIN_LEN = 5;

/** 0 = 사람(흑, 선공), 1 = 상대 캐릭터(백, 후공). 흑이 선공 유리를 갖는 정석 배치. */
export type Player = 0 | 1;
export const HUMAN: Player = 0;
export const AI: Player = 1;

/** -1 = 빈 칸 */
export type Cell = Player | -1;
export type Board = Cell[][];

export type Difficulty = 'easy' | 'normal' | 'hard';

/** 한 수가 만들어낸 최대 위협도 (대사 트리거 판단용) */
export type Threat = 'win' | 'four' | 'openThree' | 'three' | 'none';

/** 캐릭터가 반응할 상황 — 전부 "상대 캐릭터(AI) 시점"의 이름이다 */
export type Situation =
  | 'intro'         // 대국 시작
  | 'ai_threat'     // 내(AI)가 4목/열린3을 만들었다 → 도발
  | 'ai_block'      // 내가 사람의 결정적 수를 막았다
  | 'player_threat' // 사람이 4목/열린3을 만들었다 → 경계
  | 'player_block'  // 사람이 내 결정적 수를 막았다 → 아쉬움
  | 'calm'          // 별일 없는 진행
  | 'win'           // 내가 이겼다
  | 'lose'          // 내가 졌다
  | 'draw';         // 판이 꽉 찼다

export interface Move { r: number; c: number; player: Player }

export interface GomokuState {
  board: Board;
  /** 다음에 둘 사람. 게임이 끝나면 null */
  toAct: Player | null;
  moves: Move[];
  winner: Player | 'draw' | null;
  /** 이긴 5목의 좌표들 (UI 하이라이트용) */
  winLine: [number, number][] | null;
  lastMove: { r: number; c: number } | null;
}

/** 가로·세로·대각 2방향. 반대 방향은 부호를 뒤집어 함께 본다. */
const DIRS: ReadonlyArray<[number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]];

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

export function createBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => new Array<Cell>(BOARD_SIZE).fill(-1));
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function initGame(): GomokuState {
  return {
    board: createBoard(),
    toAct: HUMAN,
    moves: [],
    winner: null,
    winLine: null,
    lastMove: null,
  };
}

/** (r,c)에 player의 돌이 있다고 보고, 한 방향의 연속 개수와 열린 끝 개수를 센다 */
function lineStats(board: Board, r: number, c: number, dr: number, dc: number, player: Player) {
  let count = 1;
  let open = 0;
  const cells: [number, number][] = [[r, c]];
  for (const sign of [1, -1]) {
    let rr = r + dr * sign;
    let cc = c + dc * sign;
    while (inBounds(rr, cc) && board[rr][cc] === player) {
      count++;
      cells.push([rr, cc]);
      rr += dr * sign;
      cc += dc * sign;
    }
    if (inBounds(rr, cc) && board[rr][cc] === -1) open++;
  }
  return { count, open, cells };
}

/**
 * (r,c)에 방금 놓인 player의 돌이 5목을 완성했다면 그 좌표들을, 아니면 null.
 *
 * [렌주] 흑은 **정확히 5목**만 승리다 — 6목 이상(장목)은 승리가 아니라 금수라서
 * 애초에 놓을 수 없다(applyMove가 거부). 백은 제약이 없어 5목 이상이면 승리.
 */
export function findWinLine(board: Board, r: number, c: number, player: Player): [number, number][] | null {
  for (const [dr, dc] of DIRS) {
    const { count, cells } = lineStats(board, r, c, dr, dc, player);
    const won = player === BLACK ? count === WIN_LEN : count >= WIN_LEN;
    if (won) return cells;
  }
  return null;
}

/* ── 렌주 금수 (흑에게만 적용) ───────────────────────────────────
   흑이 선공 유리를 갖기 때문에 렌주 룰은 흑만 아래 세 수를 금지한다.
   백은 아무 제약이 없다.
     · 장목(overline) : 6목 이상
     · 사사(doubleFour) : 한 수로 4를 둘 이상 동시에
     · 삼삼(doubleThree): 한 수로 열린3을 둘 이상 동시에
   5목을 완성하는 수는 금수 판정보다 우선한다(이기는 수는 언제나 합법).

   [단순화] 정식 렌주에는 "그 3을 4로 키우는 수가 그 자체로 금수라서
   실제로는 3이 아닌 경우"를 재귀적으로 걸러내는 규칙이 있는데, 여기서는
   그 재귀 판정까지는 하지 않는다(대부분의 캐주얼 구현과 동일). 실전에서
   차이가 나는 국면은 매우 드물다.
   ──────────────────────────────────────────────────────────────── */

/** 렌주에서 제약을 받는 쪽 = 흑 = 사람 */
const BLACK: Player = HUMAN;

export type Forbidden = 'overline' | 'doubleFour' | 'doubleThree';

export const FORBIDDEN_LABEL: Record<Forbidden, string> = {
  overline:    '장목(6목 이상)은 흑의 금수야',
  doubleFour:  '사사(4-4)는 흑의 금수야',
  doubleThree: '삼삼(3-3)은 흑의 금수야',
};

/** 판 밖은 'wall' — 상대 돌과 같은 "막힌" 취급 */
type LineCell = Cell | 'wall';

/** 한 방향으로 중심에서 ±RADIUS 만큼 뽑은 한 줄. 중심 인덱스는 항상 RADIUS */
const RADIUS = 5;
const CENTER = RADIUS;

function extractLine(board: Board, r: number, c: number, dr: number, dc: number): LineCell[] {
  const out: LineCell[] = [];
  for (let k = -RADIUS; k <= RADIUS; k++) {
    const rr = r + dr * k;
    const cc = c + dc * k;
    out.push(inBounds(rr, cc) ? board[rr][cc] : 'wall');
  }
  return out;
}

/** idx를 포함하는 연속 구간 [lo, hi] (양쪽 모두 player인 칸까지) */
function runBounds(line: LineCell[], idx: number, player: Player): [number, number] {
  let lo = idx;
  let hi = idx;
  while (lo - 1 >= 0 && line[lo - 1] === player) lo--;
  while (hi + 1 < line.length && line[hi + 1] === player) hi++;
  return [lo, hi];
}

function runLength(line: LineCell[], idx: number, player: Player): number {
  const [lo, hi] = runBounds(line, idx, player);
  return hi - lo + 1;
}

/**
 * 이 줄에서 "한 수 더 놓으면 정확히 5목이 되는" 빈 칸들.
 * 단, 그 5목이 중심(방금 놓은 돌)을 포함해야 한다 — 창 안의 무관한
 * 돌 뭉치가 만드는 5는 이 수의 위협이 아니기 때문.
 */
function fiveSpots(line: LineCell[], player: Player): number[] {
  const spots: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== -1) continue;
    const copy = [...line];
    copy[i] = player;
    if (runLength(copy, i, player) !== WIN_LEN) continue;
    const [lo, hi] = runBounds(copy, i, player);
    if (CENTER < lo || CENTER > hi) continue; // 중심을 안 지나는 5는 무관
    spots.push(i);
  }
  return spots;
}

/** 4: 한 수로 5를 만들 자리가 하나 이상 */
function isFourDir(line: LineCell[], player: Player): boolean {
  return fiveSpots(line, player).length >= 1;
}

/** 열린4(사): 5를 만들 자리가 둘 이상 = 막을 수 없는 4 */
function isOpenFourDir(line: LineCell[], player: Player): boolean {
  return fiveSpots(line, player).length >= 2;
}

/**
 * 열린3: 한 수만 더하면 열린4가 되는 모양 (끊긴 3도 포함된다).
 *
 * 먼저 "이미 4인 줄"을 걸러내는 게 중요하다. 4는 정의상 3이 아닌데,
 * 이걸 안 걸러내면 아무 빈칸에 돌을 놓아도 (원래부터 4였으므로) 열린4
 * 조건이 통과해버려서 4를 3으로 중복 계산한다. 그러면 합법인 사삼(4-3)이
 * 삼삼으로 오판되어 정상적인 수가 막힌다.
 */
function isOpenThreeDir(line: LineCell[], player: Player): boolean {
  if (isFourDir(line, player)) return false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] !== -1) continue;
    const copy = [...line];
    copy[i] = player;
    // 새 돌이 우리 돌과 이어져 4를 이뤄야 한다(무관한 뭉치 배제)
    if (runLength(copy, CENTER, player) !== 4) continue;
    if (isOpenFourDir(copy, player)) return true;
  }
  return false;
}

/**
 * 흑이 (r,c)에 두면 금수인지 판정한다. 금수가 아니면 null.
 * board를 잠깐 수정했다가 반드시 되돌린다(호출자 입장에서는 순수 함수).
 */
export function checkForbidden(board: Board, r: number, c: number): Forbidden | null {
  if (!inBounds(r, c) || board[r][c] !== -1) return null;

  board[r][c] = BLACK;
  try {
    let fours = 0;
    let openThrees = 0;
    let exactFive = false;
    let overline = false;

    for (const [dr, dc] of DIRS) {
      const line = extractLine(board, r, c, dr, dc);
      const run = runLength(line, CENTER, BLACK);
      if (run === WIN_LEN) exactFive = true;
      if (run > WIN_LEN) overline = true;
      if (isFourDir(line, BLACK)) fours++;
      if (isOpenThreeDir(line, BLACK)) openThrees++;
    }

    if (exactFive) return null;          // 이기는 수는 금수보다 우선
    if (overline) return 'overline';
    if (fours >= 2) return 'doubleFour';
    if (openThrees >= 2) return 'doubleThree';
    return null;
  } finally {
    board[r][c] = -1;
  }
}

/** 지금 판에서 흑이 둘 수 없는 자리 전부 (UI에 ✕ 표시용) */
export function forbiddenPoints(board: Board): Map<string, Forbidden> {
  const out = new Map<string, Forbidden>();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== -1) continue;
      const f = checkForbidden(board, r, c);
      if (f) out.set(`${r},${c}`, f);
    }
  }
  return out;
}

/**
 * 빈 칸 (r,c)에 player가 두면 어떤 위협이 생기는지.
 *
 * [단순화] 끊긴 3(예: ●_●●)은 실제로는 열린3급으로 위험하지만 여기서는
 * 약하게 평가한다. 이 함수는 **대사 트리거 판단에만** 쓰이고 AI의 실제
 * 강함은 라이브러리 탐색이 담당하므로, 이 근사가 기력에 영향을 주지 않는다.
 */
export function threatAt(board: Board, r: number, c: number, player: Player): Threat {
  if (!inBounds(r, c) || board[r][c] !== -1) return 'none';
  let best: Threat = 'none';
  const rank: Record<Threat, number> = { none: 0, three: 1, openThree: 2, four: 3, win: 4 };
  for (const [dr, dc] of DIRS) {
    // 놓았다고 가정하고 세기 위해 임시로 채운다
    board[r][c] = player;
    const { count, open } = lineStats(board, r, c, dr, dc, player);
    board[r][c] = -1;

    let t: Threat = 'none';
    if (count >= WIN_LEN) t = 'win';
    else if (count === 4 && open >= 1) t = 'four';
    else if (count === 3 && open === 2) t = 'openThree';
    else if (count === 3) t = 'three';

    if (rank[t] > rank[best]) best = t;
  }
  return best;
}

/** player가 두면 4목 이상이 되는(=반드시 막아야 하는) 빈 칸들의 "r,c" 키 집합 */
export function criticalCells(board: Board, player: Player): Set<string> {
  const out = new Set<string>();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== -1) continue;
      const t = threatAt(board, r, c, player);
      if (t === 'win' || t === 'four') out.add(`${r},${c}`);
    }
  }
  return out;
}

export interface ApplyResult {
  ok: boolean;
  state: GomokuState;
  /** 이 수로 인해 캐릭터가 반응할 상황 (불법 수면 undefined) */
  situation?: Situation;
  error?: string;
  /** 금수라서 거부된 경우 그 종류 */
  forbidden?: Forbidden;
}

/**
 * 한 수를 둔다. 순수 함수 — 원본 state는 건드리지 않는다.
 * situation은 항상 "상대 캐릭터(AI) 시점"으로 환산해서 돌려준다.
 */
export function applyMove(state: GomokuState, r: number, c: number): ApplyResult {
  if (state.toAct === null) return { ok: false, state, error: '이미 끝난 대국' };
  if (!inBounds(r, c)) return { ok: false, state, error: '판 밖' };
  if (state.board[r][c] !== -1) return { ok: false, state, error: '이미 돌이 있는 자리' };

  const player = state.toAct;
  const opponent: Player = player === 0 ? 1 : 0;

  // [렌주] 흑의 금수는 아예 두지 못하게 막는다.
  // 정식 렌주는 금수를 두면 그 즉시 패배지만, 캐주얼 플레이에서 모르고 클릭했다가
  // 지면 납득이 안 되므로 "둘 수 없다"고 알려주고 되돌리는 쪽을 택했다.
  if (player === BLACK) {
    const forbidden = checkForbidden(state.board, r, c);
    if (forbidden) {
      return { ok: false, state, error: FORBIDDEN_LABEL[forbidden], forbidden };
    }
  }

  // 두기 "전"에 상대가 노리던 결정적 칸들 — 여기에 두면 차단이다
  const opponentCriticalBefore = criticalCells(state.board, opponent);
  const wasBlock = opponentCriticalBefore.has(`${r},${c}`);
  const threat = threatAt(state.board, r, c, player);

  const board = cloneBoard(state.board);
  board[r][c] = player;

  const winLine = findWinLine(board, r, c, player);
  const boardFull = board.every((row) => row.every((cell) => cell !== -1));

  const next: GomokuState = {
    board,
    toAct: winLine || boardFull ? null : opponent,
    moves: [...state.moves, { r, c, player }],
    winner: winLine ? player : boardFull ? 'draw' : null,
    winLine,
    lastMove: { r, c },
  };

  let situation: Situation;
  if (winLine) {
    situation = player === AI ? 'win' : 'lose';
  } else if (boardFull) {
    situation = 'draw';
  } else if (threat === 'win' || threat === 'four' || threat === 'openThree') {
    situation = player === AI ? 'ai_threat' : 'player_threat';
  } else if (wasBlock) {
    situation = player === AI ? 'ai_block' : 'player_block';
  } else {
    situation = 'calm';
  }

  return { ok: true, state: next, situation };
}

/* ── 난이도 ─────────────────────────────────────────────────────── */

/**
 * "이 점수 이상이면 더 깊이 파본다"는 승격 임계값의 등급.
 * 라이브러리 내부 점수표(con[연속수][열린끝수])에서 유도하는데, 그 유도식은
 * 라이브러리 자신의 기본 설정(createDefaultGomokuSearcher)을 그대로 따랐다 —
 * 점수 스케일이 16의 거듭제곱이라 임의의 숫자를 넣으면 의미가 없다.
 */
type PromotionTier = 'two' | 'three' | 'threeOpen' | 'four';

interface NarrowStage {
  depth: number;
  candidates: number;
  promotion: PromotionTier;
}

export interface DifficultyPreset {
  label: string;
  /** 얕게 넓게 보는 단계들 (앞에서 뒤로 점점 깊고 좁게) */
  narrow: NarrowStage[];
  /** 승부처(4목 이상)에서만 돌리는 정밀 탐색 깊이 */
  deepDepth: number;
  /** 이 확률로 최선수를 버리고 근처의 그럴듯한 수를 둔다 (사람이 이길 틈) */
  blunder: number;
  hint: string;
}

/**
 * hard는 라이브러리 기본 설정과 같은 탐색 구성이다(잘 튜닝돼 있음).
 * easy/normal은 단계를 덜어내 얕게 보게 만들고, 거기에 실수율을 더했다.
 * 승률·실수율 실측치는 파일 상단 주석 참고.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy: {
    label: '살살',
    narrow: [{ depth: 2, candidates: 4, promotion: 'two' }],
    deepDepth: 2,
    blunder: 0.35,
    hint: '얕게 보고 자주 실수해. 오목 처음이면 이걸로.',
  },
  normal: {
    label: '보통',
    narrow: [
      { depth: 2, candidates: 8, promotion: 'two' },
      { depth: 4, candidates: 4, promotion: 'three' },
    ],
    deepDepth: 6,
    blunder: 0.12,
    hint: '기본기는 있지만 가끔 빈틈을 보여.',
  },
  hard: {
    label: '진심',
    narrow: [
      { depth: 2, candidates: 8, promotion: 'two' },
      { depth: 4, candidates: 4, promotion: 'three' },
      { depth: 8, candidates: 2, promotion: 'threeOpen' },
    ],
    // 라이브러리 기본값은 16인데 그러면 한 수 최악이 12초까지 뛴다.
    // 10으로 낮추면 최악 5초/p95 1초로 줄고 기력 차이는 체감되지 않는다
    // (8까지 더 낮춰도 4.7초로 거의 같아서, 강함을 남기는 쪽을 택했다).
    deepDepth: 10,
    blunder: 0,
    hint: '실수 없이 다 막고 함정도 판다. 각오해.',
  },
};

/**
 * 라이브러리 탐색기를 프리셋대로 조립한다.
 * GomokuSolution은 내부 상태를 갖지만, 우리는 매 수마다 새로 만들고
 * init()으로 현재 판을 먹인다 — 이러면 이 모듈 전체가 순수 함수로 유지된다
 * (숨은 인스턴스 상태 없음). 판 하나 만드는 비용은 실측상 무시할 수준.
 */
function buildSolution(preset: DifficultyPreset): GomokuSolution {
  const scoreMap = createScoreMap(WIN_LEN);
  // con[연속 돌 수][열린 끝 수] — 유도식은 라이브러리 기본 설정과 동일하게 맞췄다
  const promotion: Record<PromotionTier, number> = {
    two:       scoreMap.con[WIN_LEN - 3][2] * 4,
    three:     scoreMap.con[WIN_LEN - 2][1] * 2,
    threeOpen: scoreMap.con[WIN_LEN - 2][2] * 4,
    four:      scoreMap.con[WIN_LEN - 1][1],
  };
  const CANDIDATE_GROWTH_FACTOR = 3;

  return new GomokuSolution({
    MAX_ROW: BOARD_SIZE,
    MAX_COL: BOARD_SIZE,
    MAX_ADJACENT: WIN_LEN,
    MAX_DISTANCE_OF_NEIGHBOR: 2,
    CANDIDATE_GROWTH_FACTOR,
    scoreMap,
    deeperSearcher: (mover) => createGomokuSearcher({
      searchContext: mover,
      narrowSearcherOptions: preset.narrow.map((stage) => ({
        MAX_SEARCH_DEPTH: stage.depth,
        MAX_CANDIDATE_COUNT: stage.candidates,
        MIN_PROMOTION_SCORE: promotion[stage.promotion],
        CANDIDATE_GROWTH_FACTOR,
      })),
      deepSearcherOption: {
        MAX_SEARCH_DEPTH: preset.deepDepth,
        MIN_PROMOTION_SCORE: promotion.four,
      },
    }),
  });
}

/** 기존 돌에서 2칸 이내인 빈 칸들 — 실수(blunder)해도 아주 뜬금없진 않게 */
function nearbyEmptyCells(board: Board): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== -1) continue;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (!inBounds(rr, cc)) continue;
          if (board[rr][cc] !== -1) { near = true; break; }
        }
      }
      if (near) out.push([r, c]);
    }
  }
  return out;
}

/**
 * AI의 다음 수를 고른다. rng를 주입할 수 있어 테스트에서 결정적으로 검증 가능.
 * state.toAct가 AI일 때만 호출할 것 (아니면 null 반환).
 */
export function chooseAiMove(
  state: GomokuState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): { r: number; c: number } | null {
  if (state.toAct !== AI) return null;
  const preset = DIFFICULTIES[difficulty];

  // 첫 수(빈 판)면 중앙 근처 — 탐색을 돌릴 필요도 없고 정석이다
  if (state.moves.length === 0) {
    const mid = Math.floor(BOARD_SIZE / 2);
    return { r: mid, c: mid };
  }

  const solution = buildSolution(preset);
  solution.init(state.moves.map((m) => ({ r: m.r, c: m.c, p: m.player })));
  const [br, bc] = solution.minimaxSearch(AI);

  let move: [number, number] | null =
    inBounds(br, bc) && state.board[br][bc] === -1 ? [br, bc] : null;

  // 실수: 확률적으로 최선수를 버린다. 단, "지금 두면 바로 이기는 수"는
  // 절대 버리지 않는다 — 다 이긴 판을 놓치면 실수가 아니라 버그처럼 보인다.
  if (move && preset.blunder > 0 && rng() < preset.blunder) {
    const isWinningNow = threatAt(state.board, move[0], move[1], AI) === 'win';
    if (!isWinningNow) {
      const cands = nearbyEmptyCells(state.board);
      if (cands.length > 0) move = cands[Math.floor(rng() * cands.length)];
    }
  }

  // 탐색이 이상한 값을 주는 방어 케이스 (판이 거의 꽉 찬 상황 등)
  if (!move) {
    const cands = nearbyEmptyCells(state.board);
    if (cands.length === 0) {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) if (state.board[r][c] === -1) return { r, c };
      }
      return null;
    }
    move = cands[Math.floor(rng() * cands.length)];
  }

  return { r: move[0], c: move[1] };
}
