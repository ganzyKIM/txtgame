/**
 * Stage 2: 정답 풀 (Answer Bank)
 * 검증을 통과한 정답을 localStorage에 누적 관리.
 * - 재사용 경로: 신뢰 정답(trusted)은 AI에 힌트만 요청 → 정답 환각 원천 제거
 * - 통계 누적: 플레이 결과가 쌓이면 Stage 4 난이도 보정에 사용
 * - 이의제기 인용 2회 이상 → banned (환각 정답 자동 퇴출)
 */
const BANK_KEY = 'txtgame_bank_v2';

export interface BankEntry {
  answer: string;
  categoryKey: string;
  categoryLabel: string;
  acceptable: string[];
  wikiVerified: boolean;
  /** candidate: 신규·미검증 / trusted: 검증됨·재사용 가능 / banned: 퇴출 */
  status: 'candidate' | 'trusted' | 'banned';
  plays: number;
  wins: number;
  totalHintsUsed: number;
  /** 이의제기 인용 횟수 — 높으면 환각 정답 의심 */
  appealUpheld: number;
  /** AI가 부여한 난이도 라벨 */
  difficultyLabeled: string;
  /** 실제 플레이 결과로 계산한 난이도 */
  difficultyActual?: string;
  lastPlayedAt?: string;
  addedAt: string;
}

export type AnswerBank = Record<string, BankEntry>;

export function normAnswerKey(s: string): string {
  return s.toLowerCase().replace(/[\s·~!@#$%^&*()_+\-=[\]{};:'",.<>/?\\|`'""（）【】]/g, '').trim();
}

function baseNameLocal(s: string): string {
  return s.replace(/\s*[(（【[][^)）】\]]*[)）】\]]\s*$/, '').trim();
}

export function loadBank(): AnswerBank {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    return raw ? (JSON.parse(raw) as AnswerBank) : {};
  } catch { return {}; }
}

function saveBank(bank: AnswerBank): AnswerBank {
  try { localStorage.setItem(BANK_KEY, JSON.stringify(bank)); } catch {}
  return bank;
}

/** 검증 통과한 정답을 풀에 추가(신규) 또는 acceptable 갱신(기존) */
export function addToBank(
  bank: AnswerBank,
  entry: Pick<BankEntry, 'answer' | 'categoryKey' | 'categoryLabel' | 'acceptable' | 'wikiVerified' | 'difficultyLabeled'>,
): AnswerBank {
  const key = normAnswerKey(entry.answer);
  const existing = bank[key];
  if (existing?.status === 'banned') return bank;
  const updated: BankEntry = existing
    ? { ...existing, acceptable: [...new Set([...existing.acceptable, ...entry.acceptable])], wikiVerified: existing.wikiVerified || entry.wikiVerified }
    : { ...entry, status: 'candidate', plays: 0, wins: 0, totalHintsUsed: 0, appealUpheld: 0, addedAt: new Date().toISOString() };
  return saveBank({ ...bank, [key]: updated });
}

/** 게임 종료 후 통계 반영. trusted 승격 조건: plays≥3 && wins≥2 */
export function updateBankStats(
  bank: AnswerBank,
  answerKey: string,
  result: { won: boolean; hintsUsed: number },
): AnswerBank {
  const entry = bank[answerKey];
  if (!entry || entry.status === 'banned') return bank;
  const plays = entry.plays + 1;
  const wins = entry.wins + (result.won ? 1 : 0);
  const totalHintsUsed = entry.totalHintsUsed + result.hintsUsed;
  const status: BankEntry['status'] = plays >= 3 && wins >= 2 ? 'trusted' : entry.status;
  // Stage 4: 실측 난이도 계산
  const winRate = wins / plays;
  const avgHints = totalHintsUsed / plays;
  const difficultyActual =
    winRate >= 0.75 && avgHints <= 2.5 ? 'easy'
    : winRate >= 0.45 && avgHints <= 4.5 ? 'normal'
    : 'hard';
  return saveBank({ ...bank, [answerKey]: { ...entry, plays, wins, totalHintsUsed, status, difficultyActual, lastPlayedAt: new Date().toISOString() } });
}

