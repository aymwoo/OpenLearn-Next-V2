/**
 * 课堂积分排行榜插件 — 构建打包脚本
 *
 * 用法：node scripts/build-leaderboard.mjs
 * 输出：dist/plugins/ext-classroom-leaderboard.zip
 */
import esbuild from 'esbuild';
import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const plugin = {
  entry: path.resolve(__dirname, '../packages/plugins/leaderboard/index.ts'),
  manifest: path.resolve(__dirname, '../packages/plugins/leaderboard/manifest.json'),
  zipName: 'ext-classroom-leaderboard.zip',
};

const outDir = path.resolve(__dirname, '../dist/plugins');
fs.mkdirSync(outDir, { recursive: true });

async function build() {
  console.log(`🔨 正在构建插件: ${plugin.zipName}...`);
  console.log(`   入口: ${plugin.entry}`);
  console.log(`   manifest: ${plugin.manifest}`);

  // 1. esbuild 内存中打包 TypeScript → JavaScript
  const result = await esbuild.build({
    entryPoints: [plugin.entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    sourcemap: 'inline',
    target: 'node18',
    // 不设 external — 完全 bundle，服务端 validateAndBundleZip 会再次 esbuild
    // import type 会在编译时被擦除，Token 值会被内联
  });

  if (!result.outputFiles || result.outputFiles.length === 0) {
    throw new Error(`esbuild 输出为空: ${plugin.entry}`);
  }

  const jsCode = result.outputFiles[0].text;
  console.log(`   ✅ TypeScript 编译完成 (${(jsCode.length / 1024).toFixed(1)} KB)`);

  // 2. 读取 manifest.json
  const manifestContent = fs.readFileSync(plugin.manifest, 'utf8');

  // 3. JSZip 打包
  const zip = new JSZip();
  zip.file('index.js', jsCode);
  zip.file('manifest.json', manifestContent);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const destPath = path.join(outDir, plugin.zipName);
  fs.writeFileSync(destPath, zipBuffer);

  const sizeKB = (zipBuffer.length / 1024).toFixed(1);
  console.log(`   📦 ZIP 打包完成: ${destPath} (${sizeKB} KB)`);
  console.log(`\n🎉 插件构建成功！`);
  console.log(`   文件位置: ${destPath}`);
  console.log(`   安装方式: 插件中心 → 上传 ZIP → 选择 ${plugin.zipName}`);
}

build().catch((err) => {
  console.error('❌ 插件构建失败:', err);
  process.exit(1);
});
