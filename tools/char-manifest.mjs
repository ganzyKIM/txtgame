#!/usr/bin/env node
/* public/char/*.png 파일명을 훑어 src/game/charManifest.ts 를 생성한다.
   이미지를 추가·삭제하면 `npm run char:manifest` 한 번으로 목록이 맞춰진다.
   손으로 165개 이름을 관리하지 않기 위한 장치 — 코드는 이 목록만 보고
   "이 표정이 이 의상에 있는가"를 판단한다. */
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const names = readdirSync(resolve(ROOT, 'public/char'))
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.slice(0, -4))
  .sort();
const out = `// 자동 생성 — 손으로 고치지 말 것. \`npm run char:manifest\`
// public/char/*.png 의 파일명(확장자 제외). ${names.length}개.
export const CHAR_FILES: readonly string[] = ${JSON.stringify(names, null, 2)};
`;
writeFileSync(resolve(ROOT, 'src/game/charManifest.ts'), out);
console.log(`charManifest.ts: ${names.length} files`);
