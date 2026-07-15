import * as esbuild from 'esbuild';
import JSZip from 'jszip';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });

// ─── 服务端打包 ──────────────────────────────────────────
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'dist/index.js',
  external: ['@openlearn/plugin-sdk', 'better-sqlite3'],
  minify: false,
  sourcemap: false,
});
console.log('\u2713 dist/index.js');

// ─── 前端打包 ────────────────────────────────────────────
// ─── 前端打包 ────────────────────────────────────────────
// JSX 模式由 tsconfig.json 的 "jsx":"react" 控制（经典 createElement）
await esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/frontend.js',
  external: ['react', 'react-dom', 'recharts', 'lucide-react', '@openlearn/plugin-sdk'],
  minify: false,
  sourcemap: false,
});
console.log('\u2713 dist/frontend.js');

// ─── ZIP 打包 ────────────────────────────────────────────
const zip = new JSZip();
zip.file('manifest.json', readFileSync('manifest.json', 'utf-8'));
zip.file('index.js', readFileSync('dist/index.js', 'utf-8'));
zip.file('frontend.js', readFileSync('dist/frontend.js', 'utf-8'));
// 附带使用帮助
zip.file('USAGE.md', readFileSync('USAGE.md', 'utf-8'));

const zipBuffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 6 },
});
const zipPath = join(distDir, 'courseware-hub.zip');
writeFileSync(zipPath, zipBuffer);
const kb = (zipBuffer.length / 1024).toFixed(1);
console.log(`\u2713 dist/courseware-hub.zip (${kb} KB)`);
