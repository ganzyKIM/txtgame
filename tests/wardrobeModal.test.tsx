import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import WardrobeModal from '../src/components/WardrobeModal';
import { evaluateUnlocks } from '../src/game/wardrobe';

/* 브라우저 없이 옷장 창이 그려지는지만 본다 — 잠금 표시·진행도·착용 중 배지 */
test('옷장: 로그인 전에는 안내와 잠금 카드가 그려진다', () => {
  const html = renderToStaticMarkup(
    <WardrobeModal form="choten" selected={null} unlocks={evaluateUnlocks(null)} loggedIn={false}
      onSelect={() => {}} onClose={() => {}} />,
  );
  assert.ok(html.includes('로그인하면'));
  assert.ok(html.includes('교복'));
  assert.ok(html.includes('wardrobe-card locked'));
  assert.ok(html.includes('아무 게임이나 5판'));
  assert.ok(html.includes('오목 1판') && html.includes('홀덤 10핸드'), '기모노·바니도 조건 표시');
  assert.ok(html.includes('wardrobe-parts') && html.includes('오목 진심 격파 3회'), '수영복은 체크리스트');
  assert.ok(html.includes('/char/thumb/choten_pajama.png'), '옷장은 축소본을 쓴다');
  assert.ok(html.includes('착용 중'));
});

test('옷장: 열린 의상은 잠금 없이, 선택된 카드는 active', () => {
  const st = evaluateUnlocks({
    center: { runs: 1, best: 7000, avg: 7000 }, hensachi: 50, players: 1, beaten: 0,
    quiz: { plays: 0, wins: 0 }, soup: { plays: 0, solved: 0, no_hint: 0 },
    holdem: { hands: 0, wins: 0, best_pot: 0, multi_wins: 0 },
    gomoku: { plays: 0, wins: 0, draws: 0, hard_wins: 0, multi_plays: 0, multi_wins: 0 },
  });
  const html = renderToStaticMarkup(
    <WardrobeModal form="ame" selected="summer" unlocks={st} loggedIn={true} onSelect={() => {}} onClose={() => {}} />,
  );
  assert.ok(!html.includes('로그인하면'));
  assert.ok(/wardrobe-card active"[^>]*title="햇빛/.test(html), '여름 원피스 카드가 active 이고 잠기지 않았다');
  assert.ok(html.includes('/char/thumb/ame_summer.png'));
  assert.ok(html.includes('wardrobe-card locked') && html.includes('오목 3승'));
});

test('옷장: 마스터는 전부 열리고 달성/미달성이 따로 보인다', () => {
  const stats = {
    center: { runs: 0, best: 0, avg: 0 }, hensachi: null, players: 1, beaten: 0,
    quiz: { plays: 0, wins: 0 }, soup: { plays: 1, solved: 0, no_hint: 0 },
    holdem: { hands: 0, wins: 0, best_pot: 0, multi_wins: 0 },
    gomoku: { plays: 0, wins: 0, draws: 0, hard_wins: 0, multi_plays: 0, multi_wins: 0 },
  };
  const html = renderToStaticMarkup(
    <WardrobeModal form="choten" selected={null} unlocks={evaluateUnlocks(stats, { master: true })} loggedIn={true}
      onSelect={() => {}} onClose={() => {}} />,
  );
  assert.ok(html.includes('마스터 계정'));
  assert.ok(!html.includes('wardrobe-card locked'));
  assert.ok(html.includes('✓ 달성 · 바다거북 수프 1판 체험'));
  assert.ok(html.includes('✗ 미달성 · 오목 3승 (0/3)'));
  assert.ok(html.includes('✗ 미달성 · 복합 조건 5개 전부 (0/5)'));
  assert.ok(html.includes('wardrobe-parts'), '마스터도 수영복 체크리스트가 보인다');
});
