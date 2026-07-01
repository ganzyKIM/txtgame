// Supabase Edge Function — 나무위키 서버 사이드 프록시
// 나무위키는 CORS를 허용하지 않아 브라우저 직접 호출 불가.
// 이 함수가 서버에서 /raw/ 페이지를 가져와 정제 후 반환한다.
//
// 배포: supabase functions deploy namu-fetch

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  // 최소 인증 — supabase.functions.invoke가 자동으로 Bearer 토큰 포함
  if (!req.headers.get('Authorization')?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { title } = await req.json() as { title?: string };
    if (!title?.trim()) {
      return new Response(JSON.stringify({ exists: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const encoded = encodeURIComponent(title.trim());
    const namuRes = await fetch(`https://namu.wiki/raw/${encoded}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; txtgame-quiz/1.0)',
        'Accept-Language': 'ko-KR,ko',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });

    if (!namuRes.ok) {
      return new Response(JSON.stringify({ exists: false }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const raw = await namuRes.text();

    // NamuMark 기본 정제: 힌트 생성에 불필요한 마크업 제거
    const content = raw
      .replace(/\[include\([^\)]+\)\]/gi, '')          // include 지시자
      .replace(/\[\[분류:[^\]]*\]\]\n?/g, '')          // 분류 링크
      .replace(/\[\[파일:[^\]]*(?:\|[^\]]*)?\]\]/g, '') // 파일 삽입
      .replace(/##[^\n]*/g, '')                         // 주석
      .replace(/\{\|[^}]*\|\}/gs, '')                  // 테이블 블록 (멀티라인)
      .replace(/\|[^\n]{0,5}\n/g, '')                  // 짧은 테이블 구분선
      .trim()
      .slice(0, 2500); // 토큰 절약 — 개요 섹션이 보통 앞부분에 있음

    return new Response(JSON.stringify({ exists: true, content }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ exists: false }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
