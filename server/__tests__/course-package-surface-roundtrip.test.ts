import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { exportLessonAsCoursePackage } from '../services/course-package-export.js';
import { importCoursePackage } from '../services/course-package-import.js';
import { COURSE_PACKAGE_VERSION } from '../services/course-package.js';

/**
 * 课程包 v2：Surface 原生往返。
 *
 * 导出时不再把 learning_surface 还原成 html-applet，而是携带 contentRef；
 * 导入时在新环境重建 Surface，surfaceId 不跨环境复用。
 */
describe('课程包 v2 Surface 往返', () => {
  const db = kernelContainer.db;
  const now = Date.now();

  it('导出 learning_surface 为 contentRef，导入后重建 Surface', async () => {
    const suffix = randomUUID().slice(0, 8);
    const lessonId = `lesson-pkg-${suffix}`;
    const elementId = `el-pkg-${suffix}`;
    const surfaceId = `lsm_pkg_${suffix}`;

    db.prepare(
      'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '课程包往返测试', '正文', 'teacher-pkg', now, now);
    db.prepare(
      'INSERT INTO learning_surfaces (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    ).run(
      surfaceId,
      lessonId,
      'whiteboard_element',
      elementId,
      JSON.stringify({ rendererId: 'html_courseware', source: { kind: 'courseware', id: 'cw-pkg-1' } }),
      now,
      now,
    );
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      elementId,
      lessonId,
      'learning_surface',
      JSON.stringify({ surfaceId, title: '包内课件', x: 10, y: 20, width: 400, height: 300, page: 0 }),
      now,
    );

    const exported = await exportLessonAsCoursePackage(lessonId, { db });
    expect(exported.package.version).toBe(COURSE_PACKAGE_VERSION);

    const surfaceElement = exported.package.elements.find((element) => element.type === 'learning_surface');
    expect(surfaceElement).toBeDefined();
    expect(surfaceElement?.data).toMatchObject({
      contentRef: { rendererId: 'html_courseware', source: { kind: 'courseware', id: 'cw-pkg-1' } },
    });
    expect(surfaceElement?.data).not.toHaveProperty('surfaceId');

    const imported = await importCoursePackage(exported.package, { creatorId: 'teacher-pkg', db });
    const importedElement = db
      .prepare("SELECT id, type, data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'learning_surface'")
      .get(imported.lessonId) as { id: string; type: string; data: string } | undefined;

    expect(importedElement).toBeDefined();
    const data = JSON.parse(importedElement!.data) as { surfaceId?: string };
    expect(data.surfaceId).toBeTruthy();
    expect(data.surfaceId).not.toBe(surfaceId);

    const importedSurface = db
      .prepare('SELECT content_ref_json FROM learning_surfaces WHERE id = ?')
      .get(data.surfaceId as string) as { content_ref_json: string } | undefined;
    expect(JSON.parse(importedSurface!.content_ref_json)).toMatchObject({
      rendererId: 'html_courseware',
      source: { kind: 'courseware', id: 'cw-pkg-1' },
    });
  });
});
