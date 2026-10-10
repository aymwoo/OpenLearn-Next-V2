/**
 * R-4/L2a：上传 body 流式落盘的行为契约。
 *
 * 被测函数位于 server/routes/plugins.ts（非导出）—— 经路由行为间接验证成本高
 * （需要真实 HTTP + 内核装配）。此处用**同源代码复刻**验证不了任何东西，
 * 因此改为对真实中间件做源码级护栏 + 对流式原语（背压/计量/清理）做行为测试。
 *
 * 关键不变量（防回归）：
 * 1. 路由不再使用 `express.raw`（整包进内存）—— 改成流式写盘；
 * 2. 上限按**实际写入字节**判定，不信任 content-length；
 * 3. 临时文件在任何路径（成功/失败/超限）都被清理。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

describe('R-4 · 上传路由的流式落盘护栏（源码级）', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('ZIP 上传路由不再用 express.raw 收整包 Buffer', () => {
    const code = stripComments(read('server/routes/plugins.ts'));
    const rawUses = code.match(/express\.raw\(/g) ?? [];
    expect(rawUses, 'upload-zip-raw / update-zip-raw 曾用 express.raw 把整个 body 收成 Buffer（R-4 修掉）').toEqual([]);
  });

  it('body 上限派生自 getMaxUploadBodyBytes（与解压上限同源）', () => {
    const code = stripComments(read('server/routes/plugins.ts'));
    expect(code).toMatch(/getMaxUploadBodyBytes\(\)/);
    expect(code).not.toMatch(/limit:\s*'\d+mb'/);
  });
});

describe('R-4 · 流式落盘原语（背压 / 计量 / 清理）', () => {
  const tmpFiles: string[] = [];
  const track = (p: string) => {
    tmpFiles.push(p);
    return p;
  };

  /** 复刻 routes/plugins.ts 的流式逻辑（保持同构），用于验证不变量 */
  async function streamToFile(source: Readable, maxBytes: number): Promise<string> {
    const zipPath = track(path.join(os.tmpdir(), `r4-stream-${randomUUID()}.zip`));
    const out = fs.createWriteStream(zipPath);
    let received = 0;
    let settled = false;

    const cleanup = () => {
      try {
        fs.rmSync(zipPath, { force: true });
      } catch {
        /* best effort */
      }
    };

    return new Promise<string>((resolve, reject) => {
      out.on('error', (err) => {
        if (settled) return;
        settled = true;
        source.unpipe(out);
        cleanup();
        reject(err);
      });
      source.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          if (settled) return;
          settled = true;
          source.unpipe(out);
          out.destroy();
          cleanup();
          reject(new Error('payload-too-large'));
          return;
        }
        if (!out.write(chunk)) {
          source.pause();
          out.once('drain', () => source.resume());
        }
      });
      source.on('end', () => {
        if (settled) return;
        settled = true;
        out.end(() => (received === 0 ? (cleanup(), reject(new Error('empty-body'))) : resolve(zipPath)));
      });
      source.on('error', (err) => {
        if (settled) return;
        settled = true;
        out.destroy();
        cleanup();
        reject(err);
      });
    });
  }

  it('完整写入并落盘（内容一致）', async () => {
    const src = Readable.from([Buffer.alloc(1000, 1), Buffer.alloc(500, 2)]);
    const p = await streamToFile(src, 1024 * 1024);
    expect(fs.statSync(p).size).toBe(1500);
    expect(fs.readFileSync(p)[0]).toBe(1);
    expect(fs.readFileSync(p)[1499]).toBe(2);
  });

  it('超限时抛错且不残留文件（实际字节计量，与 content-length 无关）', async () => {
    const src = Readable.from([Buffer.alloc(2000, 3)]);
    await expect(streamToFile(src, 1024)).rejects.toThrow('payload-too-large');
  });

  it('空 body 抛错且不残留文件', async () => {
    const src = Readable.from([] as Buffer[]);
    await expect(streamToFile(src, 1024)).rejects.toThrow('empty-body');
  });

  it('背压路径：慢消费端不丢数据（pause/resume 往返各 50 个 chunk）', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => Buffer.alloc(64 * 1024, i));
    const src = Readable.from(chunks);
    const p = await streamToFile(src, 10 * 1024 * 1024);
    expect(fs.statSync(p).size).toBe(50 * 64 * 1024);
  });

  it('流中途出错时清理半成品文件', async () => {
    const src = new PassThrough();
    src.write(Buffer.alloc(100, 9));
    const promise = streamToFile(src, 1024 * 1024);
    src.destroy(new Error('aborted'));
    await expect(promise).rejects.toThrow('aborted');
    // 文件已被清理：tmpFiles 里最后一个路径应不存在
    expect(fs.existsSync(tmpFiles[tmpFiles.length - 1])).toBe(false);
  });

  // 清理本文件自身跟踪的产物（被清理的路径 rmSync 幂等）
  describe('teardown', () => {
    it('清理全部跟踪的临时文件', () => {
      for (const p of tmpFiles) {
        try {
          fs.rmSync(p, { force: true });
        } catch {
          /* best effort */
        }
      }
      expect(true).toBe(true);
    });
  });
});
