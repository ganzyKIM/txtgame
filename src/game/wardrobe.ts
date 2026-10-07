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
export type Costume = 'kimono' | 'bunny' | 'pajama' | 'lounge' | 'casual' | 'summer' | 'knit' | 'nurse' | 'saint' | 'swim';

/** my_stats 에서 뽑아 쓰는 지표 하나 */
export type StatKey =
  | 'plays_total' | 'soup_plays' | 'gomoku_plays' | 'gomoku_wins' | 'center_best'
  | 'holdem_hands' | 'holdem_multi_wins' | 'gomoku_hard_wins' | 'hensachi' | 'soup_no_hint'
  | 'quiz_wins' | 'soup_solved';

export interface UnlockRule { key: StatKey; need: number; label: string }

export interface CostumeDef {
  id: Costume;
  label: string;
  /** 옷장 카드에 보이는 한 줄 설명 */
  desc: string;
  /** 비어 있으면 항상 열려 있다. 여러 개면 하나만 만족해도 열린다 */
  unlock: UnlockRule[];
  /** true 면 unlock 의 규칙을 **전부** 만족해야 한다 (복합 조건) */
  all?: boolean;
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
  // 성자 세트(2026-10-06): 초텐은 가톨릭 성녀풍, 아메는 그 짝인 흑미사 사제. 퀴즈·수프 — 지혜를 보인 사람에게(여태 퀴즈 보상 옷이 없었다)
  { id: 'saint',  label: '성녀·흑미사', desc: '초텐은 성녀, 아메는 흑미사 사제. 같은 옷인데 믿는 쪽이 정반대',
    unlock: [
      { key: 'quiz_wins', need: 10, label: '퀴즈 10승' },
      { key: 'soup_solved', need: 5, label: '바다거북 수프 정답 5회' },
    ] },
  // 최종 의상. 다섯 게임을 전부 깊게 파야 하는 복합 조건 — 하나라도 빠지면 안 열린다
  { id: 'swim',   label: '수영복', desc: '여름 한정. 튜브까지 챙겨 왔어',
    all: true,
    unlock: [
      { key: 'plays_total', need: 50, label: '합계 50판' },
      { key: 'center_best', need: 8000, label: '센터시험 8,000점 이상(80%)' },
      { key: 'gomoku_hard_wins', need: 3, label: '오목 진심 격파 3회' },
      { key: 'holdem_multi_wins', need: 2, label: '홀덤 멀티 2승' },
      { key: 'soup_no_hint', need: 1, label: '바다거북 수프 힌트 없이 정답 1회' },
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
    case 'soup_no_hint':      return stats.soup.no_hint;
    case 'quiz_wins':         return stats.quiz.wins;
    case 'soup_solved':       return stats.soup.solved;
  }
}

export interface Progress {
  /** OR 의상: 가장 진행이 앞선 규칙 기준. AND 의상: 만족한 규칙 수 / 전체 */
  cur: number;
  need: number;
  label: string;
  /** 0~1 */
  ratio: number;
  /** AND 의상만: 규칙별 진행. 옷장이 체크리스트로 그린다 */
  parts?: { label: string; cur: number; need: number; ok: boolean }[];
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
    const each = c.unlock.map((r) => {
      const cur = stats ? Math.min(statValue(stats, r.key), r.need) : 0;
      return { cur, need: r.need, label: r.label, ratio: r.need > 0 ? cur / r.need : 1 };
    });
    let p: Progress;
    if (c.all) {
      const parts = each.map((e) => ({ label: e.label, cur: e.cur, need: e.need, ok: e.ratio >= 1 }));
      const done = parts.filter((x) => x.ok).length;
      p = { cur: done, need: parts.length, label: `복합 조건 ${parts.length}개 전부`, ratio: done / parts.length, parts };
    } else {
      p = each.reduce((b, e) => (e.ratio > b.ratio ? e : b));
    }
    progress[c.id] = p;
    if (p.ratio >= 1) achieved.add(c.id);
  }
  const unlocked = master ? new Set<Costume>(COSTUMES.map((c) => c.id)) : new Set(achieved);
  return { unlocked, achieved, progress, master };
}

/** 이전에 열려 있던 집합과 비교해 새로 열린 의상만 (카탈로그 순서) */
export function newlyUnlocked(prev: Iterable<Costume>, now: Set<Costume>): Costume[] {
  const before = new Set(prev);
  return COSTUMES.map((c) => c.id).filter((id) => now.has(id) && !before.has(id) && COSTUME_BY_ID[id].unlock.length > 0);
}
