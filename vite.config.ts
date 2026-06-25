import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel 정적 배포 — 루트 경로(`/`)에서 서빙된다.
export default defineConfig({
  plugins: [react()],
  base: '/',
});
