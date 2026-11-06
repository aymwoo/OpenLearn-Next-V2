import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(REPO_ROOT, 'packages/interactive-lab');

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

async function bundleFrontend() {
  const frontendPath = path.join(PLUGIN_ROOT, 'src/frontend.ts');
  if (!fs.existsSync(frontendPath)) return '';
  const result = await esbuild.build({
    entryPoints: [frontendPath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['react', 'react-dom', 'lucide-react', 'recharts'],
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

export async function buildInteractiveLabZip(opts = {}) {
  const serverJs = await bundleServer();
  const frontendJs = await bundleFrontend();

  const manifestPath = path.join(PLUGIN_ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const effectiveManifest = { ...manifest, ...opts.manifestOverrides };

  const packageJsonPath = path.join(PLUGIN_ROOT, 'package.json');
  const packageJson = fs.existsSync(packageJsonPath) ? fs.readFileSync(packageJsonPath, 'utf-8') : '{}';

  const simViewHtml = fs.readFileSync(path.join(PLUGIN_ROOT, 'public/sim-view.html'), 'utf-8');
  const simAppJs = fs.readFileSync(path.join(PLUGIN_ROOT, 'public/sim-app.js'), 'utf-8');

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(effectiveManifest, null, 2));
  zip.file('index.js', serverJs);
  if (frontendJs) {
    zip.file('frontend.js', frontendJs);
  }
  zip.file('package.json', packageJson);

  // 部署静态资源：提取到 storage/dist/* 对应 manifest.deploy.staticDir
  zip.file('storage/dist/sim-view.html', simViewHtml);
  zip.file('storage/dist/sim-app.js', simAppJs);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function main() {
  console.log('[build-interactive-lab] Building ext-interactive-lab-1.0.0.zip...');
  const zipBuffer = await buildInteractiveLabZip();

  // 1. 输出到 assets/ext-interactive-lab-1.0.0.zip
  const assetsDir = path.join(REPO_ROOT, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const assetsZip = path.join(assetsDir, 'ext-interactive-lab-1.0.0.zip');
  fs.writeFileSync(assetsZip, zipBuffer);
  console.log(`[build-interactive-lab] Generated: ${assetsZip} (${zipBuffer.length} bytes)`);

  // 2. 输出到 dist/plugins/ext-interactive-lab-1.0.0.zip
  const distDir = path.join(REPO_ROOT, 'dist/plugins');
  fs.mkdirSync(distDir, { recursive: true });
  const distZip = path.join(distDir, 'ext-interactive-lab-1.0.0.zip');
  fs.writeFileSync(distZip, zipBuffer);
  console.log(`[build-interactive-lab] Generated: ${distZip} (${zipBuffer.length} bytes)`);
}

// Check if this script is being executed directly
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    console.error('[build-interactive-lab] Build failed:', err);
    process.exit(1);
  });
}
