#!/usr/bin/env node
/**
 * Scratch 编程插件部署脚本
 * 由插件系统在 installPluginFromZip 中自动调用
 *
 * 用法：node deploy.js [项目根目录]
 *
 * 功能：
 *   1. 复制 Scratch 静态资源到 storage/scratch/
 */

const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2] || process.cwd();
console.log('项目根目录:', projectRoot);

// 源目录: {projectRoot}/v2_plugins/scratch-editor-deploy/storage/scratch/
const srcDir = path.join(projectRoot, 'v2_plugins', 'scratch-editor-deploy', 'storage', 'scratch');
// 目标目录: {projectRoot}/storage/scratch/
const destDir = path.join(projectRoot, 'storage', 'scratch');

if (!fs.existsSync(srcDir)) {
  console.error('[错误] 未找到 Scratch 静态资源源目录:', srcDir);
  console.error('[提示] 请确保 v2_plugins/scratch-editor-deploy/storage/scratch/ 目录存在');
  process.exit(1);
}

if (fs.existsSync(destDir)) {
  console.log('[跳过] storage/scratch/ 已存在，如需覆盖请手动删除后重跑');
} else {
  console.log('[复制] storage/scratch/ ...');
  copyDirSync(srcDir, destDir);
  console.log('[完成] Scratch 静态资源已复制');
}

console.log('========================================');
console.log('Scratch 编程插件静态资源部署完成');
console.log('========================================');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
