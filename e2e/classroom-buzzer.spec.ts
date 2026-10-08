import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeBuzzerE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 抢答测试课节%'")
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
            db.prepare(`DELETE FROM classroom_buzzers WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
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
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_BUZZ_%-%'")
      .all() as { id: string }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const sPlaceholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 抢答测试班级%'")
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

async function cleanupBuzzerE2EViaApi(request: APIRequestContext) {
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
        if (l.title?.startsWith('E2E 抢答测试课节')) {
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
        if (s.student_number?.startsWith('STU_BUZZ_') && s.student_number?.includes('-')) {
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
        if (c.name?.startsWith('E2E 抢答测试班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

test.describe('在线教学抢答器（Classroom Buzzer）多端竞态与裁决 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupBuzzerE2EViaApi(request);
    purgeBuzzerE2EFromDb();
  });

  test.afterAll(async ({ request }) => {
    await cleanupBuzzerE2EViaApi(request);
    purgeBuzzerE2EFromDb();
  });

  test('多学生端同时接收抢答下发，完成抢答裁决(WINNER与MISSED区分)并可被教师重置 (Generates Artifact: Screenshot)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 抢答测试课节 ${suffix}`;
    const className = `E2E 抢答测试班级 ${suffix}`;
    const stuNumA = `STU_BUZZ_A-${suffix}`;
    const stuNumB = `STU_BUZZ_B-${suffix}`;

    let lessonId = '';
    let classId = '';
    let studentIdA = '';
    let studentIdB = '';
    let contextA: BrowserContext | null = null;
    let contextB: BrowserContext | null = null;

    try {
      // 1. 教师登录并创建班级与课节
      const adminLogin = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      if (!adminLogin.ok()) {
        console.error('adminLogin failed:', adminLogin.status(), await adminLogin.text());
      }
      expect(adminLogin.ok()).toBeTruthy();

      const clsRes = await request.post('/api/classes', {
        data: { name: className, description: 'Buzzer E2E Class' },
      });
      expect(clsRes.ok()).toBeTruthy();
      const clsData = await clsRes.json();
      classId = clsData.id;

      const lessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, content: 'Buzzer Race E2E Fixture' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;
      expect(lessonId).toBeTruthy();

      // 初始化课堂 Session，确保课堂活跃
      const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();

      // 创建学生 A 与学生 B
      const stuResA = await request.post('/api/students', {
        data: { name: `抢答学生A_${suffix}`, student_number: stuNumA, password: 'password123' },
      });
      expect(stuResA.ok()).toBeTruthy();
      const stuDataA = await stuResA.json();
      studentIdA = stuDataA.id;

      const stuResB = await request.post('/api/students', {
        data: { name: `抢答学生B_${suffix}`, student_number: stuNumB, password: 'password123' },
      });
      expect(stuResB.ok()).toBeTruthy();
      const stuDataB = await stuResB.json();
      studentIdB = stuDataB.id;

      // 关联到班级
      await request.post(`/api/classes/${classId}/students`, { data: { studentId: studentIdA } });
      await request.post(`/api/classes/${classId}/students`, { data: { studentId: studentIdB } });

      // 2. 建立两个独立的浏览器 Context，分别登录 Student A 与 Student B
      contextA = await browser.newContext();
      contextB = await browser.newContext();

      const loginA = await contextA.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: stuNumA, password: 'password123' },
      });
      expect(loginA.ok()).toBeTruthy();

      const loginB = await contextB.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: stuNumB, password: 'password123' },
      });
      expect(loginB.ok()).toBeTruthy();

      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      await pageA.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
      await pageB.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));

      // 两名学生分别进入课堂直播视角
      await pageA.goto(`/?mode=student_live&lessonId=${lessonId}`);
      await pageB.goto(`/?mode=student_live&lessonId=${lessonId}`);

      // 3. 教师发起全班极速抢答
      const buzzerTitle = `闪电首答先抢先得 (${suffix})`;
      const buzzerRes = await request.post(`/api/classroom/sessions/${lessonId}/buzzer`, {
        data: { title: buzzerTitle },
      });
      expect(buzzerRes.ok()).toBeTruthy();
      const buzzerData = await buzzerRes.json();
      const buzzerId = buzzerData.buzzer?.id;
      expect(buzzerId).toBeTruthy();

      // 4. 断言两个学生端均弹出全屏抢答器
      const buzzerHeadingA = pageA.getByText(buzzerTitle);
      const buzzerHeadingB = pageB.getByText(buzzerTitle);
      await expect(buzzerHeadingA).toBeVisible({ timeout: 25_000 });
      await expect(buzzerHeadingB).toBeVisible({ timeout: 25_000 });

      const buzzBtnA = pageA.getByRole('button', { name: '抢！' });
      const buzzBtnB = pageB.getByRole('button', { name: '抢！' });
      await expect(buzzBtnA).toBeVisible();
      await expect(buzzBtnB).toBeVisible();

      // 5. 学生 A 率先点击抢答
      await buzzBtnA.click();

      // 6. 验证学生 A 胜出
      await expect(pageA.getByText('恭喜你率先抢答！')).toBeVisible({ timeout: 15_000 });

      // 截取胜出者视口截图存盘作为测试证据
      const WINNER_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/classroom_buzzer_winner.png');
      await pageA.screenshot({ path: WINNER_SCREENSHOT });
      expect(fs.existsSync(WINNER_SCREENSHOT)).toBe(true);

      // 7. 学生 B 自动由 Socket / 轮询同步到落选状态（抢答按钮替换为落选提示）
      await expect(pageB.getByText(/已被 .* 抢先一步！/)).toBeVisible({ timeout: 25_000 });

      // 8. 教师重置抢答器
      const resetRes = await request.post(`/api/classroom/sessions/${lessonId}/buzzer/${buzzerId}/reset`);
      expect(resetRes.ok()).toBeTruthy();

      // 9. 验证两名学生端抢答器重新复位为可抢答态
      await expect(pageA.getByRole('button', { name: '抢！' })).toBeVisible({ timeout: 25_000 });
      await expect(pageB.getByRole('button', { name: '抢！' })).toBeVisible({ timeout: 25_000 });

      // 10. 记录证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'classroom_buzzer_race_evidence.log'),
        `[${new Date().toISOString()}] Classroom Buzzer E2E Test Passed:
- Lesson ID: ${lessonId}
- Buzzer ID: ${buzzerId}
- Student A (Winner): ${stuNumA} -> Successfully won race
- Student B (Missed): ${stuNumB} -> Received missed prompt
- Teacher Reset Verified: Both students restored to READY status
- Screenshot: ${WINNER_SCREENSHOT}
`,
      );
    } finally {
      await contextA?.close().catch(() => {});
      await contextB?.close().catch(() => {});

      if (lessonId) {
        await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      }
      if (studentIdA) {
        await request.delete(`/api/students/${studentIdA}`).catch(() => {});
      }
      if (studentIdB) {
        await request.delete(`/api/students/${studentIdB}`).catch(() => {});
      }
      if (classId) {
        await request.delete(`/api/classes/${classId}`).catch(() => {});
      }
    }
  });
});
