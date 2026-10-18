import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEncodingIssues } from '../check-source-encoding.mjs';

const tempDirs: string[] = [];

function makeTree(files: Record<string, Buffer | string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'encoding-check-'));
  tempDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('check-source-encoding', () => {
  it('干净源码（含 \\uFFFD 转义写法）不产生问题', () => {
    const root = makeTree({
      'src/a.ts': 'const label = "未设定内容 (上课时自由选择)";\nconst escaped = "\\uFFFD";\n',
    });
    const { issues, scannedFiles } = findEncodingIssues(root);
    expect(issues).toEqual([]);
    expect(scannedFiles).toBe(1);
  });

  it('检出字面量 U+FFFD 并给出文件与行号', () => {
    const root = makeTree({
      'src/ok.ts': 'const fine = 1;\n',
      'src/bad.ts': 'const first = 1;\n// 未设定内\uFFFD容\n',
    });
    const { issues } = findEncodingIssues(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'src/bad.ts', line: 2, kind: 'replacement-char' });
  });

  it('检出非法 UTF-8 字节（历史上 GBK 写入的残留）', () => {
    // 「─」的 GBK 字节 A9 A4：非法 UTF-8，正是 Issue #130 里乱码注释的典型痕迹
    const root = makeTree({
      'server/x.ts': Buffer.concat([Buffer.from('// '), Buffer.from([0xa9, 0xa4]), Buffer.from(' divider\n')]),
    });
    const { issues } = findEncodingIssues(root);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'server/x.ts', line: 1, kind: 'invalid-utf8' });
  });

  it('忽略 node_modules / dist 与非代码扩展名', () => {
    const root = makeTree({
      'node_modules/pkg/bad.ts': 'x \uFFFD\n',
      'dist/out.ts': 'x \uFFFD\n',
      'docs/note.md': 'x \uFFFD\n',
      'src/ok.tsx': 'const ok = 1;\n',
    });
    const { issues, scannedFiles } = findEncodingIssues(root);
    expect(issues).toEqual([]);
    expect(scannedFiles).toBe(1);
  });
});
