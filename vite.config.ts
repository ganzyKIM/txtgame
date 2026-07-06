import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vercel 정적 배포 — 루트 경로(`/`)에서 서빙된다.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // 새 빌드 배포되면 다음 방문 시 자동으로 최신 서비스워커로 교체
      injectRegister: 'auto',
      manifest: {
        name: '초텐짱의 편차치99 ✞퀴즈대합전✞',
        short_name: '편차치99',
        description: '힌트를 적게 보고 정답을 맞힐수록 고득점! 추리 퀴즈 게임',
        lang: 'ko',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffe6f7',
        theme_color: '#ff44c8',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // JS/CSS/HTML만 프리캐시 — 폰트(수 MB급 ttf)·배경 이미지는 용량이 커서
        // 설치 시 전부 받으면 느려짐 + 이 게임은 Gemini/Supabase 없이는 어차피
        // 오프라인 플레이가 불가능하므로 미디어까지 오프라인 캐싱할 이유가 없음.
        globPatterns: ['**/*.{js,css,html}'],
      },
    }),
  ],
  base: '/',
});
