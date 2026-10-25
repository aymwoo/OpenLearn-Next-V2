/**
 * 归属：课堂 / 教师驾驶舱 —— 白板画布可达性（窗口不够大时的滚动）
 *
 * 背景（实测复现）：白板画布（konva Stage）的尺寸此前**严格等于容器尺寸**，
 * 而从画布往上的每一级祖先都是 `min-h-0` + `overflow-hidden` —— 溢出被裁掉，
 * 整条链上**没有任何一级可滚动**。于是画在画布可视区之外的组件（哪怕只是
 * 窗口缩小前放在画布下部的）既看不见也拖不动，而且没有任何办法把它们拉回来。
 *
 * 本用例锁定修复后的行为：
 *  1. 组件画在画布下方时，画布区**必须出现滚动条**，且滚动后组件进入可视区；
 *  2. 组件都在画布内时，**不得**凭空多出滚动条（不破坏原有布局）。
 *
 * 归属注释按 Issue #230 的口径挂靠（新增用例时用同一口径）。
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { enterTeachingView } from './fixtures/classroom-entry';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

/** 组件被放置的画布 y 坐标 —— 远超任何常见窗口下的画布可视高度 */
const ELEMENT_Y = 1600;

function purgeWhiteboardScrollE2EFromDb() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  try {
    const lessons = db.prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 白板滚动%'").all() as { id: string }[];
    for (const l of lessons) {
      db.prepare('DELETE FROM whiteboard_elements WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_buzzers WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    }
    const classes = db.prepare("SELECT id FROM classes WHERE name LIKE 'E2E 白板滚动班级%'").all() as { id: string }[];
    for (const c of classes) {
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
    }
    const students = db.prepare("SELECT id FROM students WHERE student_number LIKE 'STU_WB_SCROLL-%'").all() as {
      id: string;
    }[];
    for (const s of students) {
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(s.id);
      db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    }
  } finally {
    db.close();
  }
}

/** 读画布容器的尺寸与滚动能力 */
async function readCanvasViewport(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const konva = document.querySelector('.konvajs-content');
    const viewport = document.querySelector('[data-testid="whiteboard-canvas-viewport"]');
    if (!konva || !viewport) return null;
    const el = viewport as HTMLElement;
    return {
      canvasLogicalHeight: parseFloat((konva as HTMLElement).style.height) || 0,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
      scrollable: el.scrollHeight > el.clientHeight + 1,
    };
  });
}

