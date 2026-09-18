/**
 * 드래프트 파일 하나를 린트. 힌트 작성 에이전트가 자기 결과를 제출 전에
 * 스스로 검사하는 용도. 문제 있으면 exit 1 + 사유 출력, 없으면 "CLEAN".
 * 사용: node tools/quiz-seed/lint-run.mjs <draft.json> <categoryKey>
 */
import { readFileSync } from 'node:fs';
import { lintAll } from './lint-lib.mjs';

const [file, categoryKey] = process.argv.slice(2);
if (!file || !categoryKey) { console.error('usage: lint-run.mjs <draft.json> <categoryKey>'); process.exit(2); }
const items = JSON.parse(readFileSync(file, 'utf8'));
let bad = 0;
for (const q of items) {
  const issues = lintAll(q, categoryKey);
  if (issues.length) { bad++; console.log(`✗ ${q.answer}: ${issues.join(' / ')}`); }
}
if (bad === 0) console.log(`CLEAN (${items.length}개)`);
process.exit(bad === 0 ? 0 : 1);
