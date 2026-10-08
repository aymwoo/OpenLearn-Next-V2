import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgePacingE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 节奏反馈课节%'")
      .all() as { id: string }[];

    if (e2eLessons.length > 0) {
      const lessonIds = e2eLessons.map((l) => l.id);
      const placeholders = lessonIds.map(() => '?').join(',');

      try {
        const sessions = db
          .prepare(`SELECT id FROM classroom_sessions WHERE lesson_id IN (${placeholders})`)
          .all(...lessonIds) as { id: string }[];
        if (sessions.length > 0) {
          const sessionIds = sessions.map((s) => s.id);
          const sPlaceholders = sessionIds.map(() => '?').join(',');
          try {
            db.prepare(`DELETE FROM classroom_pacing_signals WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_feed WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
        }
        db.prepare(`DELETE FROM classroom_sessions WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      } catch {}

      db.prepare(`DELETE FROM whiteboard_elements WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM student_lesson_progress WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM schedules WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM assignments WHERE lesson_id IN (${placeholders})`).run(...lessonIds);
      db.prepare(`DELETE FROM lessons WHERE id IN (${placeholders})`).run(...lessonIds);
    }

    const e2eStudents = db
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_PACE_%-%'")
      .all() as { id: string }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const sPlaceholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 节奏反馈班级%'")
      .all() as { id: string }[];

    if (e2eClasses.length > 0) {
      const classIds = e2eClasses.map((c) => c.id);
      const cPlaceholders = classIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM classes WHERE id IN (${cPlaceholders})`).run(...classIds);
    }
  } finally {
    db.close();
  }
}

async function cleanupPacingE2EViaApi(request: APIRequestContext) {
  await request
    .post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    })
    .catch(() => {});

  try {
    const listRes = await request.get('/api/lessons');
    if (listRes.ok()) {
      const lessons = await listRes.json();
      const arr = Array.isArray(lessons) ? lessons : [];
      for (const l of arr) {
        if (l.title?.startsWith('E2E 节奏反馈课节')) {
          await request.delete(`/api/lessons/${encodeURIComponent(l.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  try {
    const sRes = await request.get('/api/students');
    if (sRes.ok()) {
      const students = await sRes.json();
      const arr = Array.isArray(students) ? students : [];
      for (const s of arr) {
        if (s.student_number?.startsWith('STU_PACE_') && s.student_number?.includes('-')) {
          await request.delete(`/api/students/${encodeURIComponent(s.id)}`).catch(() => {});
        }
      }
    }
  } catch {}

  try {
    const cRes = await request.get('/api/classes');
    if (cRes.ok()) {
      const classes = await cRes.json();
      const arr = Array.isArray(classes) ? classes : [];
      for (const c of arr) {
        if (c.name?.startsWith('E2E 节奏反馈班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

test.describe('在线教学分环节学习节奏晴雨表（Pacing Signals）全链路 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupPacingE2EViaApi(request);
    purgePacingE2EFromDb();
  });

  test.afterAll(async ({ request }) => {
    await cleanupPacingE2EViaApi(request);
    purgePacingE2EFromDb();
  });

  test('学生在浮动工具栏切换与取消节奏信号，并在服务端学情聚合中实时体现 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 节奏反馈课节 ${suffix}`;
    const className = `E2E 节奏反馈班级 ${suffix}`;
    const stuNum = `STU_PACE_${suffix}`;

    let lessonId = '';
    let classId = '';
    let studentId = '';

    try {
      // 1. 教师创建课节、班级与学生
      const adminLogin = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(adminLogin.ok()).toBeTruthy();

      const clsRes = await request.post('/api/classes', {
        data: { name: className, description: 'Pacing Fixture Class' },
      });
      expect(clsRes.ok()).toBeTruthy();
      const clsData = await clsRes.json();
      classId = clsData.id;

      const lessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, content: 'Pacing Signals Flow' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;
      expect(lessonId).toBeTruthy();

      // 初始化课堂 Session
      const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();

      // 创建学生
      const stuRes = await request.post('/api/students', {
        data: { name: `节奏学生_${suffix}`, student_number: stuNum, password: 'password123' },
      });
      expect(stuRes.ok()).toBeTruthy();
      const stuData = await stuRes.json();
      studentId = stuData.id;

      await request.post(`/api/classes/${classId}/students`, { data: { studentId } });

      // 2. 学生登录并进入课堂
      const stuLogin = await context.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: stuNum, password: 'password123' },
      });
      expect(stuLogin.ok()).toBeTruthy();

      await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
      await page.goto(`/?mode=student_live&lessonId=${lessonId}`);

      // 3. 定位底部悬浮课堂互动工具栏
      const toolbar = page.locator('aside[aria-label*="课堂互动工具栏"]');
      await expect(toolbar).toBeVisible({ timeout: 25_000 });

      // 4. 点击「🐇 讲太快」按钮
      const tooFastBtn = toolbar.locator('button').filter({ hasText: '讲太快' });
      await expect(tooFastBtn).toBeVisible();
      await tooFastBtn.click();

      // 验证选中反馈提示
      await expect(page.getByText('已反馈: 🐇 讲太快')).toBeVisible({ timeout: 10_000 });

      // 5. 验证后端聚合接口记录了 TOO_FAST 信号
      await expect
        .poll(
          async () => {
            const summaryRes = await request.get(`/api/classroom/sessions/${lessonId}/pacing-summary`);
            if (!summaryRes.ok()) return null;
            const data = await summaryRes.json();
            return {
              tooFast: data.overallSummary?.TOO_FAST ?? 0,
              confused: data.overallSummary?.CONFUSED ?? 0,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({ tooFast: 1, confused: 0 });

      // 6. 切换点击「❓ 有疑问」按钮
      const confusedBtn = toolbar.locator('button').filter({ hasText: '有疑问' });
      await expect(confusedBtn).toBeVisible();
      await confusedBtn.click();

      // 验证切换为 CONFUSED
      await expect(page.getByText('已反馈: ❓ 有疑问')).toBeVisible({ timeout: 10_000 });

      await expect
        .poll(
          async () => {
            const summaryRes = await request.get(`/api/classroom/sessions/${lessonId}/pacing-summary`);
            if (!summaryRes.ok()) return null;
            const data = await summaryRes.json();
            return {
              tooFast: data.overallSummary?.TOO_FAST ?? 0,
              confused: data.overallSummary?.CONFUSED ?? 0,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({ tooFast: 0, confused: 1 });

      // 截取节奏工具栏选中态截图存盘作为视觉证据
      const TOOLBAR_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/classroom_pacing_toolbar.png');
      await toolbar.screenshot({ path: TOOLBAR_SCREENSHOT });
      expect(fs.existsSync(TOOLBAR_SCREENSHOT)).toBe(true);

      // 7. 再次点击「❓ 有疑问」，触发反选取消（Toggle Cancel）
      await confusedBtn.click();

      // 验证恢复为无信号状态
      await expect
        .poll(
          async () => {
            const summaryRes = await request.get(`/api/classroom/sessions/${lessonId}/pacing-summary`);
            if (!summaryRes.ok()) return null;
            const data = await summaryRes.json();
            return {
              tooFast: data.overallSummary?.TOO_FAST ?? 0,
              confused: data.overallSummary?.CONFUSED ?? 0,
            };
          },
          { timeout: 10_000 },
        )
        .toEqual({ tooFast: 0, confused: 0 });

      // 8. 记录测试日志证据
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'classroom_pacing_evidence.log'),
        `[${new Date().toISOString()}] Classroom Pacing Barometer E2E Test Passed:
- Lesson ID: ${lessonId}
- Student: ${stuNum}
- Signal TOO_FAST Verified: Summary count = 1
- Signal CONFUSED Switch Verified: Replaced TOO_FAST with CONFUSED
- Signal Toggle Cancel Verified: Reset count to 0
- Screenshot: ${TOOLBAR_SCREENSHOT}
`,
      );
    } finally {
      if (lessonId) {
        await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      }
      if (studentId) {
        await request.delete(`/api/students/${studentId}`).catch(() => {});
      }
      if (classId) {
        await request.delete(`/api/classes/${classId}`).catch(() => {});
      }
    }
  });
});
