/**
 * path-guard 单元测试（SEC-LOW-01）
 *
 * 核心回归：裸 startsWith 前缀判断会被同级目录逃逸
 * （root=/a/b 时 /a/b2/c 也通过），统一守卫必须拒绝。
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { isPathInsideRoot, safeJoin } from '../utils/path-guard.js';

describe('isPathInsideRoot', () => {
  it('同级前缀目录逃逸被拒绝（核心回归）', () => {
    // /a/storage/courseware/res2 与 /a/storage/courseware/res 前缀相同但目录不同
    expect(isPathInsideRoot('/a/storage/courseware/res', '/a/storage/courseware/res2/evil.txt')).toBe(false);
    expect(isPathInsideRoot(path.join(os.tmpdir(), 'root'), path.join(os.tmpdir(), 'root2', 'x'))).toBe(false);
  });

  it('root 内部路径放行', () => {
    expect(isPathInsideRoot('/a/b', '/a/b/c')).toBe(true);
    expect(isPathInsideRoot('/a/b', '/a/b/c/d/e.txt')).toBe(true);
  });

  it('target 等于 root 本身拒绝（防 root 被写/读）', () => {
    expect(isPathInsideRoot('/a/b', '/a/b')).toBe(false);
  });

  it('.. 逃逸归一后拒绝', () => {
    expect(isPathInsideRoot('/a/b', '/a/b/../../evil')).toBe(false);
    expect(isPathInsideRoot('/a/b', '/a/b/../b2/c')).toBe(false);
  });

  it('相对路径 target 也按 resolve 后判定', () => {
    const root = path.join(os.tmpdir(), 'pg-root');
    expect(isPathInsideRoot(root, path.join(root, 'sub', 'f.txt'))).toBe(true);
  });

  it('root 带尾分隔符或不带均可', () => {
    expect(isPathInsideRoot('/a/b/', '/a/b/c')).toBe(true);
    expect(isPathInsideRoot('/a/b', '/a/b/c')).toBe(true);
  });

  it('空入参拒绝', () => {
    expect(isPathInsideRoot('', '/a/b')).toBe(false);
    expect(isPathInsideRoot('/a/b', '')).toBe(false);
  });
});

describe('safeJoin', () => {
  it('根内相对路径返回 resolve 后的绝对路径', () => {
    expect(safeJoin('/a/b', 'c/d.txt')).toBe(path.resolve('/a/b', 'c/d.txt'));
  });

  it('.. 逃逸返回 null', () => {
    expect(safeJoin('/a/b', '../evil.txt')).toBeNull();
    expect(safeJoin('/a/b', 'c/../../../evil.txt')).toBeNull();
  });

  it('绝对路径 relative 若在根外返回 null', () => {
    expect(safeJoin('/a/b', '/etc/passwd')).toBeNull();
  });

  it('同级前缀目录逃逸返回 null（核心回归）', () => {
    expect(safeJoin('/a/storage/courseware/res', '../res2/evil.txt')).toBeNull();
  });

  it('空入参返回 null', () => {
    expect(safeJoin('/a/b', '')).toBeNull();
    expect(safeJoin('', 'c')).toBeNull();
  });
});
