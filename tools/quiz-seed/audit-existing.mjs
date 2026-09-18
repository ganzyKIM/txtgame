/**
 * 기존 뱅크 재고(게임 내 AI 생성분)의 실존 재검증 — LLM 없이 위키 API만 사용(무료).
 *
 * 배경: 2026-07 무렵 실시간 생성 경로가 "재시도 소진 시 무조건 채택"으로 미검증 정답을
 * 뱅크에 넣었고("사이버드", "사막의 보석 공주"), 출제를 뱅크 우선으로 바꾼 뒤 이들이
 * 더 자주 노출됐다. 시드분(created_by is null)은 이미 근거 기반이라 대상이 아니다.
 *
 * 입력: 검사 대상 answer 목록(JSON 배열 또는 줄바꿈 텍스트)
 * 출력: 위키/위키낱말사전에서 문서를 못 찾은 항목 목록 + banned 처리 SQL
 *
 * 사용: node tools/quiz-seed/audit-existing.mjs --in <list.json> --out <dir>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { groundOne, normAnswerKey } from './fetch-wiki.mjs';

function args() {
  const a = process.argv.slice(2);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { inFile: get('--in'), outDir: get('--out', '.') };
}

const { inFile, outDir } = args();
if (!inFile) { console.error('usage: --in <list.json> --out <dir>'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(inFile, 'utf8').trim();
const items = raw.startsWith('[')
  ? JSON.parse(raw)
  : raw.split('\n').filter(Boolean).map(l => {
      const [answer, category_key] = l.split('\t');
      return { answer: answer.trim(), category_key: (category_key ?? '').trim() };
    });

console.log(`검사 대상 ${items.length}건`);
const missing = [];
const found = [];
let i = 0;
const CONC = 5;
async function worker() {
  while (i < items.length) {
    const it = items[i++];
    const g = await groundOne({ answer: it.answer, acceptable: [] }, it.category_key).catch(() => null);
    if (g) found.push({ ...it, title: g.title, site: g.site });
    else missing.push(it);
    if ((found.length + missing.length) % 25 === 0) console.log(`  ...${found.length + missing.length}/${items.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

missing.sort((a, b) => a.answer.localeCompare(b.answer, 'ko'));
writeFileSync(join(outDir, 'audit_missing.json'), JSON.stringify(missing, null, 1));

const esc = s => String(s).replace(/'/g, "''");
const sql = missing.length === 0
  ? '-- 위키 미확인 항목 없음\n'
  : [
      '-- 위키/위키낱말사전에서 문서를 찾지 못한 기존 AI 생성분을 차단한다.',
      '-- (Claude 시드분 created_by is null 은 대상 아님 — 근거 기반으로 생성됨)',
      'update public.quiz_bank set status = \'banned\', updated_at = now()',
      'where created_by is not null and (answer_key, category_key) in (',
      missing.map(m => `  ('${esc(normAnswerKey(m.answer))}','${esc(m.category_key)}')`).join(',\n'),
      ');',
      '',
      "select count(*) filter (where status='active') as active_left, count(*) as total from public.quiz_bank;",
    ].join('\n');
writeFileSync(join(outDir, 'audit_ban.sql'), sql);

console.log(`실존 확인 ${found.length} / 미확인 ${missing.length}`);
if (missing.length) console.log('미확인 예시:', missing.slice(0, 15).map(m => m.answer).join(', '));
console.log('→', join(outDir, 'audit_ban.sql'));
