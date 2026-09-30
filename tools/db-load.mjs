#!/usr/bin/env node
/* 시드 SQL 파일을 Supabase 에 실행한다 — 사람 손(SQL Editor 붙여넣기) 없이 돌아가는 경로.

   인증은 환경변수 둘 중 하나:
     SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF  → Management API (권장. 토큰은
                                                     supabase.com/dashboard/account/tokens)
     SUPABASE_DB_URL                               → psql 직결 (postgres 접속 문자열)
   둘 다 없으면 파일 목록만 출력하고 종료 코드 3 — 주기 실행에서 "적재는 사람이" 상태를
   구분하기 위함이다. 성공한 파일은 <file>.loaded 마커를 남겨 두 번 실행해도 건너뛴다.

   사용: node tools/db-load.mjs <sql 파일 또는 디렉터리>... [--force] */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const targets = argv.filter((a) => !a.startsWith('--'));
if (!targets.length) { console.error('usage: db-load.mjs <sql|dir>... [--force]'); process.exit(2); }

const files = [];
for (const t of targets) {
  const p = resolve(t);
  if (statSync(p).isDirectory()) files.push(...readdirSync(p).filter((f) => f.endsWith('.sql')).sort().map((f) => join(p, f)));
  else files.push(p);
}
const pending = files.filter((f) => FORCE || !existsSync(f + '.loaded'));
if (!pending.length) { console.log('적재할 파일 없음 (전부 .loaded)'); process.exit(0); }

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN, REF = process.env.SUPABASE_PROJECT_REF, DB = process.env.SUPABASE_DB_URL;
if (!(TOKEN && REF) && !DB) {
  console.log('DB 자격 증명 없음 — 아래 파일을 SQL Editor 에서 실행하거나 SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF 를 설정하라:');
  for (const f of pending) console.log('  ' + f);
  process.exit(3);
}

async function runManagement(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
function runPsql(sql) {
  const r = spawnSync('psql', [DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr || '').slice(0, 300)}`);
}

let ok = 0;
for (const f of pending) {
  const sql = readFileSync(f, 'utf8');
  try {
    if (TOKEN && REF) await runManagement(sql); else runPsql(sql);
    writeFileSync(f + '.loaded', new Date().toISOString() + '\n');
    ok++;
    console.log(`✓ ${f}`);
  } catch (e) {
    console.error(`✗ ${f}: ${e.message}`);
    process.exit(1);
  }
}
console.log(`${ok}/${pending.length} 파일 적재`);
