import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateUnlocks, newlyUnlocked, statValue, COSTUMES, isMasterEmail } from '../src/game/wardrobe';
import type { MyStats } from '../src/save/cloudSave';

function stats(over: Partial<{
  quizPlays: number; centerRuns: number; centerBest: number; hensachi: number | null;
  soupPlays: number; soupNoHint: number; holdemHands: number; holdemMultiWins: number;
  gomokuPlays: number; gomokuWins: number; gomokuHardWins: number; quizWins: number; soupSolved: number;
}> = {}): MyStats {
  return {
    center: { runs: over.centerRuns ?? 0, best: over.centerBest ?? 0, avg: 0 },
    hensachi: over.hensachi ?? null,
    players: 1, beaten: 0,
    quiz: { plays: over.quizPlays ?? 0, wins: over.quizWins ?? 0 },
    soup: { plays: over.soupPlays ?? 0, solved: over.soupSolved ?? 0, no_hint: over.soupNoHint ?? 0 },
    holdem: { hands: over.holdemHands ?? 0, wins: 0, best_pot: 0, multi_wins: over.holdemMultiWins ?? 0 },
    gomoku: { plays: over.gomokuPlays ?? 0, wins: over.gomokuWins ?? 0, draws: 0,
      hard_wins: over.gomokuHardWins ?? 0, multi_plays: 0, multi_wins: 0 },
  };
}

test('로그인 전(stats null)에는 아무 옷도 열리지 않는다', () => {
  const s = evaluateUnlocks(null);
  assert.deepEqual([...s.unlocked], []);
  assert.deepEqual([...s.achieved], []);
  assert.equal(s.progress.pajama?.cur, 0);
  assert.equal(s.progress.pajama?.need, 5);
});

test('합계 판수는 퀴즈·센터·오목·홀덤·수프를 더한다', () => {
  assert.equal(statValue(stats({ quizPlays: 1, centerRuns: 1, gomokuPlays: 1, holdemHands: 1, soupPlays: 1 }), 'plays_total'), 5);
});

test('파자마: 합계 5판 경계', () => {
  assert.ok(!evaluateUnlocks(stats({ quizPlays: 4 })).unlocked.has('pajama'));
  assert.ok(evaluateUnlocks(stats({ quizPlays: 3, gomokuPlays: 2 })).unlocked.has('pajama'));
});

test('룸웨어: 수프 1판이면 해결 못 해도 열린다', () => {
  assert.ok(evaluateUnlocks(stats({ soupPlays: 1 })).unlocked.has('lounge'));
});

test('사복: 오목 3승', () => {
  assert.ok(!evaluateUnlocks(stats({ gomokuWins: 2, gomokuPlays: 9 })).unlocked.has('casual'));
  assert.ok(evaluateUnlocks(stats({ gomokuWins: 3, gomokuPlays: 9 })).unlocked.has('casual'));
});

test('여름 원피스: 센터 최고 7000점', () => {
  assert.ok(!evaluateUnlocks(stats({ centerBest: 6999 })).unlocked.has('summer'));
  assert.ok(evaluateUnlocks(stats({ centerBest: 7000 })).unlocked.has('summer'));
});

test('니트: 홀덤 20핸드 또는 멀티 1승 — 둘 중 하나', () => {
  assert.ok(!evaluateUnlocks(stats({ holdemHands: 19 })).unlocked.has('knit'));
  assert.ok(evaluateUnlocks(stats({ holdemHands: 20 })).unlocked.has('knit'));
  assert.ok(evaluateUnlocks(stats({ holdemHands: 0, holdemMultiWins: 1 })).unlocked.has('knit'));
});

test('간호사: 진심 격파 1회 또는 편차치 60', () => {
  assert.ok(!evaluateUnlocks(stats({ hensachi: 59 })).unlocked.has('nurse'));
  assert.ok(evaluateUnlocks(stats({ hensachi: 60 })).unlocked.has('nurse'));
  assert.ok(evaluateUnlocks(stats({ gomokuHardWins: 1 })).unlocked.has('nurse'));
});

test('진행도는 가장 앞선 규칙을 보여주고 need 로 캡된다', () => {
  const s = evaluateUnlocks(stats({ holdemHands: 5, holdemMultiWins: 0 }));
  assert.equal(s.progress.knit?.label, '홀덤 20핸드');
  assert.equal(s.progress.knit?.cur, 5);
  const over = evaluateUnlocks(stats({ quizPlays: 40 }));
  assert.equal(over.progress.pajama?.cur, 5);
});

