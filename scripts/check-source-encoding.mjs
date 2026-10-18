#!/usr/bin/env node
// @ts-nocheck
/**
 * 源码编码检查：拦截 U+FFFD 替换字符与非法 UTF-8 字节。
 *
 * 背景（Issue #130）：历史上有一次批量编辑把中文写成了非 UTF-8 编码，
 * 造成用户可见的中文文案损坏（如课表标题、AI 对话提示）。这种损坏
 * 既不会让编译失败，也不会让测试变红，只能在提交/CI 时显式扫描。
 *
 *   node scripts/check-source-encoding.mjs [根目录]
 *
 * 退出码：0 = 通过；1 = 发现损坏。CI 以 `pnpm lint:encoding` 执行。
 *
 * 注意：代码里如需字面表示 U+FFFD，请写成 "\uFFFD" 转义，不要写入原始字符。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPLACEMENT_CHAR_BYTES = Buffer.from('\uFFFD', 'utf8'); // EF BF BD
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs', '.js'];
const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'storage',
  'coverage',
  '.vite',
  'build',
  'test-results',
  'playwright-report',
  '.codegraph',
  '.claude',
];

/** 定位第一个非法 UTF-8 字节；全部合法时返回 -1。 */
function firstInvalidByteOffset(buf) {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) {
      i += 1;
      continue;
    }
    if (b < 0xc2) return i; // 悬空续字节 / overlong 前导
    if (b < 0xe0) {
      if (i + 1 >= buf.length || (buf[i + 1] & 0xc0) !== 0x80) return i;
      i += 2;
      continue;
    }
    if (b < 0xf0) {
      if (i + 2 >= buf.length) return i;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return i;
      if (b === 0xe0 && b1 < 0xa0) return i; // overlong
      if (b === 0xed && b1 >= 0xa0) return i; // UTF-16 代理区
      i += 3;
      continue;
    }
    if (b < 0xf5) {
      if (i + 3 >= buf.length) return i;
      const b1 = buf[i + 1];
      const b2 = buf[i + 2];
      const b3 = buf[i + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return i;
      if (b === 0xf0 && b1 < 0x90) return i; // overlong
      if (b === 0xf4 && b1 >= 0x90) return i; // > U+10FFFF
      i += 4;
      continue;
    }
    return i;
  }
  return -1;
}

/** 把字节偏移换算成 1-based 行列号（列按字节计）。 */
function locate(buf, offset) {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i += 1) {
    if (buf[i] === 0x0a) {
      line += 1;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

function readLineText(buf, offset) {
  let start = offset;
  while (start > 0 && buf[start - 1] !== 0x0a) start -= 1;
  let end = offset;
  while (end < buf.length && buf[end] !== 0x0a) end += 1;
  return buf
    .subarray(start, end)
    .toString('utf8', 0, end - start)
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 120);
}

/**
 * 扫描一棵源码树，返回 { issues, scannedFiles }。
 * issues 项形如 { file, line, column, kind: 'replacement-char' | 'invalid-utf8', lineText }。
 */
export function findEncodingIssues(rootDir, options = {}) {
  const extensions = new Set(options.extensions ?? DEFAULT_EXTENSIONS);
  const excludeDirs = new Set(options.excludeDirs ?? DEFAULT_EXCLUDE_DIRS);
  const issues = [];
  let scannedFiles = 0;

  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        visit(full);
        continue;
      }
      if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
      scannedFiles += 1;

      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      const buf = fs.readFileSync(full);
      const hits = [];
      let at = buf.indexOf(REPLACEMENT_CHAR_BYTES);
      while (at !== -1) {
        hits.push({ offset: at, kind: 'replacement-char' });
        at = buf.indexOf(REPLACEMENT_CHAR_BYTES, at + REPLACEMENT_CHAR_BYTES.length);
      }
      const badUtf8 = firstInvalidByteOffset(buf);
      if (badUtf8 !== -1) hits.push({ offset: badUtf8, kind: 'invalid-utf8' });

      hits.sort((a, b) => a.offset - b.offset);
      for (const hit of hits) {
        const { line, column } = locate(buf, hit.offset);
        issues.push({ file: rel, line, column, kind: hit.kind, lineText: readLineText(buf, hit.offset) });
      }
    }
  };

  visit(path.resolve(rootDir));
  return { issues, scannedFiles };
}

const invokedAsScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedAsScript) {
  const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('..', import.meta.url));
  const { issues, scannedFiles } = findEncodingIssues(rootDir);

  if (issues.length === 0) {
    console.log(
      `✓ 源码编码检查通过：扫描 ${scannedFiles} 个文件（${DEFAULT_EXTENSIONS.join(' ')}），未发现 U+FFFD 或非法 UTF-8 字节。`,
    );
    process.exit(0);
  }

  // 按「文件:行」聚合，避免一行多个替换字符时刷屏
  const groups = new Map();
  for (const issue of issues) {
    const key = `${issue.file}:${issue.line}`;
    let group = groups.get(key);
    if (!group) {
      group = { file: issue.file, line: issue.line, replacementCount: 0, invalidUtf8: false, lineText: issue.lineText };
      groups.set(key, group);
    }
    if (issue.kind === 'replacement-char') group.replacementCount += 1;
    else group.invalidUtf8 = true;
  }

  console.error(`✗ 源码编码检查失败：共 ${issues.length} 处损坏（${groups.size} 行，扫描 ${scannedFiles} 个文件）。\n`);
  for (const group of groups.values()) {
    const kinds = [];
    if (group.replacementCount > 0) {
      kinds.push(group.replacementCount > 1 ? `U+FFFD ×${group.replacementCount}` : 'U+FFFD');
    }
    if (group.invalidUtf8) kinds.push('非法 UTF-8');
    console.error(`  ${group.file}:${group.line}  [${kinds.join(' + ')}]`);
    if (group.lineText) console.error(`    ${group.lineText}`);
  }
  console.error(
    '\n这些字符通常来自非 UTF-8 编码的批量改写（见 Issue #130）。请从 git 历史还原原文，' +
      '并确保编辑器以 UTF-8 保存；如需字面 U+FFFD，请在代码中写 "\\uFFFD" 转义。',
  );
  process.exit(1);
}
