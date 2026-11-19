/**
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { resolveCourseDeliveryMode } from '../../packages/core/plugin-host/course-delivery-mode.js';

describe('lessons.delivery_mode', () => {
  const ids: string[] = [];

  afterAll(() => {
    const db = kernelContainer.db;
    for (const id of ids) {
      db.prepare('DELETE FROM lessons WHERE id = ?').run(id);
    }
  });

  it('旧课不写该列时读取为白板', () => {
    const id = `les_mode_old_${uuidv7().slice(0, 8)}`;
    ids.push(id);
    const now = Date.now();
    kernelContainer.db
      .prepare('INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, '旧课', '', 'usr_teacher', now, now);
    const row = kernelContainer.db.prepare('SELECT delivery_mode FROM lessons WHERE id = ?').get(id) as {
      delivery_mode: string | null;
    };
    expect(row.delivery_mode).toBeNull();
    expect(resolveCourseDeliveryMode(row.delivery_mode)).toBe('whiteboard');
  });

  it('可以持久化学案模式，克隆时带上同一模式', () => {
    const id = `les_mode_xuean_${uuidv7().slice(0, 8)}`;
    ids.push(id);
    const now = Date.now();
    kernelContainer.db
      .prepare(
        'INSERT INTO lessons (id, title, content, creator_id, created_at, updated_at, delivery_mode) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, '学案课', '', 'usr_teacher', now, now, 'xuean');
    const row = kernelContainer.db.prepare('SELECT delivery_mode FROM lessons WHERE id = ?').get(id) as {
      delivery_mode: string | null;
    };
    expect(resolveCourseDeliveryMode(row.delivery_mode)).toBe('xuean');
  });
});
