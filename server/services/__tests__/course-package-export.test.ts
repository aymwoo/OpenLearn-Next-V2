import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { runStartupMigrations } from '../../bootstrap-db.js';
import { kernelContainer } from '../../../packages/core/kernel/index.js';
import { exportLessonAsCoursePackage, buildExportFilename } from '../course-package-export.js';
import { parseCoursePackage } from '../course-package.js';

const db = kernelContainer.db;
const lessonId = 'cpkg-export-service-lesson';
const TITLE = '【CPKG-EXPORT-TEST】脏数据规范化';

function insertLesson(params: { content?: string | null; timeline: unknown }) {
  const now = Date.now();
  db.prepare(
    'INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    lessonId,
    TITLE,
    params.content ?? null,
    JSON.stringify(params.timeline),
    'manual',
    'usr-cpkg-export',
    now,
    now,
  );
}

function purge() {
  db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(lessonId);
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
}

describe('course package export（历史数据规范化）', () => {
  beforeAll(async () => {
    await runStartupMigrations(db as unknown as import('../../bootstrap-db.js').MigrationDb);
  });

  beforeEach(() => purge());
  afterAll(() => purge());

  it('normalizes null fields, duplicate segment ids and unsupported elements', async () => {
    insertLesson({
      content: null,
      timeline: [
        // 历史环节：可选项为 null、标题为空、id 重复
        { id: 'seg-a', title: '', type: '', duration: null, notes: null, color: null },
        { id: 'seg-a', title: '重复环节', type: 'lecture' },
      ],
    });

    const now = Date.now();
    const insertElement = db.prepare(
      'INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    // 快照标记：不属于教学内容
    insertElement.run('snap-1', lessonId, 'snapshot_marker', '{}', now);
    // 导入端不认识的元素类型：导出时必须跳过，否则导出包导不回去
    insertElement.run('unknown-1', lessonId, 'mystery-widget', '{}', now);
    // 正常元素：坐标/分页在 data 里，导出时提升为顶层字段
    insertElement.run(
      'text-1',
      lessonId,
      'text',
      JSON.stringify({ text: '你好', segmentId: 'seg-a', x: 10, y: 20, width: 100, height: 40, page: 0 }),
      now,
    );

    const { package: pkg, stats } = await exportLessonAsCoursePackage(lessonId);

    expect(stats.skippedElements).toBe(1);
    expect(pkg.lesson.timeline).toHaveLength(2);
    // 空标题 / 空类型得到可导入的兜底值
    expect(pkg.lesson.timeline[0].title).toBeTruthy();
    expect(pkg.lesson.timeline[0].type).toBeTruthy();
    // null 可选项被省略（zod 的 optional 不接受 null）
    expect(pkg.lesson.timeline[0]).not.toHaveProperty('duration');
    expect(pkg.lesson.timeline[0]).not.toHaveProperty('color');
    // 重复 id 被重命名，第二个环节仍然保留
    expect(pkg.lesson.timeline[0].id).toBe('seg-a');
    expect(pkg.lesson.timeline[1].id).not.toBe('seg-a');
    // 空正文导出为空字符串（而不是 null）
    expect(pkg.lesson.content).toBe('');

    expect(pkg.elements).toHaveLength(1);
    const text = pkg.elements[0];
    expect(text.type).toBe('text');
    expect(text.x).toBe(10);
    expect(text.page).toBe(0);
    // 几何字段提升到顶层后不再在 data 里重复出现
    expect(text.data).not.toHaveProperty('x');
    expect(text.data).not.toHaveProperty('segmentId');

    // 自检：导出的包必须能通过导入端校验
    expect(parseCoursePackage(pkg).ok).toBe(true);
  });

  it('drops element references to segments that do not exist', async () => {
    insertLesson({ timeline: [{ id: 'seg-only', title: '唯一环节', type: 'lecture' }] });
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'orphan-1',
      lessonId,
      'text',
      JSON.stringify({ text: 'x', segmentId: 'seg-missing' }),
      Date.now(),
    );

    const { package: pkg } = await exportLessonAsCoursePackage(lessonId);
    expect(pkg.elements).toHaveLength(1);
    expect(pkg.elements[0]).not.toHaveProperty('segmentId');
    expect(parseCoursePackage(pkg).ok).toBe(true);
  });

  it('builds a safe download filename from the lesson title', () => {
    expect(buildExportFilename('第 3 章 / 函数: 入门?')).toBe('第 3 章 _ 函数_ 入门_.openlearn-package.json');
    expect(buildExportFilename('   ')).toBe('course.openlearn-package.json');
    expect(buildExportFilename('a'.repeat(200)).length).toBeLessThanOrEqual(80 + '.openlearn-package.json'.length);
  });
});
