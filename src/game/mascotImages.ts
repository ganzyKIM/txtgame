/* ════════════════════════════════════════════════════════════════════
   마스코트 이미지 해석기

   예전에는 상황(LineKind)마다 파일 하나를 손으로 박아 두었다(4표정 시절).
   지금은 의상 8종 × 표정 20여 종이라 그 표는 유지가 불가능하다. 대신:

     상황 → 감정(Mood) → 표정 후보 단계(tier) → 매니페스트에 있는 파일

   로 푼다. 후보는 앞 단계부터 찾고, **같은 단계에 여러 장이 있으면 무작위**로
   골라 같은 상황에서도 그림이 바뀐다. 의상을 입고 있으면 `<form>_<costume>_<face>`
   를 먼저 찾고, 그 옷에 그 표정이 없으면 기본 의상의 같은 표정이 아니라
   **그 옷의 기본 컷**으로 떨어진다 — 옷이 갑자기 바뀌는 게 표정이 안 맞는 것보다
   훨씬 어색하다.
   ════════════════════════════════════════════════════════════════════ */
import { CHAR_FILES } from './charManifest';
import type { Costume } from './wardrobe';

export type Form = 'choten' | 'ame';

export type Mood =
  | 'idle' | 'calm' | 'think' | 'sleepy'
  | 'joy' | 'love' | 'shy' | 'laugh' | 'cheer' | 'wave' | 'smug'
  | 'angry' | 'pout' | 'contempt' | 'jealous'
  | 'surprised' | 'sad' | 'worried';

/** 감정별 표정 후보. 바깥 배열이 단계, 안쪽이 같은 단계의 동급 후보 */
const MOOD_FACES: Record<Mood, string[][]> = {
  idle:      [['default', 'vape', 'smoke', 'smoking', 'heat'], ['peace']],
  calm:      [['vape', 'smoke', 'smoking', 'heat', 'thinking'], ['default']],
  think:     [['thinking'], ['vape', 'smoke', 'smoking'], ['default']],
  sleepy:    [['sleepy'], ['vape', 'smoke', 'smoking'], ['default']],
  joy:       [['joy', 'laugh', 'cheer'], ['dere', 'peace'], ['default']],
  love:      [['love', 'dere', 'shy'], ['joy'], ['default']],
  shy:       [['shy', 'dere'], ['love'], ['default']],
  laugh:     [['laugh', 'joy'], ['dere', 'peace'], ['default']],
  cheer:     [['cheer', 'peace', 'wave'], ['joy'], ['default']],
  wave:      [['wave', 'peace'], ['joy'], ['default']],
  smug:      [['smug', 'smirk', 'peace'], ['contempt'], ['default']],
  angry:     [['angry', 'pout', 'jealous'], ['contempt', 'yandere'], ['default']],
  pout:      [['pout', 'angry'], ['contempt'], ['default']],
  contempt:  [['contempt', 'smug', 'rude', 'yandere'], ['angry', 'pout'], ['default']],
  jealous:   [['jealous', 'yandere', 'pout'], ['angry', 'contempt'], ['default']],
  surprised: [['surprised'], ['shy'], ['default']],
  sad:       [['sad', 'worried'], ['pout', 'shy'], ['default']],
  worried:   [['worried', 'sad'], ['shy'], ['default']],
};

/** 폼별로 쓰지 않는 표정 — 가운뎃손가락은 아메의 도발에만 어울린다 */
const FACE_EXCLUDE: Record<Form, ReadonlySet<string>> = {
  choten: new Set(['rude']),
  ame:    new Set(),
};

const FILES = new Set(CHAR_FILES);

export function hasImage(name: string): boolean {
  return FILES.has(name);
}

export function imagePath(name: string): string {
  return `/char/${name}.png`;
}

/** 의상 기본 컷(무표정). 의상이 없으면 교복 기본 */
export function baseImageName(form: Form, costume: Costume | null): string {
  if (costume && FILES.has(`${form}_${costume}`)) return `${form}_${costume}`;
  return `${form}_default`;
}

/** 감정에 맞는 후보 파일 이름들(가장 앞 단계에서 찾은 것만). 없으면 빈 배열 */
export function candidateNames(form: Form, costume: Costume | null, mood: Mood): string[] {
  const prefix = costume ? `${form}_${costume}_` : `${form}_`;
  const exclude = FACE_EXCLUDE[form];
  for (const tier of MOOD_FACES[mood]) {
    const found = tier.filter((f) => !exclude.has(f)).map((f) => prefix + f).filter((n) => FILES.has(n));
    if (found.length) return found;
  }
  return [];
}

/** 상황에 맞는 이미지 경로 하나. 같은 단계에 여러 장이면 무작위 */
export function pickImage(form: Form, costume: Costume | null, mood: Mood, rand: () => number = Math.random): string {
  const c = candidateNames(form, costume, mood);
  if (c.length === 0) return imagePath(baseImageName(form, costume));
  return imagePath(c[Math.floor(rand() * c.length) % c.length]);
}

/** 마스코트를 눌렀을 때 보여줄 만한 이미지 후보 (의상 차림 전체 표정) */
export function touchImages(form: Form, costume: Costume | null): string[] {
  const prefix = costume ? `${form}_${costume}` : form;
  const names = CHAR_FILES.filter((n) => n === prefix || (n.startsWith(prefix + '_') && !(costume === null && isCostumeFile(form, n))));
  const filtered = names.filter((n) => !FACE_EXCLUDE[form].has(n.slice(prefix.length + 1)));
  return (filtered.length ? filtered : [baseImageName(form, costume)]).map(imagePath);
}

const COSTUME_PREFIXES = ['kimono', 'bunny', 'pajama', 'lounge', 'casual', 'summer', 'knit', 'nurse'];
function isCostumeFile(form: Form, name: string): boolean {
  const rest = name.slice(form.length + 1);
  return COSTUME_PREFIXES.some((c) => rest === c || rest.startsWith(c + '_'));
}
