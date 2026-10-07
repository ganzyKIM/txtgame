#!/usr/bin/env node
/* 로컬 판정 서버 — 맥의 Ollama 를 인터넷에 안전하게 내보내 generate-text 엣지 함수가
   퀴즈 정답 판정·수프 예/아니오·힌트·최종추측(tier quiz_judge)을 Gemini 대신 여기로 보내게 한다.

   구성:  엣지 함수 ──HTTPS──▶ cloudflared 임시 터널 ──▶ 이 서버(:8787) ──▶ Ollama(:11434)
   · /judge   Bearer 토큰(LOCAL_LLM_TOKEN) 검사 → Ollama /api/chat (JSON 강제, temperature 0) → {text}
   · /health  토큰 없이 200 — 터널·모델 생존 확인용
   · 터널 주소가 바뀔 때마다 set_local_llm RPC(040) 로 config.local_llm 에 올린다.
   · Ollama 가 안 떠 있으면 직접 띄우고, 시작 시 모델을 한 번 워밍업한다.

   실행: node tools/local-llm/server.mjs   (LaunchAgent com.txtgame.local-llm 이 로그인 시 자동 실행)
   환경: .env.local 의 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SEED_TOKEN, LOCAL_LLM_TOKEN, LOCAL_LLM_MODEL */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = { ...loadEnv(resolve(ROOT, '.env.local')), ...process.env };
const PORT = Number(env.LOCAL_LLM_PORT ?? 8787);
const OLLAMA = env.OLLAMA_HOST?.startsWith('http') ? env.OLLAMA_HOST : 'http://127.0.0.1:11434';
const MODEL = env.LOCAL_LLM_MODEL ?? 'gemma3:4b';
const TOKEN = env.LOCAL_LLM_TOKEN;
const KEEP_ALIVE = '24h'; // 모델을 메모리에 상주 — 첫 토큰 지연(수 초) 제거
const GEN_TIMEOUT_MS = 12000;
if (!TOKEN) { console.error('LOCAL_LLM_TOKEN 이 .env.local 에 없다'); process.exit(1); }

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Ollama 생존 보장 ──
async function ollamaUp() {
  try { const r = await fetch(`${OLLAMA}/api/version`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
let ollamaProc = null;
async function ensureOllama() {
  if (await ollamaUp()) return;
  if (!ollamaProc) {
    log('ollama 가 없어 직접 띄운다');
    ollamaProc = spawn('ollama', ['serve'], { stdio: 'ignore', env: { ...process.env, OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' } });
    ollamaProc.on('exit', () => { ollamaProc = null; });
  }
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await ollamaUp()) return; }
  throw new Error('ollama 시작 실패');
}
async function warm() {
  try {
    await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ model: MODEL, stream: false, keep_alive: KEEP_ALIVE, messages: [{ role: 'user', content: 'ok' }], options: { num_predict: 1 } }) });
    log(`모델 워밍업 완료: ${MODEL}`);
  } catch (e) { log('워밍업 실패', e.message); }
}

// ── 판정 ──
let inflight = 0, served = 0, failed = 0;
async function judge(body) {
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: String(body.system) });
  for (const m of body.messages ?? []) messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: String(m.text ?? m.content ?? '') });
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
    body: JSON.stringify({
      model: body.model ?? MODEL, stream: false, format: 'json', keep_alive: KEEP_ALIVE, messages,
      options: { temperature: body.temperature ?? 0, num_predict: 220, num_ctx: 4096 },
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j = await r.json();
  const text = j.message?.content ?? '';
  if (!text.trim()) throw new Error('빈 응답');
  return { text, model: j.model, in: j.prompt_eval_count ?? 0, out: j.eval_count ?? 0 };
}

const server = createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/health') return send(200, { ok: await ollamaUp(), model: MODEL, inflight, served, failed, tunnel: tunnelUrl });
  if (req.method !== 'POST' || req.url !== '/judge') return send(404, { error: 'not found' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
  if (inflight >= 4) return send(503, { error: 'busy' }); // 혼잡하면 바로 거절 → 엣지가 Gemini 로
  let raw = ''; for await (const c of req) { raw += c; if (raw.length > 64_000) return send(413, { error: 'too large' }); }
  inflight++; const t = Date.now();
  try {
    const out = await judge(JSON.parse(raw));
    served++; log(`judge ok ${Date.now() - t}ms in=${out.in} out=${out.out}`);
    send(200, out);
  } catch (e) {
    failed++; log(`judge fail ${Date.now() - t}ms ${e.message}`);
    send(502, { error: e.message });
  } finally { inflight--; }
});

// ── cloudflared 임시 터널 + 주소 공개 ──
let tunnelUrl = null, tunnelProc = null;
async function publish(url) {
  try {
    const r = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/set_local_llm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: env.VITE_SUPABASE_ANON_KEY, authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ p_token: env.SEED_TOKEN, p_url: url, p_llm_token: TOKEN, p_model: MODEL }),
    });
    log(r.ok ? `주소 공개: ${url}` : `주소 공개 실패 ${r.status}: ${await r.text()}`);
  } catch (e) { log('주소 공개 실패', e.message); }
}
function startTunnel() {
  tunnelProc = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnelUrl) { tunnelUrl = m[0]; publish(tunnelUrl); }
  };
  tunnelProc.stdout.on('data', onData); tunnelProc.stderr.on('data', onData);
  tunnelProc.on('exit', (code) => { log(`cloudflared 종료(${code}) — 5초 뒤 재시작`); tunnelUrl = null; setTimeout(startTunnel, 5000); });
}
// 터널은 살아 있어도 가끔 주소가 죽는다 — 10분마다 바깥에서 /health 를 쳐 보고 안 되면 재시작
setInterval(async () => {
  if (!tunnelUrl) return;
  try { const r = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(8000) }); if (r.ok) { await publish(tunnelUrl); return; } } catch { /* 아래로 */ }
  log('터널 자가진단 실패 — cloudflared 재시작'); tunnelProc?.kill();
}, 10 * 60 * 1000);

await ensureOllama();
server.listen(PORT, '127.0.0.1', () => log(`판정 서버 :${PORT} (model ${MODEL})`));
await warm();
startTunnel();
process.on('SIGTERM', () => { tunnelProc?.kill(); ollamaProc?.kill(); process.exit(0); });
