// Edge Function: generate-text
// Verifies the user's JWT, checks credit balance, calls Gemini with the
// server-side key, measures token usage, deducts credits atomically, and
// records a ledger entry. The browser never sees the Gemini key.
// tier 'quiz_judge' 는 config.local_llm 이 가리키는 로컬 판정 서버(맥 Ollama)를 먼저 쓴다 (040).
// 저장소 사본: 대시보드 Edge Functions 편집기에 이 파일을 그대로 붙여 "Deploy updates".
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Educational literary-fiction generator dealing only with fictional
// characters and stories, so all safety filters are disabled.
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

interface ModelCfg {
  model: string;
  in_rate: number; // USD per 1M input tokens
  out_rate: number; // USD per 1M output tokens
  /** thinking(사고) 토큰 예산. 0 = 사고 비활성화, 미설정 = 모델 기본값.
   *  사고 토큰은 출력 토큰 단가로 청구되므로 예/아니오 판정 등
   *  사고가 불필요한 티어는 0으로 두면 비용이 크게 준다. */
  thinking?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '로그인이 필요합니다.' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) return json({ error: '서버에 API 키가 설정되지 않았습니다.' }, 500);

    // Identify the caller from their JWT
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: '인증에 실패했습니다.' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Load operator config
    const { data: cfgRows } = await admin.from('config').select('key, value');
    const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.key, r.value]));
    const fx = Number(cfg.fx ?? 1400);
    const markup = Number(cfg.markup ?? 2);
    const models = (cfg.models ?? {}) as Record<string, ModelCfg>;

    const { tier = 'standard', messages = [], system, temperature } = await req.json();
    const m = models[tier] ?? models['standard'];
    if (!m) return json({ error: '모델 설정 오류입니다.' }, 500);

    // Pre-check balance (refuse only when empty; exact cost known after the call)
    const { data: prof } = await admin
      .from('profiles').select('credits').eq('id', user.id).single();
    if (!prof || prof.credits <= 0) {
      return json({ error: '크레딧이 부족합니다. 충전이 필요합니다.' }, 402);
    }

    // ── 로컬 판정 모델 우선 (tier quiz_judge) ──
    // 맥에서 도는 Ollama 판정 서버(tools/local-llm/server.mjs)가 config.local_llm 에 자기
    // 터널 주소를 올려 둔다. 판정·예/아니오·힌트처럼 짧고 잦은 호출은 거기로 보내 크레딧을
    // 안 깎고, 꺼져 있거나 8초 안에 답이 없으면 아래 Gemini 경로로 그대로 내려간다.
    const local = cfg.local_llm as { url?: string; token?: string; model?: string } | undefined;
    if (tier === 'quiz_judge' && local?.url && local?.token) {
      try {
        const lRes = await fetch(`${local.url}/judge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${local.token}` },
          body: JSON.stringify({ messages, system, temperature: temperature ?? 0, model: local.model }),
          signal: AbortSignal.timeout(8000),
        });
        if (lRes.ok) {
          const lData = await lRes.json();
          if (typeof lData.text === 'string' && lData.text.trim()) {
            return json({ text: lData.text, balance: prof.credits, credits: 0, usage: { in: lData.in ?? 0, out: lData.out ?? 0 }, via: 'local' });
          }
        }
      } catch (_e) {
        // 로컬 불가 → Gemini 폴백
      }
    }

    const generationConfig: Record<string, unknown> = { temperature: temperature ?? 0.75 };
    if (typeof m.thinking === 'number') {
      generationConfig.thinkingConfig = { thinkingBudget: m.thinking };
    }
    const body: Record<string, unknown> = {
      contents: (messages as Array<{ role: string; text: string }>).map((x) => ({
        role: x.role,
        parts: [{ text: x.text }],
      })),
      safetySettings: SAFETY_SETTINGS,
      generationConfig,
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const gRes = await fetch(
      `${GEMINI_BASE}/models/${m.model}:generateContent?key=${GEMINI_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const gData = await gRes.json();
    if (gData.error) return json({ error: gData.error.message }, 502);

    const text: string = (gData.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '').join('');
    if (!text) return json({ error: '응답에서 텍스트를 추출하지 못했습니다.' }, 502);

    const inTok: number = gData.usageMetadata?.promptTokenCount ?? 0;
    const outTok: number = gData.usageMetadata?.candidatesTokenCount ?? 0;
    // 사고(thinking) 토큰 — candidatesTokenCount에 포함되지 않지만
    // Google은 출력 토큰 단가로 청구하므로 반드시 과금에 포함해야 한다.
    const thinkTok: number = gData.usageMetadata?.thoughtsTokenCount ?? 0;
    const credits = Math.max(
      1,
      Math.ceil(((inTok * m.in_rate + (outTok + thinkTok) * m.out_rate) / 1_000_000) * fx * markup),
    );

    const { data: balance, error: spendErr } = await admin.rpc('spend_credits', {
      p_user: user.id,
      p_amount: credits,
      p_type: 'spend_text',
      p_meta: { tier, model: m.model, in: inTok, out: outTok, think: thinkTok },
    });
    if (spendErr) return json({ error: '크레딧 차감 실패: ' + spendErr.message }, 500);

    return json({ text, balance, credits, usage: { in: inTok, out: outTok } });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});