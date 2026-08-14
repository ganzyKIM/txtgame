/* ════════════════════════════════════════════════════════════════════
   오목(렌주) 엔진 — 순수 함수 모듈

   ── AI는 왜 직접 안 짰나 ────────────────────────────────────────
   홀덤은 규칙(족보·사이드팟)이 프로젝트 고유 요구에 맞물려 있어서 직접
   구현했지만, 오목 탐색은 이미 잘 풀린 문제라 검증된 라이브러리
   `@algorithm.ts/gomoku`(MIT, minimax + alpha-beta)를 쓴다. LLM은 쓰지
   않는다 — 전부 정해진 탐색 로직이라 비용이 0이다.

   라이브러리가 안 주는 것만 이 파일이 얹는다:
     1. 승리 판정 — 승자 API가 없다
     2. 렌주 금수(흑 전용 삼삼·사사·장목)
     3. 난이도 등급 — 깊이만 낮추면 여전히 4목을 다 막아 초보가 못 이긴다
     4. 상황 분석 — 캐릭터 대사 트리거용 위협/차단 감지

   ── 색과 역할을 분리한 이유 ─────────────────────────────────────
   Player(0=흑/선공, 1=백)는 **색**이고, 누가 사람인지는 state.humanSeat이
   따로 갖는다. 싱글에서 흑백을 번갈아 잡기 때문에 "사람=흑"으로 굳히면
   안 된다. 렌주 금수는 언제나 **흑**에게 걸리므로, AI가 흑일 때는 AI의
   착수도 금수를 피해야 한다(chooseAiMove가 처리).

   ── 왜 워커가 필요한가 (실측) ───────────────────────────────────
   탐색은 동기 실행이다. 대부분의 수는 즉시 끝나지만 승부처에서 꼬리가
   길어(진심 난이도 최악 12초) 메인 스레드에서 돌리면 그 시간 동안
   리페인트·입력이 멈춰 탭이 죽은 것처럼 보인다. 그래서 탐색은
   aiWorker.ts로 내보낸다(aiClient.ts 경유).
   ════════════════════════════════════════════════════════════════════ */

import { GomokuSolution, createScoreMap, createGomokuSearcher } from '@algorithm.ts/gomoku';

export const BOARD_SIZE = 15;
export const WIN_LEN = 5;

/** 색. 0=흑(선공, 렌주 금수 대상), 1=백(제약 없음) */
export type Player = 0 | 1;
export const BLACK: Player = 0;
export const WHITE: Player = 1;

export function opponentOf(p: Player): Player {
  return p === BLACK ? WHITE : BLACK;
}

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
  /** 다음에 둘 색. 게임이 끝나면 null */
  toAct: Player | null;
  moves: Move[];
  winner: Player | 'draw' | null;
  /** 이긴 5목의 좌표들 (UI 하이라이트용) */
  winLine: [number, number][] | null;
  lastMove: { r: number; c: number } | null;
  /** 사람이 잡은 색. 싱글에서 판마다 번갈아 바뀐다 */
  humanSeat: Player;
}

