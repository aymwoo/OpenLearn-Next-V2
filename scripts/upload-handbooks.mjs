#!/usr/bin/env node
/**
 * 把已生成的 PDF 手册上传为 GitHub Release 附件。
 *
 * 背景：PDF 制品**不进版本控制**（仓库只留生成脚本与截图源图），分发走 Release 附件。
 * 文档里引用的是 `releases/latest/download/<资产名>` 这种**稳定链接**——
 * 它永远指向最新一个 Release 里的同名资产，所以每次发版只要重新上传覆盖即可，
 * 不需要改文档里的链接。
 *
 * 用法：
 *   npm run docs:pdf            # 先生成 PDF 到 docs/_build/handbooks/
 *   npm run docs:pdf:upload     # 再上传（默认覆盖到 latest release）
 *   npm run docs:pdf:upload -- v0.7.12   # 上传到指定 tag
 *
 * 前置：`gh` CLI 已登录，且对目标仓库有 release 写权限。
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'aymwoo/OpenLearn-Next-V2';
const OUT_DIR = path.resolve('docs/_build/handbooks');
const TAG = process.argv[2] || 'latest';

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

if (!existsSync(OUT_DIR)) {
  fail(`未找到 PDF 产物目录：${OUT_DIR}\n  请先执行：npm run docs:pdf`);
}

const pdfs = readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf'));
if (pdfs.length === 0) {
  fail(`${OUT_DIR} 里没有 PDF 产物（目录存在但为空）`);
}

console.log(`目标仓库：${REPO}`);
console.log(`目标 Release：${TAG}`);
console.log(`待上传 ${pdfs.length} 份：${pdfs.join('、')}\n`);

for (const name of pdfs) {
  const file = path.join(OUT_DIR, name);
  process.stdout.write(`→ 上传 ${name} ... `);
  try {
    execFileSync('gh', ['release', 'upload', TAG, file, '--clobber', '--repo', REPO], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('✓');
  } catch (err) {
    const stderr = (err.stderr || Buffer.from('')).toString().trim();
    console.log('✗');
    fail(`上传失败：${name}\n${stderr}`);
  }
}

console.log('\n✅ 全部上传完成。文档中的稳定链接形如：');
console.log(`   https://github.com/${REPO}/releases/latest/download/${pdfs[0]}`);
