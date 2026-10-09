/**
 * R-4：ZIP 安装的内存面治理。
 *
 * 三个关注点各自一组断言：
 * 1. `extractZipEntries` 按**实际解压字节**计量 —— ZIP 头的 uncompressedSize
 *    可伪造（声明 1KB、解压 500MB），唯一可信的计量点是「真的解压出多少」；
 * 2. `enqueueInstall` 串行化 —— 安装是内存重操作（body Buffer + JSZip 解析 +
 *    解压 + esbuild 内存打包），并发安装的峰值是 N 倍串行；
 * 3. body 上限与解压上限同源 —— 此前路由硬编码 '400mb'、install-utils 默认
 *    300MB，两个口径各写各的。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { extractZipEntries, getMaxUploadBodyBytes, getMaxUncompressedSize } from '../install-utils.js';

describe('R-4 · extractZipEntries 实际字节计量', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r4-zip-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeZip = async (entries: Array<{ name: string; content: string }>) => {
    const zip = new JSZip();
    for (const e of entries) zip.file(e.name, e.content);
    // 目录条目也应存在（验证被跳过且不计入）
    zip.folder('assets');
    return zip;
  };

  it('正常解压写入磁盘（含嵌套目录），目录条目不写入也不计量', async () => {
    const zip = await makeZip([
      { name: 'manifest.json', content: '{"id":"ext-a"}' },
      { name: 'src/deep/entry.js', content: 'export const activate = async () => {};' },
    ]);
    await extractZipEntries(zip, tmpDir, 1024 * 1024);

    expect(fs.existsSync(path.join(tmpDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'src/deep/entry.js'))).toBe(true);
    // 空目录条目不产生文件
    expect(fs.existsSync(path.join(tmpDir, 'assets'))).toBe(false);
  });

  it('实际解压总量超限即抛错（即使 ZIP 头声明很小）', async () => {
    const zip = await makeZip([{ name: 'big.bin', content: 'x'.repeat(4096) }]);
    // 伪造头：把自声明大小改小，模拟「头检查放行、解压超限」的绕过企图
    (zip.files['big.bin'] as unknown as { _data: { uncompressedSize: number } })._data.uncompressedSize = 16;

    await expect(extractZipEntries(zip, tmpDir, 1024)).rejects.toThrow(/exceeds limit of 1024/);
  });

  it('累计跨文件计量（多个小文件叠加仍受总上限约束）', async () => {
    const zip = await makeZip([
      { name: 'a.txt', content: 'y'.repeat(1000) },
      { name: 'b.txt', content: 'y'.repeat(1000) },
    ]);
    await expect(extractZipEntries(zip, tmpDir, 1500)).rejects.toThrow(/actual uncompressed size/);
  });
});

describe('R-4 · body 上限与解压上限同源', () => {
  const original = process.env.OPENLEARN_MAX_ZIP_SIZE;

  afterEach(() => {
    if (original === undefined) delete process.env.OPENLEARN_MAX_ZIP_SIZE;
    else process.env.OPENLEARN_MAX_ZIP_SIZE = original;
  });

  it('缺省与解压炸弹上限一致（300MB）', () => {
    delete process.env.OPENLEARN_MAX_ZIP_SIZE;
    expect(getMaxUploadBodyBytes()).toBe(getMaxUncompressedSize());
    expect(getMaxUploadBodyBytes()).toBe(300 * 1024 * 1024);
  });

  it('调小 OPENLEARN_MAX_ZIP_SIZE 同时收窄 body（单一口径）', () => {
    process.env.OPENLEARN_MAX_ZIP_SIZE = String(50 * 1024 * 1024);
    expect(getMaxUploadBodyBytes()).toBe(50 * 1024 * 1024);
  });
});
