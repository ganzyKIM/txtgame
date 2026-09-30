/* ════════════════════════════════════════════════════════════════════
   옷장 — 의상 카탈로그와 해금 규칙

   해금 판정은 서버 my_stats() 한 덩어리만 보고 하는 순수 함수다. 클라가
   따로 진행도를 세거나 저장하지 않는다 — 전적이 진실이고, 기기를 옮겨도
   같은 결과가 나온다. 교복 외의 옷은 전부 조건이 있다. stats 가 없으면
   (로그인 전·조회 실패) 아무 옷도 열리지 않는다.

   마스터 계정은 조건과 무관하게 전부 열리지만, "조건을 실제로 달성했는가"
   (achieved)는 따로 계산해 옷장에 표시하고 해금 축하도 achieved 기준으로 한다.
   ════════════════════════════════════════════════════════════════════ */
import type { MyStats } from '../save/cloudSave';

/** 기본 교복은 의상이 아니라 null 이다 */
export type Costume = 'kimono' | 'bunny' | 'pajama' | 'lounge' | 'casual' | 'summer' | 'knit' | 'nurse';

/** my_stats 에서 뽑아 쓰는 지표 하나 */
export type StatKey =
  | 'plays_total' | 'soup_plays' | 'gomoku_plays' | 'gomoku_wins' | 'center_best'
  | 'holdem_hands' | 'holdem_multi_wins' | 'gomoku_hard_wins' | 'hensachi';

export interface UnlockRule { key: StatKey; need: number; label: string }

export interface CostumeDef {
  id: Costume;
  label: string;
  /** 옷장 카드에 보이는 한 줄 설명 */
  desc: string;
  /** 비어 있으면 항상 열려 있다. 여러 개면 하나만 만족해도 열린다 */
  unlock: UnlockRule[];
}

export const COSTUMES: readonly CostumeDef[] = [
  { id: 'kimono', label: '기모노', desc: '오목 대국 정장. 오목 화면에선 옷장과 무관하게 이 차림',
    unlock: [{ key: 'gomoku_plays', need: 1, label: '오목 1판' }] },
  { id: 'bunny',  label: '바니',   desc: '홀덤 테이블의 딜러 복장',
    unlock: [{ key: 'holdem_hands', need: 10, label: '홀덤 10핸드' }] },
  { id: 'pajama', label: '파자마', desc: '같이 밤새울 준비 완료',
    unlock: [{ key: 'plays_total', need: 5, label: '아무 게임이나 5판' }] },
  { id: 'lounge', label: '룸웨어', desc: '헐렁한 티셔츠에 반바지. 집에서만 보여주는 모습',
    unlock: [{ key: 'soup_plays', need: 1, label: '바다거북 수프 1판 체험' }] },
  { id: 'casual', label: '사복',   desc: '주말의 후드티 차림',
    unlock: [{ key: 'gomoku_wins', need: 3, label: '오목 3승' }] },
  { id: 'summer', label: '여름 원피스', desc: '햇빛 아래 하얀 원피스',
    unlock: [{ key: 'center_best', need: 7000, label: '센터시험 7,000점 이상(70%)' }] },
  { id: 'knit',   label: '니트',   desc: '소매가 손을 덮는 오프숄더 니트와 따뜻한 머그',
    unlock: [
      { key: 'holdem_hands', need: 20, label: '홀덤 20핸드' },
      { key: 'holdem_multi_wins', need: 1, label: '홀덤 멀티 1승' },
    ] },
  { id: 'nurse',  label: '간호사', desc: '차트 들고 회진 중. 아픈 데 없어?',
    unlock: [
      { key: 'gomoku_hard_wins', need: 1, label: '오목 진심 격파 1회' },
      { key: 'hensachi', need: 60, label: '편차치 60 이상' },
    ] },
];

export const COSTUME_BY_ID: Record<Costume, CostumeDef> =
  Object.fromEntries(COSTUMES.map((c) => [c.id, c])) as Record<Costume, CostumeDef>;

export function isCostume(v: unknown): v is Costume {
  return typeof v === 'string' && v in COSTUME_BY_ID;
}

/** my_stats → 규칙이 보는 숫자 */
export function statValue(stats: MyStats, key: StatKey): number {
  switch (key) {
    case 'plays_total':
      return stats.quiz.plays + stats.center.runs + stats.gomoku.plays + stats.holdem.hands + stats.soup.plays;
    case 'soup_plays':        return stats.soup.plays;
    case 'gomoku_plays':      return stats.gomoku.plays;
    case 'gomoku_wins':       return stats.gomoku.wins;
    case 'center_best':       return stats.center.best;
    case 'holdem_hands':      return stats.holdem.hands;
    case 'holdem_multi_wins': return stats.holdem.multi_wins;
    case 'gomoku_hard_wins':  return stats.gomoku.hard_wins;
    case 'hensachi':          return stats.hensachi ?? 0;
  }
}

export interface Progress {
  /** 가장 진행이 앞선 규칙 기준 */
  cur: number;
  need: number;
  label: string;
  /** 0~1 */
  ratio: number;
}

export interface UnlockState {
  /** 옷장에서 입을 수 있는 옷 (마스터면 전부) */
  unlocked: Set<Costume>;
  /** 전적으로 조건을 실제로 달성한 옷 — 해금 축하와 마스터용 달성 표시에 쓴다 */
  achieved: Set<Costume>;
  /** 조건이 있는 의상만 들어 있다 */
  progress: Partial<Record<Costume, Progress>>;
  master: boolean;
}

/** 모든 옷이 열려 있는 관리 계정. 표시용 권한일 뿐이라 클라 판정으로 충분하다 */
export const MASTER_EMAILS: readonly string[] = ['kimdh12307@gmail.com'];

export function isMasterEmail(email: string | null | undefined): boolean {
  return !!email && MASTER_EMAILS.includes(email.trim().toLowerCase());
}

export function evaluateUnlocks(stats: MyStats | null, opts: { master?: boolean } = {}): UnlockState {
  const master = !!opts.master;
  const achieved = new Set<Costume>();
  const progress: Partial<Record<Costume, Progress>> = {};
  for (const c of COSTUMES) {
    if (c.unlock.length === 0) { achieved.add(c.id); continue; }
    let best: Progress | null = null;
    for (const r of c.unlock) {
      const cur = stats ? Math.min(statValue(stats, r.key), r.need) : 0;
      const p: Progress = { cur, need: r.need, label: r.label, ratio: r.need > 0 ? cur / r.need : 1 };
      if (!best || p.ratio > best.ratio) best = p;
    }
    progress[c.id] = best!;
    if (best!.ratio >= 1) achieved.add(c.id);
  }
  const unlocked = master ? new Set<Costume>(COSTUMES.map((c) => c.id)) : new Set(achieved);
  return { unlocked, achieved, progress, master };
}

/** 이전에 열려 있던 집합과 비교해 새로 열린 의상만 (카탈로그 순서) */
export function newlyUnlocked(prev: Iterable<Costume>, now: Set<Costume>): Costume[] {
  const before = new Set(prev);
  return COSTUMES.map((c) => c.id).filter((id) => now.has(id) && !before.has(id) && COSTUME_BY_ID[id].unlock.length > 0);
}
