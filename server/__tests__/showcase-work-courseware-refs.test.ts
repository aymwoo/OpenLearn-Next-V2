import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { collectLessonCoursewareUuids } from '../services/showcase-work-service.js';

/**
 * 作品展示的课件来源识别（阶段 5 回归）。
 *
 * 迁移后白板元素是 `learning_surface`，课件 uuid 不再直接写在元素 data 里；
 * 如果这里只查 `html-applet`，大屏作品展示会丢失全部课件作答。
 * 同时保留旧形态，覆盖未迁移 / 回滚场景。
 */
describe('collectLessonCoursewareUuids', () => {
  const db = kernelContainer.db;
  const lessonId = `lesson-showcase-${randomUUID().slice(0, 8)}`;
  const now = Date.now();

  beforeAll(() => {
    db.prepare(
      'INSERT OR REPLACE INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(lessonId, '作品展示测试', '', 'teacher-showcase', now, now);
  });

  it('从 learning_surface Surface 读取 courseware uuid', () => {
    db.prepare(
      'INSERT INTO learning_surfaces (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    ).run(
      `lsm_showcase_${lessonId}`,
      lessonId,
      'whiteboard_element',
      `el_showcase_${lessonId}`,
      JSON.stringify({
        rendererId: 'html_courseware',
        source: { kind: 'courseware', id: 'cw-surface-1' },
      }),
      now,
      now,
    );
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `el_showcase_${lessonId}`,
      lessonId,
      'learning_surface',
      JSON.stringify({ surfaceId: `lsm_showcase_${lessonId}`, x: 0, y: 0 }),
      now,
    );

    expect(collectLessonCoursewareUuids(db, lessonId)).toContain('cw-surface-1');
  });

  it('兼容旧 html-applet，并忽略非课件资源引用', () => {
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `el_legacy_${lessonId}`,
      lessonId,
      'html-applet',
      JSON.stringify({ coursewareUuid: 'cw-legacy-1' }),
      now,
    );

    db.prepare(
      'INSERT INTO learning_surfaces (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
    ).run(
      `lsm_showcase_resource_${lessonId}`,
      lessonId,
      'whiteboard_element',
      `el_resource_${lessonId}`,
      JSON.stringify({
        rendererId: 'html_courseware',
        source: { kind: 'resource', id: 'res-not-courseware' },
      }),
      now,
      now,
    );
    db.prepare('INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)').run(
      `el_resource_${lessonId}`,
      lessonId,
      'learning_surface',
      JSON.stringify({ surfaceId: `lsm_showcase_resource_${lessonId}` }),
      now,
    );

    const uuids = collectLessonCoursewareUuids(db, lessonId);
    expect(uuids).toContain('cw-legacy-1');
    expect(uuids).not.toContain('res-not-courseware');
  });
});
