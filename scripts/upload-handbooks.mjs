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
 *   npm run docs:pdf                  # 先生成 PDF 到 docs/_build/handbooks/
 *   npm run docs:pdf:upload           # 上传到 latest（会先打印解析到的真实 tag）
 *   npm run docs:pdf:upload -- v0.7.12   # 上传到指定 tag
 *   npm run docs:pdf:upload -- --help # 只打印用法
 *
 * 安全约定（为什么需要这一层）：
 *   `gh release upload --clobber` 会**静默覆盖线上附件**。曾出现过这样的误操作：
 *   把 `--help` 当成 tag 传进来，脚本忽略未知参数后退回默认 `latest`，
 *   结果直接覆盖了线上 Release 的三个文件（所幸内容一致，digest 比对无变化）。
 *   因此这里显式拒绝未知参数 / 参数过多，并在上传前**回显并校验目标 Release**。
 *
 * 前置：`gh` CLI 已登录，且对目标仓库有 release 写权限。
 *
 * @module
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = process.env.GITHUB_REPOSITORY || 'aymwoo/OpenLearn-Next-V2';
const OUT_DIR = path.resolve('docs/_build/handbooks');

const USAGE = `用法: npm run docs:pdf:upload [-- <tag>]

  <tag>        目标 Release 的 tag（例：v0.7.12）。省略时使用 latest。
  -h, --help   显示本帮助（不会上传任何文件）。

前置：gh CLI 已登录且对 ${REPO} 有 release 写权限。
注意：已存在的同名附件会被 --clobber 覆盖。`;

function fail(msg, code = 1) {
  console.error(`✖ ${msg}`);
  process.exit(code);
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    .toString()
    .trim();
}

// ── 参数解析：显式拒绝一切未知参数（不做「静默忽略」）────────────────────
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}
const unknown = argv.filter((a) => a.startsWith('-'));
if (unknown.length > 0) {
  fail(`未知参数: ${unknown.join(' ')}\n\n${USAGE}`, 2);
}
if (argv.length > 1) {
  fail(`参数过多：${argv.join(' ')}（只接受一个 tag）\n\n${USAGE}`, 2);
}
// ── 产物检查 ────────────────────────────────────────────────────────────
if (!existsSync(OUT_DIR)) {
  fail(`未找到 PDF 产物目录：${OUT_DIR}\n  请先执行：npm run docs:pdf`);
}
const pdfs = readdirSync(OUT_DIR).filter((f) => f.endsWith('.pdf'));
if (pdfs.length === 0) {
  fail(`${OUT_DIR} 里没有 PDF 产物（目录存在但为空）`);
}

// ── 解析目标 Release，并回显它将覆盖什么 ────────────────────────────────
// 注意：`latest` **不是** `gh release view` / `gh api` 的通用别名。
// `gh release upload latest` 可能静默失败或行为不一致，因此这里显式用
// API 把 `latest` 解析成真实 tag，后续所有操作都用那个 tag。
let TAG_INPUT = argv[0] || 'latest';
function resolveLatest() {
  try {
    return gh(['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name']);
  } catch (e) {
    const stderr = (e.stderr || Buffer.from('')).toString().trim();
    fail(`无法解析 latest（仓库可能还没有任何已发布 Release）：\n${stderr}`);
  }
}
let tag;
try {
  tag = TAG_INPUT === 'latest' ? resolveLatest() : TAG_INPUT;
  // 即便不是 latest，也回读一次确认该 tag 真的有对应 Release
  tag = gh(['release', 'view', tag, '--repo', REPO, '--json', 'tagName', '--jq', '.tagName']);
} catch (e) {
  const stderr = (e.stderr || Buffer.from('')).toString().trim();
  fail(
    `目标 Release 不存在或不可读：${TAG_INPUT}\n${stderr}\n\n` +
      `  提示：Release 需要先创建（gh release create <tag>）。\n` +
      `  --clobber 只覆盖已有附件，不会替你创建 Release。`,
  );
}

const existing = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets'])).assets;
const existingNames = new Set(existing.map((a) => a.name));
const willOverwrite = pdfs.filter((f) => existingNames.has(f));

console.log(`目标仓库: ${REPO}`);
console.log(`目标 Release: ${tag}${TAG_INPUT === 'latest' ? '（由 latest 解析得出）' : ''}`);
console.log(`待上传 ${pdfs.length} 份：`);
for (const f of pdfs) {
  const bytes = readFileSync(path.join(OUT_DIR, f)).length;
  console.log(`  - ${f}  ${(bytes / 1024 / 1024).toFixed(2)} MB${existingNames.has(f) ? '  [将覆盖已有附件]' : ''}`);
}
if (willOverwrite.length > 0) {
  console.log(`\n⚠️ 将覆盖 ${willOverwrite.length} 个已存在的附件。若这是旧版本的 Release，请确认 tag 传对了。\n`);
} else {
  console.log('');
}

// ── 上传 ────────────────────────────────────────────────────────────────
for (const name of pdfs) {
  const file = path.join(OUT_DIR, name);
  process.stdout.write(`→ 上传 ${name} ... `);
  try {
    gh(['release', 'upload', tag, file, '--clobber', '--repo', REPO]);
    console.log('✓');
  } catch (e) {
    const stderr = (e.stderr || Buffer.from('')).toString().trim();
    console.log('✗');
    fail(`上传失败：${name}\n${stderr}`);
  }
}

// ── 回读校验（上传成功 ≠ 内容正确）──────────────────────────────────────
const after = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets'])).assets;
const mismatch = pdfs.filter((f) => !after.some((a) => a.name === f && a.state === 'uploaded'));
if (mismatch.length > 0) {
  fail(`上传后回读发现附件缺失或状态异常：${mismatch.join(', ')}`);
}

console.log(`\n✅ ${pdfs.length} 份全部上传并在远端回读确认（release: ${tag}）`);
console.log(`   稳定链接形如：https://github.com/${REPO}/releases/latest/download/${pdfs[0]}`);
