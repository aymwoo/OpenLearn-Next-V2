import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { ResourceService } from '../resource-service.js';

describe('ResourceService 领域服务单元测试 (E3 深化)', () => {
  let service: ResourceService;
  const db = kernelContainer.db;

  const testResId1 = 'res-test-html-01';
  const testResId2 = 'res-test-folder-02';

  const mockAiInjector = async (_db: any, html: string) => {
    return `${html}<!-- injected AI submit -->`;
  };

  beforeAll(async () => {
    service = new ResourceService(db, mockAiInjector);
    await runStartupMigrations(db);
    const now = Date.now();

    // 清理脏数据
    db.prepare('DELETE FROM system_resources WHERE id LIKE ?').run('res-test-%');
    db.prepare('DELETE FROM courseware WHERE id LIKE ?').run('res-test-%');

    // 种子数据 1: HTML 单文件
    db.prepare(
      'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testResId1, '物理仿真实验.html', 'html', '<html><body><h1>物理实验</h1></body></html>', now - 1000);

    // 种子数据 2: Folder 目录包
    const folderFiles = JSON.stringify([
      { path: 'index.html', content: '<html><body>入口</body></html>' },
      { path: 'css/style.css', content: 'body { color: red; }' },
      { path: 'images/dot.png', content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    ]);
    db.prepare(
      'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(testResId2, '探究牛顿环课件包', 'folder', folderFiles, now);
  });

  afterAll(() => {
    // 清理生成的磁盘缓存
    for (const id of [testResId1, testResId2]) {
      const p = path.resolve(process.cwd(), 'storage', 'courseware', id);
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  });

  describe('1. 资源列表与检索 (listResources & getResource)', () => {
    it('正确按时间倒序返回所有资源列表', () => {
      const list = service.listResources();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const r1 = list.find((r) => r.id === testResId1);
      const r2 = list.find((r) => r.id === testResId2);
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
      expect(list.indexOf(r2!)).toBeLessThan(list.indexOf(r1!)); // r2 newer than r1
    });

    it('根据 ID 查询资源详情，不存在返回 null', () => {
      const r = service.getResource(testResId1);
      expect(r).toBeDefined();
      expect(r?.name).toBe('物理仿真实验.html');

      const non = service.getResource('non-existent-res');
      expect(non).toBeNull();
    });
  });

  describe('2. 课件物理缓存与表登记 (prepareCoursewareCache)', () => {
    it('为单页面 HTML 资源自动注册到 courseware 表并在磁盘生成缓存', () => {
      const res = service.getResource(testResId1)!;
      const entry = service.prepareCoursewareCache(res);
      expect(entry).toBe('物理仿真实验.html');

      // 验证 courseware 表登记
      const cw = db.prepare('SELECT * FROM courseware WHERE id = ?').get(testResId1) as any;
      expect(cw).toBeDefined();
      expect(cw.type).toBe('html');

      // 验证物理磁盘写入
      const diskFile = path.resolve(process.cwd(), 'storage', 'courseware', testResId1, 'index.html');
      expect(fs.existsSync(diskFile)).toBe(true);
    });

    it('为 Folder 资源解包并生成多文件结构缓存', () => {
      const res = service.getResource(testResId2)!;
      const entry = service.prepareCoursewareCache(res);
      expect(entry).toBe('index.html');

      // 验证物理磁盘解包
      const cssFile = path.resolve(process.cwd(), 'storage', 'courseware', testResId2, 'css', 'style.css');
      expect(fs.existsSync(cssFile)).toBe(true);
      expect(fs.readFileSync(cssFile, 'utf8')).toContain('color: red');

      const imgFile = path.resolve(process.cwd(), 'storage', 'courseware', testResId2, 'images', 'dot.png');
      expect(fs.existsSync(imgFile)).toBe(true);
    });
  });

  describe('3. 资源子路径解析 (resolveResourceContent)', () => {
    it('正确解析单 HTML 内容与 Content-Type', () => {
      const res = service.getResource(testResId1)!;
      const resolved = service.resolveResourceContent(res);
      expect(resolved.contentType).toContain('text/html');
      expect(resolved.isBinary).toBe(false);
      expect(resolved.content).toContain('物理实验');
    });

    it('单 HTML 资源访问非 index.html 子路径时抛出 404', () => {
      const res = service.getResource(testResId1)!;
      expect(() => service.resolveResourceContent(res, 'sub/other.html')).toThrow(
        'Not found for single page HTML resource',
      );
    });

    it('Folder 资源正确解析文本与二进制静态文件', () => {
      const res = service.getResource(testResId2)!;
      const resolvedCss = service.resolveResourceContent(res, 'css/style.css');
      expect(resolvedCss.contentType).toBe('text/css; charset=utf-8');
      expect(resolvedCss.isBinary).toBe(false);

      const resolvedPng = service.resolveResourceContent(res, 'images/dot.png');
      expect(resolvedPng.contentType).toBe('image/png');
      expect(resolvedPng.isBinary).toBe(true);
      expect(Buffer.isBuffer(resolvedPng.content)).toBe(true);
    });
  });

  describe('4. 资源创建与 AI 自动评测衍生 (createResource & deleteResource)', () => {
    it('创建包含 score 标记的 HTML 资源时，自动生成 [自动提交版] 变体', async () => {
      const created = await service.createResource({
        name: '力学互动自测',
        type: 'html',
        content: '<div>本次测验成绩: <span id="score">100</span></div>',
      });

      expect(created.success).toBe(true);
      expect(created.aiAutoSubmitCreated).toBe(true);

      // 验证 DB 中存在主资源与衍生版本
      const list = service.listResources();
      const derived = list.find((r) => r.name.includes('[自动提交版] 力学互动自测'));
      expect(derived).toBeDefined();

      // 删除测试资源
      service.deleteResource(created.id);
      if (derived) service.deleteResource(derived.id);
    });

    it('删除资源后查询返回空', () => {
      const created = db.prepare(
        'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('res-test-delete', '测试删除', 'html', '', Date.now());

      const deleted = service.deleteResource('res-test-delete');
      expect(deleted).toBe(true);
      expect(service.getResource('res-test-delete')).toBeNull();
    });
  });
});
