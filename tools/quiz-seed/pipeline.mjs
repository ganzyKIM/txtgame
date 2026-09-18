/**
 * 퀴즈 시드 파이프라인 유틸 (3~6단계).
 *
 *   chunk    : 근거 확보본(grounded)을 힌트 작성 에이전트용 작업 파일로 분할
 *   assemble : 드래프트 + 검증 verdict를 병합해 최종 시드 생성 (fail-closed)
 *   sql      : 최종 시드 → Supabase SQL Editor용 INSERT 파일 생성
 *
 * 사용:
 *   node pipeline.mjs chunk    --grounded <dir> --tasks <dir> [--n 12]
 *   node pipeline.mjs assemble --tasks <dir> --drafts <dir> --verify <dir> --final <dir>
 *   node pipeline.mjs sql      --final <dir> --out <dir> [--maxbytes 700000]
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lintAll, normKey, baseName } from './lint-lib.mjs';

const CATEGORY_LABELS = {
  person: '인물', movie: '영화·드라마', anime: '애니·만화', game: '게임·캐릭터',
  music: '음악·가수', food: '음식·요리', animal: '동물', place: '장소·건축',
  history: '역사 사건', science: '과학·발명', myth: '신화·전설', sport: '스포츠·선수',
  otaku: '오타쿠', proverb: '고사성어',
};

function args() {
  const a = process.argv.slice(3);
  const get = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  return { get };
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ── chunk ──────────────────────────────────────────────────────────
function cmdChunk() {
  const { get } = args();
  const groundedDir = get('--grounded'), tasksDir = get('--tasks');
  const N = Number(get('--n', '12'));
  mkdirSync(tasksDir, { recursive: true });
  const files = readdirSync(groundedDir).filter(f => /^[a-z]+\.json$/.test(f));
  let totalChunks = 0, totalItems = 0;
  for (const f of files) {
    const cat = f.replace('.json', '');
    const items = readJson(join(groundedDir, f));
    for (let i = 0; i < items.length; i += N) {
      const chunk = items.slice(i, i + N).map(x => ({
        answer: x.answer, difficulty: x.difficulty, note: x.note,
        acceptable: x.acceptable, sourceTitle: x.sourceTitle, sourceSite: x.sourceSite,
        sourceLang: x.sourceLang, extract: (x.extract ?? '').slice(0, 950),
      }));
      const name = `${cat}_${String(i / N).padStart(3, '0')}.json`;
      writeFileSync(join(tasksDir, name), JSON.stringify(chunk, null, 1));
      totalChunks++;
      totalItems += chunk.length;
    }
  }
  console.log(`작업 파일 ${totalChunks}개 (${totalItems}문항) → ${tasksDir}`);
}

// ── assemble ───────────────────────────────────────────────────────
function cmdAssemble() {
  const { get } = args();
  const tasksDir = get('--tasks'), draftsDir = get('--drafts'), verifyDir = get('--verify'), finalDir = get('--final');
  mkdirSync(finalDir, { recursive: true });
  const byCat = new Map();
  const stats = {};
  const chunkNames = readdirSync(tasksDir).filter(f => f.endsWith('.json')).sort();
  const missing = { drafts: [], verifies: [] };
  for (const name of chunkNames) {
    const cat = name.replace(/_\d+\.json$/, '');
    if (!byCat.has(cat)) byCat.set(cat, []);
    const st = (stats[cat] ??= { tasked: 0, drafted: 0, pass: 0, fixed: 0, dropVerdict: 0, dropLint: 0, dropMissing: 0, dropDup: 0 });
    const task = readJson(join(tasksDir, name));
    st.tasked += task.length;
    const draftPath = join(draftsDir, name), verifyPath = join(verifyDir, name);
    if (!existsSync(draftPath)) { missing.drafts.push(name); st.dropMissing += task.length; continue; }
    if (!existsSync(verifyPath)) { missing.verifies.push(name); st.dropMissing += task.length; continue; }
    const drafts = readJson(draftPath);
    const verdicts = new Map(readJson(verifyPath).map(v => [normKey(v.answer), v]));
    const taskByKey = new Map(task.map(t => [normKey(t.answer), t]));
    for (const d of drafts) {
      const key = normKey(d.answer);
      const t = taskByKey.get(key);
      if (!t) continue; // 작업 목록에 없는 답을 지어낸 경우 — 폐기
      st.drafted++;
      const v = verdicts.get(key);
      if (!v) { st.dropMissing++; continue; } // 검증 누락 = fail-closed 폐기
      let out = null;
      if (v.verdict === 'pass') { out = d; st.pass++; }
      else if (v.verdict === 'fix' && Array.isArray(v.fixedHints) && v.fixedHints.length >= 5) {
        out = { ...d, hints: v.fixedHints, maxHints: v.fixedMaxHints ?? Math.min(d.maxHints, v.fixedHints.length), acceptable: v.fixedAcceptable ?? d.acceptable };
        st.fixed++;
      } else { st.dropVerdict++; continue; }
      out.maxHints = Math.max(2, Math.min(Number(out.maxHints) || 0, out.hints.length));
      const merged = {
        categoryKey: cat, difficulty: t.difficulty, answer: t.answer,
        acceptable: [...new Set([...(t.acceptable ?? []), ...(out.acceptable ?? [])])].filter(a => a && a !== t.answer),
        hints: out.hints.map(h => String(h).trim()).filter(Boolean),
        maxHints: out.maxHints,
        sourceTitle: t.sourceTitle, sourceSite: t.sourceSite,
      };
      const issues = lintAll(merged, cat);
      if (issues.length) { st.dropLint++; continue; }
      byCat.get(cat).push(merged);
    }
  }
  for (const [cat, list] of byCat) {
    const seen = new Set();
    const uniq = [];
    for (const q of list) {
      const keys = [normKey(q.answer), normKey(baseName(q.answer))].filter(Boolean);
      if (keys.some(k => seen.has(k))) { stats[cat].dropDup++; continue; }
      keys.forEach(k => seen.add(k));
      uniq.push(q);
    }
    writeFileSync(join(finalDir, `${cat}.json`), JSON.stringify(uniq, null, 1));
    const d = { easy: 0, normal: 0, hard: 0 };
    uniq.forEach(q => d[q.difficulty]++);
    stats[cat].final = uniq.length;
    stats[cat].byDiff = d;
  }
  writeFileSync(join(finalDir, '_stats.json'), JSON.stringify({ stats, missing }, null, 2));
  console.log(JSON.stringify(stats, null, 2));
  if (missing.drafts.length || missing.verifies.length) console.log('누락 청크:', JSON.stringify(missing));
}

// ── sql ────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/'/g, "''");
const sqlArr = (arr) => arr.length ? `array[${arr.map(a => `'${esc(a)}'`).join(',')}]::text[]` : `'{}'::text[]`;

function rowSql(q) {
  const label = CATEGORY_LABELS[q.categoryKey] ?? q.categoryKey;
  return `('${esc(normKey(q.answer))}','${esc(q.categoryKey)}','${esc(q.answer)}','${esc(label)}',${sqlArr(q.acceptable)},jsonb_build_array(to_jsonb(${sqlArr(q.hints)})),${q.maxHints},'${q.difficulty}')`;
}

function cmdSql() {
  const { get } = args();
  const finalDir = get('--final'), outDir = get('--out');
  const MAXB = Number(get('--maxbytes', '700000'));
  mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const f of readdirSync(finalDir).filter(f => /^[a-z]+\.json$/.test(f))) {
    for (const q of readJson(join(finalDir, f))) rows.push(rowSql(q));
  }
  const HEADER = [
    '-- 퀴즈 시드 적재 (Claude 오프라인 생성·위키 근거 검증 파이프라인 산출물)',
    '-- 기존 행과 충돌 시: banned 보호, 힌트세트는 새 세트를 앞에 추가(최대 10), acceptable 병합.',
    'insert into public.quiz_bank as b',
    '  (answer_key, category_key, answer, category_label, acceptable, hint_sets, max_hints, difficulty_labeled)',
    'values',
  ].join('\n');
  const FOOTER = [
    'on conflict (answer_key, category_key) do update set',
    '  answer         = excluded.answer,',
    '  category_label = excluded.category_label,',
    '  acceptable     = (select array(select distinct unnest(b.acceptable || excluded.acceptable))),',
    // 같은 시드를 두 번 실행해도 동일한 힌트 세트가 두 벌 쌓이지 않도록 distinct로 합친다
    // (멱등성 — 부분 적재 후 전체 재적재가 흔하다). 순서는 무의미하다: 픽이 랜덤이다.
    '  hint_sets      = coalesce((',
    '    select jsonb_path_query_array(jsonb_agg(distinct e), \'$[0 to 9]\'::jsonpath)',
    '    from jsonb_array_elements(excluded.hint_sets || b.hint_sets) e',
    "  ), b.hint_sets),",
    '  max_hints          = excluded.max_hints,',
    '  difficulty_labeled = excluded.difficulty_labeled,',
    '  updated_at         = now()',
    "where b.status <> 'banned';",
  ].join('\n');
  let part = [], size = 0, idx = 1, written = 0;
  const flush = () => {
    if (!part.length) return;
    const sql = `${HEADER}\n${part.join(',\n')}\n${FOOTER}\n`;
    writeFileSync(join(outDir, `seed_${String(idx).padStart(2, '0')}.sql`), sql);
    written += part.length;
    idx++; part = []; size = 0;
  };
  for (const r of rows) {
    if (size + r.length > MAXB) flush();
    part.push(r); size += r.length + 2;
  }
  flush();
  console.log(`SQL ${idx - 1}개 파일, 총 ${written}행 → ${outDir}`);
}

const cmd = process.argv[2];
if (cmd === 'chunk') cmdChunk();
else if (cmd === 'assemble') cmdAssemble();
else if (cmd === 'sql') cmdSql();
else { console.error('usage: pipeline.mjs chunk|assemble|sql ...'); process.exit(2); }