/** 이의제기 인용 시 호출. 2회 이상 인용 → banned */
export function recordAppealUpheld(bank: AnswerBank, answerKey: string): AnswerBank {
  const entry = bank[answerKey];
  if (!entry) return bank;
  const appealUpheld = entry.appealUpheld + 1;
  const status: BankEntry['status'] = appealUpheld >= 2 ? 'banned' : entry.status;
  return saveBank({ ...bank, [answerKey]: { ...entry, appealUpheld, status } });
}

/**
 * 신뢰 정답 풀에서 이번 출제 후보를 뽑는다.
 * - 같은 카테고리, trusted, 제외 목록에 없음, 난이도 실측이 맞음
 * - 최근 플레이 항목을 앞줄에서 제거해 최신성 편향 방지
 */
export function pickFromBank(
  bank: AnswerBank,
  categoryKey: string,
  recentExclusions: string[],
  difficulty: string,
): BankEntry | null {
  const recentKeys = new Set<string>();
  for (const r of recentExclusions) {
    const k = normAnswerKey(r); if (k) recentKeys.add(k);
    const b = normAnswerKey(baseNameLocal(r)); if (b) recentKeys.add(b);
  }
  const candidates = Object.values(bank).filter(e =>
    e.categoryKey === categoryKey &&
    e.status === 'trusted' &&
    !recentKeys.has(normAnswerKey(e.answer)) &&
    !recentKeys.has(normAnswerKey(baseNameLocal(e.answer))) &&
    (e.difficultyActual === difficulty || e.difficultyLabeled === difficulty),
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Stage 4: 카테고리·난이도별 실측 통계로 난이도 보정 문구를 생성.
 * 데이터가 충분할 때만 반환 — 적으면 빈 문자열.
 */
export function getDifficultyCalibration(bank: AnswerBank, categoryKey: string, difficulty: string): string {
  const relevant = Object.values(bank).filter(
    e => e.categoryKey === categoryKey && e.difficultyLabeled === difficulty && e.plays >= 3,
  );
  if (relevant.length < 3) return '';

  const totalPlays = relevant.reduce((s, e) => s + e.plays, 0);
  const totalWins  = relevant.reduce((s, e) => s + e.wins, 0);
  const totalHints = relevant.reduce((s, e) => s + e.totalHintsUsed, 0);
  const winRate  = totalWins  / totalPlays;
  const avgHints = totalHints / totalPlays;

  const expected: Record<string, [number, number, number, number]> = {
    // [winRate_min, winRate_max, avgHints_min, avgHints_max]
    easy:   [0.60, 1.00, 1.0, 3.0],
    normal: [0.35, 0.70, 2.5, 4.5],
    hard:   [0.00, 0.40, 3.5, 6.0],
  };
  const exp = expected[difficulty];
  if (!exp) return '';

  const lines: string[] = [];
  if (winRate > exp[1]) lines.push(`실제 정답률 ${Math.round(winRate * 100)}%로 너무 높음 — 정답을 더 어렵게 골라라.`);
  else if (winRate < exp[0]) lines.push(`실제 정답률 ${Math.round(winRate * 100)}%로 너무 낮음 — 정답을 조금 쉽게 골라라.`);
  if (avgHints > exp[3]) lines.push(`평균 힌트 소비 ${avgHints.toFixed(1)}개로 많음 — 힌트를 더 함축적으로 만들어라.`);
  else if (avgHints < exp[2]) lines.push(`평균 힌트 소비 ${avgHints.toFixed(1)}개로 적음 — 힌트를 더 충분히 줘라.`);

  if (lines.length === 0) return '';
  return `[실측 난이도 보정 — ${totalPlays}판 기준] ${lines.join(' ')}`;
}
