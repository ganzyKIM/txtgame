#!/usr/bin/env node
/* 신고·이의제기 검토 큐 (migration 038) 를 내려받고 결정을 올린다. 검토 자체는 Claude 가
   docs/SEED_PIPELINE.md 의 "검토" 절 프롬프트로 한다 — 이 도구는 문만 두드린다.

   환경변수: tools/seed-load.mjs 와 같다 (SEED_TOKEN, SUPABASE_URL/ANON — .env.local 도 읽음)

   사용:
     node tools/review.mjs list [--out data/review/pending.json]   # 대기 항목 저장 (기본 경로)
     node tools/review.mjs resolve <decisions.json>                  # [{kind, bank_id, action, patch?, reason?}]
   action: restore(멀쩡함, 그대로 복구) | fix(patch 적용 후 복구) | delete(banned) */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
if (!URL_ || !ANON || !TOKEN) { console.error('SUPABASE_URL / SUPABASE_ANON_KEY / SEED_TOKEN 이 필요하다'); process.exit(3); }

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

const [cmd, arg] = process.argv.slice(2);
const outIdx = process.argv.indexOf('--out');
const OUT = resolve(ROOT, outIdx > 0 ? process.argv[outIdx + 1] : 'data/review/pending.json');

if (cmd === 'list') {
  const rows = await rpc('review_list', { p_token: TOKEN });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`검토 대기 ${rows.length}건 → ${OUT}`);
  for (const r of rows) {
    const label = r.kind === 'quiz' ? `${r.item?.category_key}/${r.item?.answer}` : `수프 「${r.item?.title}」`;
    console.log(`  [${r.kind}] ${label} — ${r.reasons.join(',')} ×${r.reports}`);
  }
} else if (cmd === 'resolve') {
  const decisions = JSON.parse(readFileSync(resolve(arg), 'utf8'));
  let n = 0;
  for (const d of decisions) {
    if (!['restore', 'fix', 'delete'].includes(d.action)) { console.error(`건너뜀(action 부적절): ${d.bank_id}`); continue; }
    await rpc('review_resolve', { p_token: TOKEN, p_kind: d.kind, p_bank_id: d.bank_id, p_action: d.action, p_patch: d.patch ?? {} });
    n++;
    console.log(`✓ ${d.kind} ${d.bank_id} → ${d.action}${d.reason ? ` (${d.reason})` : ''}`);
  }
  console.log(`${n}/${decisions.length}건 처리`);
} else {
  console.error('usage: review.mjs list [--out file] | resolve <decisions.json>');
  process.exit(2);
}