/** 이 판에서 AI가 잡은 색 */
export function aiSeatOf(state: GomokuState): Player {
  return opponentOf(state.humanSeat);
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

/** 새 대국. humanSeat으로 사람이 흑/백 중 무엇을 잡을지 정한다. */
export function initGame(humanSeat: Player = BLACK): GomokuState {
  return {
    board: createBoard(),
    toAct: BLACK, // 오목은 언제나 흑 선공
    moves: [],
    winner: null,
    winLine: null,
    lastMove: null,
    humanSeat,
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

/* ── 렌주 금수 (흑에게만 적용) ───────────────────────────────────
   흑이 선공 유리를 갖기 때문에 렌주 룰은 흑만 아래 세 수를 금지한다.
     · 장목(overline) : 6목 이상
     · 사사(doubleFour) : 한 수로 4를 둘 이상 동시에
     · 삼삼(doubleThree): 한 수로 열린3을 둘 이상 동시에
   5목을 완성하는 수는 금수 판정보다 우선한다(이기는 수는 언제나 합법).

   [단순화] 정식 렌주에는 "그 3을 4로 키우는 수가 그 자체로 금수라서
   실제로는 3이 아닌 경우"를 재귀적으로 걸러내는 규칙이 있는데, 여기서는
   그 재귀 판정까지는 하지 않는다(대부분의 캐주얼 구현과 동일).
   ──────────────────────────────────────────────────────────────── */

export type Forbidden = 'overline' | 'doubleFour' | 'doubleThree';

export const FORBIDDEN_LABEL: Record<Forbidden, string> = {
  overline:    '장목(6목 이상)은 흑의 금수야',
  doubleFour:  '사사(4-4)는 흑의 금수야',
  doubleThree: '삼삼(3-3)은 흑의 금수야',
};

/** 판 밖은 'wall' — 상대 돌과 같은 "막힌" 취급 */
type LineCell = Cell | 'wall';

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
 * 그 5목이 중심(방금 놓은 돌)을 포함해야 한다 — 창 안의 무관한 돌 뭉치가
 * 만드는 5는 이 수의 위협이 아니다.
 */
function fiveSpots(line: LineCell[], player: Player): number[] {
  const spots: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== -1) continue;
    const copy = [...line];
    copy[i] = player;
    if (runLength(copy, i, player) !== WIN_LEN) continue;
    const [lo, hi] = runBounds(copy, i, player);
    if (CENTER < lo || CENTER > hi) continue;
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
  const opponent = opponentOf(player);
  const aiSeat = aiSeatOf(state);

  // [렌주] 흑의 금수는 아예 두지 못하게 막는다 — 사람이든 AI든 흑이면 적용.
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
    ...state,
    board,
    toAct: winLine || boardFull ? null : opponent,
    moves: [...state.moves, { r, c, player }],
    winner: winLine ? player : boardFull ? 'draw' : null,
    winLine,
    lastMove: { r, c },
  };

  const moverIsAi = player === aiSeat;
  let situation: Situation;
  if (winLine) {
    situation = moverIsAi ? 'win' : 'lose';
  } else if (boardFull) {
    situation = 'draw';
  } else if (threat === 'win' || threat === 'four' || threat === 'openThree') {
    situation = moverIsAi ? 'ai_threat' : 'player_threat';
  } else if (wasBlock) {
    situation = moverIsAi ? 'ai_block' : 'player_block';
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
  /**
   * 탐색이 즉시 끝나도 최소 이만큼은 뜸을 들인다.
   * 오목은 수 대부분이 1ms 안에 끝나서 그대로 두면 "생각도 안 하고 착 착 놓는"
   * 느낌이 든다. 실제로 고민하는 것처럼 보이도록 난이도별로 여유를 준다.
   */
  ponderMs: number;
  hint: string;
}

/**
 * 진심은 라이브러리 기본값과 같은 탐색 구성이다(잘 튜닝돼 있음).
 * 살살/보통은 단계를 덜어내 얕게 보게 만들고, 거기에 실수율을 더했다.
 * 승률·실수율 실측치는 docs/gomoku-plan.md 참고.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy: {
    label: '살살',
    narrow: [{ depth: 2, candidates: 6, promotion: 'two' }],
    deepDepth: 6,
    blunder: 0.35,
    ponderMs: 700,
    hint: '얕게 보고 자주 실수해. 오목 처음이면 이걸로.',
  },
  normal: {
    label: '보통',
    narrow: [
      { depth: 2, candidates: 8, promotion: 'two' },
      { depth: 4, candidates: 6, promotion: 'three' },
    ],
    deepDepth: 12,
    blunder: 0.12,
    ponderMs: 1000,
    hint: '기본기는 있지만 가끔 빈틈을 보여.',
  },
  hard: {
    label: '진심',
    narrow: [
      { depth: 2, candidates: 8, promotion: 'two' },
      { depth: 4, candidates: 6, promotion: 'three' },
      { depth: 8, candidates: 4, promotion: 'threeOpen' },
    ],
    // 라이브러리 기본값과 동일한 최대 깊이. 승부처에서 한 수에 수 초가 걸릴 수
    // 있지만 탐색이 워커에서 돌아 UI는 멈추지 않는다.
    deepDepth: 16,
    blunder: 0,
    ponderMs: 1300,
    hint: '실수 없이 다 막고 함정도 판다. 각오해.',
  },
};

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

/**
 * player가 "바로 다음 수에 5목을 완성"할 수 있는 국면인가.
 * 이 상황에서 실수를 하면 유일한 방어를 버리고 즉사하므로, 실수를 건너뛰는
 * 조건으로 쓴다. 흑은 금수(장목 등)라 실제로는 못 두는 칸이 있으므로 제외한다.
 */
function opponentCanWinNext(board: Board, player: Player): boolean {
  for (const key of criticalCells(board, player)) {
    const [r, c] = key.split(',').map(Number);
    if (threatAt(board, r, c, player) !== 'win') continue;   // 4목은 아직 즉사가 아니다
    if (player === BLACK && checkForbidden(board, r, c)) continue;
    return true;
  }
  return false;
}

/**
 * 최근 둔 돌들 바로 옆(1칸)의 빈 칸들 — 실수할 때 고를 후보.
 * 판 전체에서 아무 데나 고르면 싸움터와 무관한 구석에 두게 되어
 * "실수"가 아니라 "고장"으로 보인다. 최근 수 주변으로 좁히면 약하긴 해도
 * 국면에 참여하는 수처럼 보인다.
 */
function recentAdjacentCells(state: GomokuState): [number, number][] {
  const recent = state.moves.slice(-4);
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const m of recent) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = m.r + dr;
        const c = m.c + dc;
        if (!inBounds(r, c) || state.board[r][c] !== -1) continue;
        const key = `${r},${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push([r, c]);
      }
    }
  }
  return out;
}

/** 기존 돌에서 2칸 이내인 빈 칸들 — 탐색이 실패했을 때의 최후 폴백용 */
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
 * 라이브러리에 현재 판을 먹이고 최선수를 받는다.
 *
 * excluded에 든 칸은 "상대 돌이 이미 놓여 있다"고 속여서 후보에서 제외한다.
 * AI가 흑일 때 금수 자리를 골랐을 때 다음 후보를 뽑기 위한 장치다. 라이브러리에
 * 특정 칸을 배제하는 API가 없어서 쓰는 우회책이고, 가짜 돌이 평가를 약간
 * 왜곡하지만 어차피 그 칸은 흑이 쓸 수 없으므로 실전 영향은 작다.
 */
function searchBestMove(
  state: GomokuState,
  preset: DifficultyPreset,
  seat: Player,
  excluded: [number, number][],
): [number, number] {
  const solution = buildSolution(preset);
  const pieces = state.moves.map((m) => ({ r: m.r, c: m.c, p: m.player }));
  const fake = opponentOf(seat);
  for (const [r, c] of excluded) pieces.push({ r, c, p: fake });
  solution.init(pieces);
  return solution.minimaxSearch(seat);
}

/**
 * AI의 다음 수를 고른다. rng를 주입할 수 있어 테스트에서 결정적으로 검증 가능.
 * AI 차례가 아니면 null.
 */
export function chooseAiMove(
  state: GomokuState,
  difficulty: Difficulty,
  rng: () => number = Math.random,
): { r: number; c: number } | null {
  const seat = aiSeatOf(state);
  if (state.toAct !== seat) return null;
  const preset = DIFFICULTIES[difficulty];
  const mustAvoidForbidden = seat === BLACK;

  // 빈 판이면 중앙 — 탐색할 필요도 없고 정석이다
  if (state.moves.length === 0) {
    const mid = Math.floor(BOARD_SIZE / 2);
    return { r: mid, c: mid };
  }

  const isPlayable = (r: number, c: number) =>
    inBounds(r, c) && state.board[r][c] === -1 &&
    !(mustAvoidForbidden && checkForbidden(state.board, r, c));

  // 금수를 고르면 그 칸을 배제하고 다시 탐색 (AI가 흑일 때만 발생)
  let move: [number, number] | null = null;
  const excluded: [number, number][] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const [br, bc] = searchBestMove(state, preset, seat, excluded);
    if (!inBounds(br, bc) || state.board[br][bc] !== -1) break;
    if (mustAvoidForbidden && checkForbidden(state.board, br, bc)) {
      excluded.push([br, bc]);
      continue;
    }
    move = [br, bc];
    break;
  }

  /* 실수: 확률적으로 최선수를 버려서 사람이 이길 틈을 준다.
     단 아래 두 경우는 실수가 아니라 "자멸"로 보이므로 절대 건드리지 않는다.
       ① 지금 두면 바로 이기는 수 — 다 이긴 판을 놓치는 건 버그처럼 보인다.
       ② 상대가 다음 수에 5목을 완성할 수 있는 국면 — 유일한 방어를 버리면
          엉뚱한 곳에 두고 즉사한다. 실제로 "AI가 뜬금없는 수를 두고 스스로
          졌다"는 제보가 여기서 나왔다.
     실수하더라도 판 전체에서 아무 칸이나 고르지 않고 최근 수 주변에서 고른다
     — 싸움터와 무관한 구석에 두면 실수가 아니라 고장으로 보인다.
     (차선수를 다시 탐색해 두는 방식도 해봤는데, 차선수가 최선수와 별로
      다르지 않아 보통이 진심과 대등해졌고 탐색이 두 번 돌아 느려졌다.) */
  if (move && preset.blunder > 0 && rng() < preset.blunder) {
    const iWinNow = threatAt(state.board, move[0], move[1], seat) === 'win';
    if (!iWinNow && !opponentCanWinNext(state.board, opponentOf(seat))) {
      const near = recentAdjacentCells(state).filter(([r, c]) => isPlayable(r, c));
      const cands = near.length > 0
        ? near
        : nearbyEmptyCells(state.board).filter(([r, c]) => isPlayable(r, c));
      if (cands.length > 0) move = cands[Math.floor(rng() * cands.length)];
    }
  }

  // 탐색이 이상한 값을 주거나 전부 금수인 방어 케이스
  if (!move) {
    const cands = nearbyEmptyCells(state.board).filter(([r, c]) => isPlayable(r, c));
    if (cands.length > 0) {
      move = cands[Math.floor(rng() * cands.length)];
    } else {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) if (isPlayable(r, c)) return { r, c };
      }
      return null;
    }
  }

  return { r: move[0], c: move[1] };
}
