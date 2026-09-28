#!/usr/bin/env node
/* tests/*.test.ts 를 esbuild 로 번들해 node --test 로 돌린다.
   vitest 같은 러너를 안 들이고 vite 가 이미 끌고 오는 esbuild 만 쓴다. */
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'node_modules/.tests');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const files = readdirSync(resolve(ROOT, 'tests')).filter((f) => /\.test\.tsx?$/.test(f));
const outs = [];
for (const f of files) {
  const outfile = resolve(OUT, f.replace(/\.tsx?$/, '') + '.mjs');
  await build({ entryPoints: [resolve(ROOT, 'tests', f)], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'error', jsx: 'automatic', packages: 'external' });
  outs.push(outfile);
}
const r = spawnSync(process.execPath, ['--test', ...outs], { stdio: 'inherit' });
process.exit(r.status ?? 1);