test('newlyUnlocked 는 조건부 의상 중 새로 열린 것만, 카탈로그 순서로', () => {
  const now = evaluateUnlocks(stats({ quizPlays: 10, soupPlays: 1, gomokuWins: 3, gomokuPlays: 3 })).achieved;
  assert.deepEqual(newlyUnlocked(['kimono', 'bunny', 'pajama'], now), ['lounge', 'casual']);
  assert.deepEqual(newlyUnlocked([], now), ['kimono', 'pajama', 'lounge', 'casual']);
  assert.deepEqual(newlyUnlocked(now, now), []);
});

test('기모노: 오목 1판, 바니: 홀덤 10핸드', () => {
  assert.ok(!evaluateUnlocks(stats()).unlocked.has('kimono'));
  assert.ok(evaluateUnlocks(stats({ gomokuPlays: 1 })).unlocked.has('kimono'));
  assert.ok(!evaluateUnlocks(stats({ holdemHands: 9 })).unlocked.has('bunny'));
  assert.ok(evaluateUnlocks(stats({ holdemHands: 10 })).unlocked.has('bunny'));
});

test('모든 의상에 조건이 있다 (교복만 기본)', () => {
  assert.ok(COSTUMES.every((c) => c.unlock.length > 0));
});

test('마스터: 전부 열리지만 달성 여부는 전적대로', () => {
  const s = evaluateUnlocks(stats({ soupPlays: 1 }), { master: true });
  assert.equal(s.unlocked.size, 10);
  assert.deepEqual([...s.achieved], ['lounge']);
  assert.equal(s.master, true);
  assert.equal(evaluateUnlocks(null, { master: true }).unlocked.size, 10);
});

test('마스터 이메일 판정은 대소문자·공백 무시', () => {
  assert.ok(isMasterEmail('kimdh12307@gmail.com'));
  assert.ok(isMasterEmail(' KIMDH12307@gmail.com '));
  assert.ok(!isMasterEmail('someone@gmail.com'));
  assert.ok(!isMasterEmail(null));
});

test('카탈로그에는 9종이 있고 id 가 겹치지 않는다', () => {
  assert.equal(new Set(COSTUMES.map((c) => c.id)).size, 10);
});

test('수영복: 다섯 조건을 전부 채워야 열린다 (AND)', () => {
  const almost = { quizPlays: 50, centerBest: 8000, gomokuHardWins: 3, holdemMultiWins: 2, soupNoHint: 0 };
  const s1 = evaluateUnlocks(stats(almost));
  assert.ok(!s1.unlocked.has('swim'), '넷만 채우면 안 열린다');
  assert.equal(s1.progress.swim?.cur, 4);
  assert.equal(s1.progress.swim?.need, 5);
  assert.equal(s1.progress.swim?.parts?.length, 5);
  assert.equal(s1.progress.swim?.parts?.filter((x) => x.ok).length, 4);
  assert.ok(s1.progress.swim?.parts?.some((x) => !x.ok && x.label.includes('힌트 없이')));
  const s2 = evaluateUnlocks(stats({ ...almost, soupNoHint: 1 }));
  assert.ok(s2.unlocked.has('swim'));
  assert.ok(s2.achieved.has('swim'));
  // 다른 옷들처럼 OR 로 새지 않는다
  assert.ok(!evaluateUnlocks(stats({ centerBest: 10000 })).unlocked.has('swim'));
});

test('성녀·흑미사(2026-10-06): 퀴즈 10승 또는 수프 정답 5회 중 하나', () => {
  assert.ok(!evaluateUnlocks(stats({ quizWins: 9, soupSolved: 4 })).unlocked.has('saint'));
  assert.ok(evaluateUnlocks(stats({ quizWins: 10 })).unlocked.has('saint'));
  assert.ok(evaluateUnlocks(stats({ soupSolved: 5 })).unlocked.has('saint'));
  const p = evaluateUnlocks(stats({ quizWins: 3, soupSolved: 4 })).progress.saint;
  assert.equal(p?.label, '바다거북 수프 정답 5회'); // 더 앞선 쪽(4/5)을 보여 준다
  assert.equal(statValue(stats({ quizWins: 7 }), 'quiz_wins'), 7);
  assert.equal(statValue(stats({ soupSolved: 2 }), 'soup_solved'), 2);
});
