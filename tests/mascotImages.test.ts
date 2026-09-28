import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateNames, pickImage, baseImageName, touchImages, hasImage } from '../src/game/mascotImages';

test('매니페스트에 기본 컷과 새 표정이 들어 있다', () => {
  assert.ok(hasImage('choten_default'));
  assert.ok(hasImage('ame_default'));
  assert.ok(hasImage('choten_joy'));
  assert.ok(hasImage('ame_nurse_shy'));
});

test('기본 의상: joy 는 새 표정(joy/laugh/cheer)에서 고른다', () => {
  const c = candidateNames('choten', null, 'joy');
  assert.deepEqual(c.sort(), ['choten_cheer', 'choten_joy', 'choten_laugh']);
});

test('의상 파일이 있으면 의상 접두를 우선한다', () => {
  const c = candidateNames('ame', 'pajama', 'joy');
  assert.deepEqual(c, ['ame_pajama_joy']);
});

test('의상에 그 표정이 없으면 의상 기본 컷으로 떨어진다 (교복 표정으로 새지 않는다)', () => {
  // 바니에는 sad 계열(sad/worried/pout/shy)이 없다
  assert.deepEqual(candidateNames('choten', 'bunny', 'sad'), []);
  assert.equal(pickImage('choten', 'bunny', 'sad'), '/char/choten_bunny.png');
});

test('초텐은 rude 를 쓰지 않고 아메는 경멸 후보에 넣는다', () => {
  assert.ok(!candidateNames('choten', null, 'contempt').includes('choten_rude'));
  assert.ok(candidateNames('ame', null, 'contempt').includes('ame_rude'));
});

test('무작위는 후보 안에서만 돈다', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(pickImage('choten', null, 'joy', () => i / 40));
  assert.ok(seen.size >= 2);
  for (const s of seen) assert.ok(/^\/char\/choten_(joy|laugh|cheer)\.png$/.test(s), s);
});

test('baseImageName 은 의상 기본 컷, 없으면 default', () => {
  assert.equal(baseImageName('ame', 'nurse'), 'ame_nurse');
  assert.equal(baseImageName('ame', null), 'ame_default');
});

test('touchImages: 기본 의상은 의상 파일을 섞지 않는다', () => {
  const t = touchImages('choten', null);
  assert.ok(t.includes('/char/choten_joy.png'));
  assert.ok(!t.some((p) => p.includes('_kimono') || p.includes('_bunny') || p.includes('_pajama')));
  const k = touchImages('ame', 'knit');
  assert.ok(k.every((p) => p.includes('/ame_knit')));
});
