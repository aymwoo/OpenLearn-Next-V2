/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { FileStorageExtensionRegistry } from '../../../packages/core/di/file-storage-extension-registry.js';
import type { FileStorageBackend } from '../../../packages/core/di/interfaces.js';
import { parseFileReorgArgs, runFileReorg } from '../../../scripts/file-reorg.js';
import {
  FileProcessorRunner,
  FileStorageService,
  LayoutValidationError,
  LocalFileStorage,
  assertValidStorageKey,
  createBuiltinPdfPageCountProcessor,
  renderStorageKey,
  sanitizeFilenameKeepExt,
  validateLayoutTemplate,
} from '../file-storage/index.js';

const db = () => kernelContainer.db as any;

async function drainStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('FileStorage 架构核心单元测试', () => {
  let tmpRoot: string;
  const createdAssetIds: string[] = [];

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-fs-unit-'));
  });

  afterEach(async () => {
    const svc = new FileStorageService(db(), {
      localRootDir: path.join(tmpRoot, 'files'),
      registerBuiltinPdfProcessor: false,
    });
    for (const assetId of createdAssetIds.splice(0)) {
      await svc.purgeAsset(assetId).catch(() => {});
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('LayoutPolicy（路径策略与安全校验）', () => {
    it('清洗中文与特殊字符文件名并保留扩展名', () => {
      const sanitized = sanitizeFilenameKeepExt('../../课件 (第一讲) 2026?.PDF', 'abcd1234');
      expect(sanitized).toBe('课件-第一讲-2026-abcd1234.pdf');

      const fallbackName = sanitizeFilenameKeepExt('...///', 'xyz999');
      expect(fallbackName).toBe('file-xyz999');
    });

    it('拒绝目录穿越、绝对路径、盘符、未知占位符与缺少唯一占位符的模板', () => {
      expect(() => validateLayoutTemplate('')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('/abs/{safeName}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('..\\evil\\{safeName}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('C:\\bad\\{safeName}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('../escape/{safeName}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('folder/{unknownToken}/{safeName}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('{yyyy}/{MM}/{purpose}')).toThrow(LayoutValidationError);
      expect(() => validateLayoutTemplate('unmatched/{safeName')).toThrow(LayoutValidationError);

      expect(() => validateLayoutTemplate('{school}/{purpose}/{hash8}{ext}', ['school'])).not.toThrow();
    });

    it('支持内置方案渲染与自定义 Token 清洗', () => {
      const fixedNow = new Date(Date.UTC(2026, 10, 5, 8, 9, 10));
      const baseInput = {
        context: {
          purpose: 'courseware-asset',
          courseId: 'crs/../../101',
          lessonId: 'les 2',
          authorId: 'usr_teacher',
        },
        originalName: '几何 课件.pptx',
        assetId: '01950000-0000-7000-8000-00000000abcd',
        sha256: 'deadbeef00112233',
        now: fixedNow,
      };

      const byDate = renderStorageKey({ config: { layout: { scheme: 'by-date' } }, ...baseInput });
      expect(byDate).toMatch(/^2026\/11\/05\/courseware-asset\/几何-课件-0000abcd\.pptx$/);

      const byCourse = renderStorageKey({ config: { layout: { scheme: 'by-course' } }, ...baseInput });
      expect(byCourse).not.toContain('/../');
      expect(byCourse).toMatch(/^crs-\.\.-\.\.-101\/les-2\/courseware-asset\/几何-课件-0000abcd\.pptx$/);

      const flat = renderStorageKey({ config: { layout: { scheme: 'flat' } }, ...baseInput });
      expect(flat).toBe('几何-课件-0000abcd.pptx');

      const custom = renderStorageKey({
        config: { layout: { scheme: 'custom', template: '{school}/{hash8}{ext}' } },
        ...baseInput,
        customResolvers: new Map([['school', { resolver: () => '../No.1 Middle School' }]]),
      });
      expect(custom).toBe('No.1-Middle-School/deadbeef.pptx');
      expect(() => assertValidStorageKey('../bad')).toThrow(LayoutValidationError);
    });
  });

  describe('LocalFileStorage（物理后端读写、Range 与逃逸拦截）', () => {
    it('支持原子写入、stat、Range 流读取、复制与删除', async () => {
      const backend = new LocalFileStorage(path.join(tmpRoot, 'local-store'));
      const data = Buffer.from('0123456789abcdef', 'utf8');
      await backend.put('2026/11/sample.bin', data);

      expect(await backend.exists('2026/11/sample.bin')).toBe(true);
      expect(await backend.stat('2026/11/sample.bin')).toEqual({ sizeBytes: 16 });

      const partial = await drainStream(backend.readStream('2026/11/sample.bin', { start: 4, end: 9 }));
      expect(partial.toString('utf8')).toBe('456789');

      await backend.copy('2026/11/sample.bin', 'archive/copied.bin');
      const copied = await drainStream(backend.readStream('archive/copied.bin'));
      expect(copied.equals(data)).toBe(true);

      await backend.delete('2026/11/sample.bin');
      expect(await backend.exists('2026/11/sample.bin')).toBe(false);
    });

    it('拒绝根目录越界访问', async () => {
      const backend = new LocalFileStorage(path.join(tmpRoot, 'local-store'));
      await expect(backend.put('../escape.txt', Buffer.from('nope'))).rejects.toThrow();
    });
  });

  describe('FileStorageExtensionRegistry（原型保持与去重注册检查）', () => {
    it('保存类实例而不丢失原型链与私有字段', async () => {
      class MemoryBackend implements FileStorageBackend {
        readonly id = 'mem-proto';
        readonly displayName = 'Memory Prototype Test';
        readonly capabilities = { supportsRange: false, supportsPresignedUrl: false, externalBacked: false };
        #store = new Map<string, Buffer>();

        async put(key: string, data: Buffer) {
          this.#store.set(key, Buffer.from(data));
        }
        async exists(key: string) {
          return this.#store.has(key);
        }
        async stat(key: string) {
          const buf = this.#store.get(key);
          return buf ? { sizeBytes: buf.length } : null;
        }
        readStream(key: string) {
          return Readable.from(this.#store.get(key) ?? Buffer.alloc(0));
        }
        async copy(fromKey: string, toKey: string) {
          const buf = this.#store.get(fromKey);
          if (buf) this.#store.set(toKey, Buffer.from(buf));
        }
        async delete(key: string) {
          this.#store.delete(key);
        }
      }

      const registry = new FileStorageExtensionRegistry();
      registry.registerBackend('test-plugin', new MemoryBackend());
      expect(() => registry.registerBackend('other-plugin', new MemoryBackend())).toThrow();

      const resolved = registry.getBackend('mem-proto')!;
      await resolved.put('k/1.txt', Buffer.from('hello private field'));
      expect(await resolved.exists('k/1.txt')).toBe(true);
      expect((await drainStream(await resolved.readStream('k/1.txt'))).toString('utf8')).toBe('hello private field');
    });
  });

  describe('FileProcessorRunner（生命周期、Fail Policy 与安全头防护）', () => {
    it('before-store 为 fail-closed；after-store 为 fail-open + 后台并发合并；before-serve 屏蔽安全敏感头', async () => {
      const registry = new FileStorageExtensionRegistry();

      registry.registerProcessor('test', {
        id: 'before-mutator',
        stage: 'before-store',
        priority: 1,
        async run(ctx) {
          if (ctx.originalName.endsWith('.blocked')) {
            throw new Error('Blocked extension');
          }
          return { metadataPatch: { scanned: true } };
        },
      });

      registry.registerProcessor('test', {
        id: 'after-broken-sync',
        stage: 'after-store',
        priority: 1,
        async run() {
          throw new Error('non-fatal sync crash');
        },
      });

      let bgPatchDelivered: Record<string, unknown> | null = null;
      registry.registerProcessor('test', {
        id: 'after-bg',
        stage: 'after-store',
        priority: 2,
        background: true,
        async run() {
          return { metadataPatch: { bgIndexed: true } };
        },
      });

      registry.registerProcessor('test', {
        id: 'serve-headers',
        stage: 'before-serve',
        async run() {
          return {
            headers: {
              'Content-Type': 'text/html',
              'Content-Security-Policy': 'default-src *',
              'X-Content-Type-Options': 'invalid',
              'Content-Disposition': 'inline',
              'Cache-Control': 'public',
              'X-Custom-Plugin-Tag': 'openlearn-ok',
            },
          };
        },
      });

      const runner = new FileProcessorRunner(registry);

      await expect(
        runner.runBeforeStore({
          buffer: Buffer.from('x'),
          originalName: 'bad.blocked',
          mime: 'application/octet-stream',
          context: { purpose: 'attachment' },
          metadata: {},
        }),
      ).rejects.toThrow('Blocked extension');

      const beforeOk = await runner.runBeforeStore({
        buffer: Buffer.from('ok'),
        originalName: 'doc.txt',
        mime: 'text/plain',
        context: { purpose: 'attachment' },
        metadata: {},
      });
      expect(beforeOk.metadata.scanned).toBe(true);

      await runner.runAfterStore(
        {
          assetId: 'asset-1',
          storageKey: '2026/11/doc.txt',
          backendId: 'local',
          originalName: 'doc.txt',
          mime: 'text/plain',
          sizeBytes: 2,
          sha256: 'abc',
          context: { purpose: 'attachment' },
          metadata: {},
        },
        (patch) => {
          bgPatchDelivered = patch;
        },
      );
      await vi.waitFor(() => {
        expect(bgPatchDelivered).toEqual({ bgIndexed: true });
      });

      const serveHeaders = await runner.runBeforeServe({
        assetId: 'asset-1',
        storageKey: '2026/11/doc.txt',
        backendId: 'local',
        originalName: 'doc.txt',
        mime: 'text/plain',
        sizeBytes: 2,
        sha256: 'abc',
        context: { purpose: 'attachment' },
        metadata: {},
      });
      expect(serveHeaders).toEqual({ 'X-Custom-Plugin-Tag': 'openlearn-ok' });

      const pdfProc = createBuiltinPdfPageCountProcessor();
      const fakePdf = Buffer.from('%PDF-1.4\n/Type /Page\n/Type /Page\n');
      const pdfRes = await pdfProc.run({
        stage: 'after-store',
        originalName: 'slides.pdf',
        mime: 'application/pdf',
        sizeBytes: fakePdf.length,
        buffer: fakePdf,
        context: { purpose: 'courseware' },
        metadata: {},
      });
      expect(pdfRes?.metadataPatch?.slideCount).toBe(2);
    });
  });

  describe('FileStorageService（去重、引用计数、别名、软删清除与 reorg 重整）', () => {
    it('按 SHA-256 同后端去重、skipDedup 独立落盘、仅归零时物理删除并支持旧路径别名', async () => {
      const publishedEvents: Array<{ type: string; payload: any }> = [];
      const svc = new FileStorageService(db(), {
        localRootDir: path.join(tmpRoot, 'files'),
        eventBus: {
          publish: async (ev: any) => {
            publishedEvents.push(ev);
          },
        },
      });

      const payload = Buffer.from(`shared-binary-content-${Date.now()}`);
      const first = await svc.store({
        buffer: payload,
        originalName: '图谱.png',
        mime: 'image/png',
        aliases: ['legacy-uuid-first.png'],
        context: { purpose: 'courseware-asset', accessScope: 'public', courseId: 'c1' },
      });
      createdAssetIds.push(first.assetId);
      expect(first.deduplicated).toBe(false);
      expect(publishedEvents.some((e) => e.type === 'file.stored' && e.payload.assetId === first.assetId)).toBe(true);

      const second = await svc.store({
        buffer: payload,
        originalName: '图谱副本.png',
        mime: 'image/png',
        context: { purpose: 'courseware-asset', accessScope: 'authenticated', courseId: 'c2' },
      });
      createdAssetIds.push(second.assetId);
      expect(second.deduplicated).toBe(true);
      expect(second.blobId).toBe(first.blobId);
      expect(second.assetId).not.toBe(first.assetId);

      // 别名查询可读出逻辑资产（保持独立 accessScope）
      const byAlias = svc.getAssetByAlias('legacy-uuid-first.png');
      expect(byAlias?.id).toBe(first.assetId);
      expect(byAlias?.accessScope).toBe('public');

      // skipDedup 生成独立物理 Blob（用于作业隔离）
      const isolated = await svc.store({
        buffer: payload,
        originalName: 'student-work.png',
        mime: 'image/png',
        skipDedup: true,
        context: { purpose: 'assignment', accessScope: 'assignment', authorId: 'stu_1' },
      });
      createdAssetIds.push(isolated.assetId);
      expect(isolated.deduplicated).toBe(false);
      expect(isolated.blobId).not.toBe(first.blobId);

      // 软删除使 getAsset/getAssetByAlias 返回 null，purgeAsset 按引用计数保留共有物理文件
      svc.softDelete(first.assetId);
      expect(svc.getAsset(first.assetId)).toBeNull();
      expect(svc.getAssetByAlias('legacy-uuid-first.png')).toBeNull();

      await svc.purgeAsset(first.assetId);
      const blobStillExists = await new LocalFileStorage(path.join(tmpRoot, 'files')).exists(second.storageKey);
      expect(blobStillExists).toBe(true);

      // purge 最后一个引用后，物理 Blob 被删除
      await svc.purgeAsset(second.assetId);
      const blobAfterLastPurge = await new LocalFileStorage(path.join(tmpRoot, 'files')).exists(second.storageKey);
      expect(blobAfterLastPurge).toBe(false);
    });

    it('reorgAssets 支持 dry-run 与真实迁移且保持 assetId 和 alias 恒定', async () => {
      const filesDir = path.join(tmpRoot, 'files');
      const svc = new FileStorageService(db(), {
        localRootDir: filesDir,
        registerBuiltinPdfProcessor: false,
      });

      const content = Buffer.from(`reorg-content-${Date.now()}`);
      const stored = await svc.store({
        buffer: content,
        originalName: 'demo-slide.pdf',
        mime: 'application/pdf',
        aliases: ['reorg-legacy.pdf'],
        context: {
          purpose: 'courseware-asset',
          courseId: 'course-99',
          lessonId: 'lesson-88',
          accessScope: 'authenticated',
        },
      });
      createdAssetIds.push(stored.assetId);

      // 去重共享同一物理 Blob 应按 ROW_NUMBER 只搬一次
      const dup = await svc.store({
        buffer: content,
        originalName: 'demo-slide-dup.pdf',
        mime: 'application/pdf',
        context: { purpose: 'courseware-asset', courseId: 'course-other', lessonId: 'lesson-other' },
      });
      createdAssetIds.push(dup.assetId);

      const cliDrySummary = await runFileReorg(svc, ['--dry-run', '--template', 'reorg/{courseId}/{safeName}']);
      expect(cliDrySummary.planned).toBeGreaterThanOrEqual(1);
      expect(cliDrySummary.moved).toBe(0);
      const dryEntry = cliDrySummary.plan.find((p) => p.blobId === stored.blobId);
      expect(dryEntry?.status).toBe('planned');
      expect(dryEntry?.toKey.startsWith('reorg/course-99/demo-slide-')).toBe(true);

      const parsed = parseFileReorgArgs(['--template', 'reorg/{courseId}/{safeName}', '--limit', '5']);
      expect(parsed.scheme).toBe('custom');
      expect(parsed.limit).toBe(5);

      const applySummary = await runFileReorg(svc, ['--template', 'reorg/{courseId}/{safeName}']);
      const movedEntry = applySummary.plan.find((p) => p.blobId === stored.blobId);
      expect(movedEntry?.status).toBe('moved');

      const refreshed = svc.getAsset(stored.assetId)!;
      const refreshedDup = svc.getAsset(dup.assetId)!;
      expect(refreshed.storageKey).toBe(movedEntry!.toKey);
      expect(refreshedDup.storageKey).toBe(movedEntry!.toKey);
      expect(svc.getAssetByAlias('reorg-legacy.pdf')?.id).toBe(stored.assetId);

      const backend = new LocalFileStorage(filesDir);
      expect(await backend.exists(stored.storageKey)).toBe(false);
      expect(await backend.exists(refreshed.storageKey)).toBe(true);
    });
  });
});
