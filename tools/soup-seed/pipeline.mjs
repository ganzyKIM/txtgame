/**
 * 바다거북 수프 시드 파이프라인.
 *
 *   lint     : 출제 에이전트 산출물(드래프트) 스키마·중복·금칙어 검사 (AI 없이 즉시)
 *   assemble : 드래프트 + 검수 verdict 병합 → 최종 시드 (fail-closed: verdict 없으면 폐기)
 *   sql      : 최종 시드 → Supabase SQL Editor 용 INSERT 파일
 *
 * 사용:
 *   node pipeline.mjs lint     --drafts <dir>
 *   node pipeline.mjs assemble --drafts <dir> --verify <dir> --final <dir> [--loaded <dir>]
 *   node pipeline.mjs sql      --final <dir> --out <file>
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MOODS = new Set([
  '오싹한 호러', '뭉클한 감동', '소름 돋는 반전', '일상 속 기묘함',
  '죽음에 얽힌 트릭', '사소한 오해가 부른 비극', '시간·장소의 착각',
  '직업·역할의 함정', '동물이나 사물의 시점', '말장난·언어유희',
  '과학·자연현상 트릭', '따뜻한 미담으로 끝나는 반전',
]);
const BANNED = ['자살', '자해', '강간', '성폭행', '아동 학대', '아동학대'];

function args() {
  const a = process.argv.slice(3);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { get };
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const jsonFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();

export const normText = (s) => String(s).replace(/\s+/g, ' ').trim();
export const scenarioKey = (scenario) => createHash('md5').update(normText(scenario).toLowerCase()).digest('hex');
const sentences = (s) => normText(s).split(/(?<=[.!?。])\s+/).filter(Boolean).length;

/** 항목 하나의 문제 목록 (빈 배열 = 통과) */
export function lintPuzzle(p) {
  const issues = [];
  if (!p.title || typeof p.title !== 'string' || p.title.trim().length < 2 || p.title.length > 16) issues.push('title 길이(2~16자)');
  if (!p.scenario || typeof p.scenario !== 'string') issues.push('scenario 누락');
  else {
    const n = sentences(p.scenario);
    if (n < 1 || n > 6) issues.push(`scenario 문장 수 ${n} (1~6)`);
    if (p.scenario.length < 30) issues.push('scenario 너무 짧음');
    if (p.scenario.length > 400) issues.push('scenario 400자 초과');
  }
  if (!p.solution || typeof p.solution !== 'string') issues.push('solution 누락');
  else {
    if (p.solution.length < 40) issues.push('solution 너무 짧음');
    if (p.solution.length > 700) issues.push('solution 700자 초과');
  }
  if (!Array.isArray(p.keyFacts) || p.keyFacts.length < 3 || p.keyFacts.length > 6) issues.push(`keyFacts 개수 ${p.keyFacts?.length ?? 0} (3~6)`);
  if (!['easy', 'normal', 'hard'].includes(p.difficulty)) issues.push(`difficulty 부적절 (${p.difficulty})`);
  if (!MOODS.has(p.mood)) issues.push(`mood 부적절 (${p.mood})`);
  const all = `${p.title} ${p.scenario} ${p.solution} ${(p.keyFacts ?? []).join(' ')}`;
  for (const w of BANNED) if (all.includes(w)) issues.push(`금칙어: ${w}`);
  if (/\b(A씨|B씨|남자가|여자가|한 남자|한 여자)\b/.test(p.scenario)) issues.push('익명 인물 표현');
  return issues;
}

// ── lint ───────────────────────────────────────────────────────────
function cmdLint() {
  const { get } = args();
  const dir = get('--drafts');
  let total = 0, bad = 0;
  const seenTitle = new Set(), seenKey = new Set();
  for (const f of jsonFiles(dir)) {
    for (const p of readJson(join(dir, f))) {
      total++;
      const issues = lintPuzzle(p);
      const k = scenarioKey(p.scenario ?? '');
      if (seenKey.has(k)) issues.push('시나리오 중복');
      if (seenTitle.has(normText(p.title ?? ''))) issues.push('제목 중복');
      seenKey.add(k); seenTitle.add(normText(p.title ?? ''));
      if (issues.length) { bad++; console.log(`${f} · ${p.title}: ${issues.join(', ')}`); }
    }
  }
  console.log(`${total}문항 중 문제 ${bad}건`);
  process.exit(bad ? 1 : 0);
}

