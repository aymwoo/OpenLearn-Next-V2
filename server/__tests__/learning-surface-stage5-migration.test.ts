import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

/**
 * 迁移 076 / 077：阶段 5 存量内容迁移。
 *
 * 覆盖白板 html-applet 的三种来源（courseware / resource / 手写 HTML）、
 * 快照行、空 data 行，以及学案 interactive_courseware 首页块。
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

describe('迁移 076/077：存量内容迁移', () => {
  it('把 html-applet 与 interactive_courseware 迁移到 Surface', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learningsurface-076-'));
    const db = new Database(path.join(dir, 'migrate.db'));
    try {
      const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
      const before = migrations.filter((m) => !m.name.startsWith('076_') && !m.name.startsWith('077_'));
      runMigrations(db, before);

      const now = 1_700_000_000_000;
      db.prepare(
        'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('lesson-s5', '阶段 5 测试', 'content', 'teacher-s5', now, now);

      const insertElement = db.prepare(
        'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      insertElement.run(
        'wb-courseware',
        'lesson-s5',
        'html-applet',
        JSON.stringify({ coursewareUuid: 'cw-1', title: '课件一', x: 10, y: 20, width: 400, height: 300, page: 1 }),
        now,
      );
      insertElement.run(
        'wb-resource',
        'lesson-s5',
        'html-applet',
        JSON.stringify({ resourceId: 'res-1', title: '资源一' }),
        now,
      );
      insertElement.run(
        'wb-inline',
        'lesson-s5',
        'html-applet',
        JSON.stringify({ code: '<h1>Hi</h1>', title: '手写' }),
        now,
      );
      insertElement.run('wb-empty', 'lesson-s5', 'html-applet', JSON.stringify({ title: '空' }), now);
      insertElement.run(
        'snapshot-wb-courseware',
        'snapshot-lesson-s5',
        'html-applet',
        JSON.stringify({ coursewareUuid: 'cw-1', title: '课件一' }),
        now,
      );

      db.prepare(
        `INSERT INTO lesson_activity_blocks
           (id, lesson_id, block_type, content_json, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'block-cw',
        'lesson-s5',
        'interactive_courseware',
        JSON.stringify({ coursewareUuid: 'cw-block', title: '学案课件' }),
        0,
        now,
        now,
      );

      runMigrations(db, migrations);

      const element = (id: string) =>
        db.prepare('SELECT type, data FROM whiteboard_elements WHERE id = ?').get(id) as
          { type: string; data: string } | undefined;
      const surfaceOf = (ownerId: string) =>
        db
          .prepare("SELECT * FROM learning_surfaces WHERE kind = 'whiteboard_element' AND owner_id = ?")
          .get(ownerId) as { id: string; content_ref_json: string } | undefined;

      const coursewareEl = element('wb-courseware')!;
      expect(coursewareEl.type).toBe('learning_surface');
      const coursewareData = JSON.parse(coursewareEl.data);
      expect(coursewareData).toMatchObject({ x: 10, y: 20, width: 400, height: 300, page: 1 });
      expect(coursewareData.surfaceId).toMatch(/^lsm_wb_/);
      expect(JSON.parse(surfaceOf('wb-courseware')!.content_ref_json)).toMatchObject({
        rendererId: 'html_courseware',
        source: { kind: 'courseware', id: 'cw-1' },
      });

      expect(JSON.parse(surfaceOf('wb-resource')!.content_ref_json)).toMatchObject({
        source: { kind: 'resource', id: 'res-1' },
      });

      const inlineSurface = surfaceOf('wb-inline')!;
      const inlineRef = JSON.parse(inlineSurface.content_ref_json);
      expect(inlineRef.source.kind).toBe('courseware');
      expect(inlineRef.source.id).toMatch(/^inline-mig-/);
      const resource = db
        .prepare("SELECT content FROM system_resources WHERE id = ? AND type = 'html'")
        .get(inlineRef.source.id) as { content: string } | undefined;
      expect(resource?.content).toBe('<h1>Hi</h1>');

      // 无来源的空元素保持原样，不产生 Surface。
      expect(element('wb-empty')!.type).toBe('html-applet');
      expect(surfaceOf('wb-empty')).toBeUndefined();

      // 快照行同步迁移，保证 resetWhiteboard 恢复后仍是 learning_surface。
      expect(element('snapshot-wb-courseware')!.type).toBe('learning_surface');

      const block = db.prepare('SELECT surface_id FROM lesson_activity_blocks WHERE id = ?').get('block-cw') as {
        surface_id: string;
      };
      expect(block.surface_id).toMatch(/^lsm_lb_/);
      const blockSurface = db
        .prepare("SELECT * FROM learning_surfaces WHERE kind = 'lesson_block' AND owner_id = 'block-cw'")
        .get() as { content_ref_json: string };
      expect(JSON.parse(blockSurface.content_ref_json)).toMatchObject({
        rendererId: 'html_courseware',
        source: { kind: 'courseware', id: 'cw-block' },
      });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
