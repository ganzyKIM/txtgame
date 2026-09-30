#!/usr/bin/env node
/* 최종 시드(JSON)를 seed_load_quiz / seed_load_soup RPC(migration 036)로 적재한다.
   SQL Editor 도, DB 비밀번호도 필요 없다 — anon 키 + 시드 토큰만.

   환경변수(.env.local 도 읽는다):
     VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   (또는 SUPABASE_URL / SUPABASE_ANON_KEY)
     SEED_TOKEN                                  (seed_secrets 의 seed_token 과 같은 값)

   사용:
     node tools/seed-load.mjs quiz <finalDir> [--force]   # <finalDir>/*.json (카테고리별)
     node tools/seed-load.mjs soup <finalDir> [--force]   # <finalDir>/soup.json
     node tools/seed-load.mjs inventory                    # 카테고리×난이도 재고
   적재한 디렉터리에는 _loaded.json 마커를 남겨 두 번 실행해도 건너뛴다. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normKey } from './quiz-seed/lint-lib.mjs';
import { scenarioKey } from './soup-seed/pipeline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORY_LABELS = {
  person: '인물', movie: '영화·드라마', anime: '애니·만화', game: '게임·캐릭터',
  music: '음악·가수', food: '음식·요리', animal: '동물', place: '장소·건축',
  history: '역사 사건', science: '과학·발명', myth: '신화·전설', sport: '스포츠·선수',
  otaku: '오타쿠', proverb: '고사성어',
};

// .env.local 을 process.env 보다 낮은 우선순위로 읽는다
for (const f of ['.env.local', '.env']) {
  const p = resolve(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const TOKEN = process.env.SEED_TOKEN;
if (!URL_ || !ANON) { console.error('SUPABASE_URL / SUPABASE_ANON_KEY 가 없다'); process.exit(2); }
if (!TOKEN) { console.error('SEED_TOKEN 이 없다 — seed_secrets.seed_token 과 같은 값을 환경변수로 줘라'); process.exit(3); }

async function rpc(name, body) {
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function loadBatches(name, rows, batch = 100) {
  let done = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const n = await rpc(name, { p_token: TOKEN, p_rows: rows.slice(i, i + batch) });
    done += Number(n) || 0;
    process.stdout.write(`\r${name}: ${Math.min(i + batch, rows.length)}/${rows.length} (적재 ${done})`);
  }
  process.stdout.write('\n');
  return done;
}

const [cmd, dirArg] = process.argv.slice(2);
const FORCE = process.argv.includes('--force');
const jsonFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();

if (cmd === 'inventory') {
  const inv = await rpc('seed_inventory', { p_token: TOKEN });
  const byKind = {};
  for (const r of inv) (byKind[r.kind] ??= []).push(`${r.category_key}/${r.difficulty}=${r.n}`);
  for (const [k, v] of Object.entries(byKind)) console.log(k, v.join('  '));
} else if (cmd === 'quiz' || cmd === 'soup') {
  const dir = resolve(dirArg);
  const marker = join(dir, '_loaded.json');
  if (existsSync(marker) && !FORCE) { console.log(`이미 적재됨 (${marker}) — --force 로 다시`); process.exit(0); }
  const rows = [];
  for (const f of jsonFiles(dir)) {
    for (const q of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
      rows.push(cmd === 'quiz'
        ? { answer_key: normKey(q.answer), category_key: q.categoryKey, answer: q.answer,
            category_label: CATEGORY_LABELS[q.categoryKey] ?? q.categoryKey, acceptable: q.acceptable ?? [],
            hints: q.hints, max_hints: q.maxHints, difficulty: q.difficulty }
        : { scenario_key: scenarioKey(q.scenario), title: q.title, scenario: q.scenario, solution: q.solution,
            key_facts: q.keyFacts ?? [], mood: q.mood ?? '', difficulty: q.difficulty ?? 'normal' });
    }
  }
  const n = await loadBatches(cmd === 'quiz' ? 'seed_load_quiz' : 'seed_load_soup', rows);
  writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), rows: rows.length, loaded: n }, null, 2));
  console.log(`${cmd}: ${n}/${rows.length}행 적재 → ${marker}`);
} else {
  console.error('usage: seed-load.mjs quiz|soup <finalDir> [--force] | inventory');
  process.exit(2);
}