// ── assemble ───────────────────────────────────────────────────────
function cmdAssemble() {
  const { get } = args();
  const draftsDir = get('--drafts'), verifyDir = get('--verify'), finalDir = get('--final'), loadedDir = get('--loaded');
  mkdirSync(finalDir, { recursive: true });
  // 이미 적재한 시나리오는 다시 넣지 않는다 (upsert 라 안전하지만 통계가 흐려진다)
  const loaded = new Set();
  if (loadedDir && existsSync(loadedDir)) {
    for (const f of jsonFiles(loadedDir)) for (const p of readJson(join(loadedDir, f))) loaded.add(scenarioKey(p.scenario));
  }
  const stats = { drafted: 0, pass: 0, fixed: 0, dropVerdict: 0, dropLint: 0, dropMissing: 0, dropDup: 0, dropLoaded: 0 };
  const out = [];
  const seenKey = new Set(), seenTitle = new Set();
  for (const f of jsonFiles(draftsDir)) {
    const drafts = readJson(join(draftsDir, f));
    const vPath = join(verifyDir, f);
    if (!existsSync(vPath)) { stats.dropMissing += drafts.length; console.log(`검수 누락: ${f}`); continue; }
    const verdicts = new Map(readJson(vPath).map((v) => [normText(v.title), v]));
    for (const d of drafts) {
      stats.drafted++;
      const v = verdicts.get(normText(d.title));
      if (!v) { stats.dropMissing++; continue; }
      let p = null;
      if (v.verdict === 'pass') { p = d; stats.pass++; }
      else if (v.verdict === 'fix' && v.fixed && typeof v.fixed === 'object') { p = { ...d, ...v.fixed }; stats.fixed++; }
      else { stats.dropVerdict++; continue; }
      if (lintPuzzle(p).length) { stats.dropLint++; continue; }
      const k = scenarioKey(p.scenario);
      if (loaded.has(k)) { stats.dropLoaded++; continue; }
      if (seenKey.has(k) || seenTitle.has(normText(p.title))) { stats.dropDup++; continue; }
      seenKey.add(k); seenTitle.add(normText(p.title));
      out.push({
        title: normText(p.title), scenario: normText(p.scenario), solution: normText(p.solution),
        keyFacts: p.keyFacts.map(normText), mood: p.mood, difficulty: p.difficulty,
      });
    }
  }
  writeFileSync(join(finalDir, 'soup.json'), JSON.stringify(out, null, 1));
  stats.final = out.length;
  writeFileSync(join(finalDir, '_stats.json'), JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats));
}

// ── sql ────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/'/g, "''");
const sqlArr = (arr) => arr.length ? `array[${arr.map((a) => `'${esc(a)}'`).join(',')}]::text[]` : `'{}'::text[]`;

function cmdSql() {
  const { get } = args();
  const finalDir = get('--final'), outFile = get('--out');
  const rows = [];
  for (const f of jsonFiles(finalDir)) {
    for (const p of readJson(join(finalDir, f))) {
      rows.push(`('${scenarioKey(p.scenario)}','${esc(p.title)}','${esc(p.scenario)}','${esc(p.solution)}',${sqlArr(p.keyFacts)},'${esc(p.mood)}','${p.difficulty}')`);
    }
  }
  const sql = [
    '-- 바다거북 수프 시드 적재 (Claude 오프라인 생성·검수 파이프라인 산출물)',
    '-- 같은 시나리오(scenario_key)가 이미 있으면 본문만 갱신 — banned 는 보호.',
    'insert into public.soup_bank as b (scenario_key, title, scenario, solution, key_facts, mood, difficulty)',
    'values',
    rows.join(',\n'),
    'on conflict (scenario_key) do update set',
    '  title = excluded.title, solution = excluded.solution, key_facts = excluded.key_facts,',
    '  mood = excluded.mood, difficulty = excluded.difficulty, updated_at = now()',
    "where b.status <> 'banned';",
    '',
  ].join('\n');
  writeFileSync(outFile, sql);
  console.log(`SQL ${rows.length}행 → ${outFile}`);
}

const cmd = process.argv[2];
if (cmd === 'lint') cmdLint();
else if (cmd === 'assemble') cmdAssemble();
else if (cmd === 'sql') cmdSql();
else { console.error('usage: pipeline.mjs lint|assemble|sql ...'); process.exit(2); }