test.describe('白板画布可达性 E2E（窗口不够大时的滚动）', () => {
  test.beforeAll(async () => {
    purgeWhiteboardScrollE2EFromDb();
  });

  test.afterAll(async () => {
    purgeWhiteboardScrollE2EFromDb();
  });

  test('组件画在画布下方时，画布区出现滚动条且滚动后组件可达', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    // 故意用**矮视口**：模拟「窗口不够大」
    await page.setViewportSize({ width: 1440, height: 520 });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 白板滚动课节 ${suffix}`;
    const className = `E2E 白板滚动班级 ${suffix}`;
    const studentNum = `STU_WB_SCROLL-${suffix}`;

    let lessonId = '';

    try {
      const loginRes = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(loginRes.ok()).toBeTruthy();

      const createLessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, subject: '物理', grade: '高一', content: '白板滚动可达性验证' },
      });
      expect(createLessonRes.ok()).toBeTruthy();
      const lessonJson = await createLessonRes.json();
      lessonId = lessonJson?.result?.lessonId || lessonJson?.lessonId || lessonJson?.id;
      expect(lessonId).toBeTruthy();

      const createClassRes = await request.post('/api/classes', { data: { name: className, grade: '高一' } });
      expect(createClassRes.ok()).toBeTruthy();
      const classId = (await createClassRes.json()).id;

      const createStuRes = await request.post('/api/students', {
        data: { student_number: studentNum, name: `白板滚动生_${suffix.slice(0, 4)}`, gender: 'M' },
      });
      expect(createStuRes.ok()).toBeTruthy();
      const studentId = (await createStuRes.json()).id;
      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, { data: { studentId } });

      // 把一个组件画在画布很靠下的位置
      const drawRes = await request.post(`/api/lessons/${encodeURIComponent(lessonId)}/whiteboard`, {
        data: { type: 'rectangle', data: { x: 120, y: ELEMENT_Y, width: 420, height: 240 } },
      });
      expect(drawRes.ok()).toBeTruthy();

      const initRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();
      const stageRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(stageRes.ok()).toBeTruthy();

      await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');
      await enterTeachingView(page);
      await expect(page.locator('#classroom-interactive-cockpit')).toBeVisible({ timeout: 20_000 });

      const viewport = page.locator('[data-testid="whiteboard-canvas-viewport"]');
      await expect(viewport).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);

      const before = await readCanvasViewport(page);
      expect(before, '应能读到白板画布容器').not.toBeNull();

      // 1) 画布逻辑高度必须装得下画在 y=1600 的组件
      expect(before!.canvasLogicalHeight, '画布逻辑高度应至少覆盖 y=1600 的组件，否则组件被永久裁掉').toBeGreaterThan(
        ELEMENT_Y,
      );

      // 2) 容器必须可滚动（overflow 不能是 hidden）
      expect(before!.overflowY, '画布容器不应再用 overflow-hidden 裁掉溢出').not.toBe('hidden');
      expect(before!.scrollable, '画布区应出现滚动条').toBeTruthy();

      // 3) 滚到组件所在位置后，组件应进入可视区
      const reachable = await page.evaluate((elementY) => {
        const el = document.querySelector('[data-testid="whiteboard-canvas-viewport"]') as HTMLElement | null;
        if (!el) return null;
        el.scrollTop = Math.max(0, elementY - 40);
        return elementY >= el.scrollTop && elementY <= el.scrollTop + el.clientHeight;
      }, ELEMENT_Y);
      expect(reachable, '滚动后组件应进入可视区').toBeTruthy();
    } finally {
      if (lessonId) {
        await request.delete(`/api/lessons/${encodeURIComponent(lessonId)}`).catch(() => undefined);
      }
    }
  });

  test('组件都在画布内时不凭空多出滚动条（不破坏原有布局）', async ({ page, request, context }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 1440, height: 900 });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 白板滚动课节 ${suffix}`;
    const className = `E2E 白板滚动班级 ${suffix}`;
    const studentNum = `STU_WB_SCROLL-${suffix}`;

    let lessonId = '';

    try {
      const loginRes = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(loginRes.ok()).toBeTruthy();

      const createLessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, subject: '物理', grade: '高一', content: '白板滚动可达性验证（对照）' },
      });
      expect(createLessonRes.ok()).toBeTruthy();
      const lessonJson = await createLessonRes.json();
      lessonId = lessonJson?.result?.lessonId || lessonJson?.lessonId || lessonJson?.id;

      const createClassRes = await request.post('/api/classes', { data: { name: className, grade: '高一' } });
      const classId = (await createClassRes.json()).id;
      const createStuRes = await request.post('/api/students', {
        data: { student_number: studentNum, name: `白板滚动生_${suffix.slice(0, 4)}`, gender: 'M' },
      });
      const studentId = (await createStuRes.json()).id;
      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, { data: { studentId } });

      // 组件画在画布顶部附近 —— 任何窗口下都在可视区内
      const drawRes = await request.post(`/api/lessons/${encodeURIComponent(lessonId)}/whiteboard`, {
        data: { type: 'rectangle', data: { x: 120, y: 40, width: 320, height: 200 } },
      });
      expect(drawRes.ok()).toBeTruthy();

      const initRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();
      const stageRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(stageRes.ok()).toBeTruthy();

      await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');
      await enterTeachingView(page);
      await expect(page.locator('#classroom-interactive-cockpit')).toBeVisible({ timeout: 20_000 });

      const viewport = page.locator('[data-testid="whiteboard-canvas-viewport"]');
      await expect(viewport).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);

      const after = await readCanvasViewport(page);
      expect(after, '应能读到白板画布容器').not.toBeNull();

      // 内容装得下 → 不应出现滚动条，布局与修复前一致
      expect(after!.scrollable, '内容装得下时不应凭空多出滚动条').toBeFalsy();
      expect(after!.canvasLogicalHeight).toBeCloseTo(after!.clientHeight, 0);
    } finally {
      if (lessonId) {
        await request.delete(`/api/lessons/${encodeURIComponent(lessonId)}`).catch(() => undefined);
      }
    }
  });
});
