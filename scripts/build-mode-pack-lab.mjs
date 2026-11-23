/**
 * 构建 ext-mode-pack-lab 的可安装 ZIP（阶段 12.1）。
 *
 * 与 `build-interactive-lab.mjs` 相同的产物结构：manifest + 打包后的入口 + package.json。
 * 示例包没有前端沙箱与静态资源，只验证声明式 `mode.pack` 的安装链路。
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'packages/mode-pack-lab');

async function bundleServer() {
  const result = await esbuild.build({
    entryPoints: [path.join(PLUGIN_ROOT, 'src/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    external: ['@openlearn/plugin-sdk', 'better-sqlite3'],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

export async function buildModePackLabZip() {
  const serverJs = await bundleServer();

  const manifestPath = path.join(PLUGIN_ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const packageJsonPath = path.join(PLUGIN_ROOT, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath) ? fs.readFileSync(packageJsonPath, 'utf-8') : '{}';

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('index.js', serverJs);
  zip.file('package.json', packageJson);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function main() {
  console.log('[build-mode-pack-lab] Building ext-mode-pack-lab-1.0.0.zip...');
  const zipBuffer = await buildModePackLabZip();

  const distDir = path.join(REPO_ROOT, 'dist/plugins');
  fs.mkdirSync(distDir, { recursive: true });
  const distZip = path.join(distDir, 'ext-mode-pack-lab-1.0.0.zip');
  fs.writeFileSync(distZip, zipBuffer);
  console.log(`[build-mode-pack-lab] Generated: ${distZip} (${zipBuffer.length} bytes)`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    console.error('[build-mode-pack-lab] Build failed:', err);
    process.exit(1);
  });
}
