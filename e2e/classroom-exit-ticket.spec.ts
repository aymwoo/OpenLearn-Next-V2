import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeExitTicketE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 结课通票课节%'")
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
            db.prepare(`DELETE FROM classroom_exit_tickets WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
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
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_TICKET_%-%'")
      .all() as { id: string }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const sPlaceholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 结课通票班级%'")
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

async function cleanupExitTicketE2EViaApi(request: APIRequestContext) {
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
        if (l.title?.startsWith('E2E 结课通票课节')) {
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
        if (s.student_number?.startsWith('STU_TICKET_') && s.student_number?.includes('-')) {
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
        if (c.name?.startsWith('E2E 结课通票班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

test.describe('在线教学 60s 自适应结课通票（Adaptive Exit Ticket）全链路 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupExitTicketE2EViaApi(request);
    purgeExitTicketE2EFromDb();
  });

  test.afterAll(async ({ request }) => {
    await cleanupExitTicketE2EViaApi(request);
    purgeExitTicketE2EFromDb();
  });

  test('学生端感知阶段流转自动触发自适应结课通票，完成梯级作答并聚合到教师学情 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 结课通票课节 ${suffix}`;
    const className = `E2E 结课通票班级 ${suffix}`;
    const stuNum = `STU_TICKET_${suffix}`;
    const confusedText = `微元分割时临界阻力积分边界处理 (${suffix})`;

    let lessonId = '';
    let classId = '';
    let studentId = '';

    try {
      // 1. 教师登录并准备基础课节与学生
      const adminLogin = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(adminLogin.ok()).toBeTruthy();

      const clsRes = await request.post('/api/classes', {
        data: { name: className, description: 'Exit Ticket Fixture Class' },
      });
      expect(clsRes.ok()).toBeTruthy();
      const clsData = await clsRes.json();
      classId = clsData.id;

      const lessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, content: 'Exit Ticket Adaptive Flow' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id;
      expect(lessonId).toBeTruthy();

      // 初始化课堂
      const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();

      // 创建学生
      const stuRes = await request.post('/api/students', {
        data: { name: `通票学生_${suffix}`, student_number: stuNum, password: 'password123' },
      });
      expect(stuRes.ok()).toBeTruthy();
      const stuData = await stuRes.json();
      studentId = stuData.id;

      await request.post(`/api/classes/${classId}/students`, { data: { studentId } });

      // 2. 学生登录并在浏览器中进入课堂
      const stuLogin = await context.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: stuNum, password: 'password123' },
      });
      expect(stuLogin.ok()).toBeTruthy();

      await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
      await page.goto(`/?mode=student_live&lessonId=${lessonId}`);

      // 3. 教师端将课堂推进到结课通票阶段 (WRAP_UP_EXIT_TICKET)
      const stageRes = await request.post(`/api/classroom/sessions/${lessonId}/stage`, {
        data: { stage: 'WRAP_UP_EXIT_TICKET', classId },
      });
      expect(stageRes.ok()).toBeTruthy();

      // 4. 断言学生端感知阶段流转，自动弹出自适应通票模态框
      const ticketModal = page.locator('[data-testid="adaptive-exit-ticket-modal"]');
      await expect(ticketModal).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText('60 秒自适应结课通票 (Adaptive Exit Ticket)')).toBeVisible();

      // 5. 作答必做概念题（选择正确选项 B：微元法）
      const optB = ticketModal.locator('button').filter({ hasText: '可将位移划分为无限小微元' }).first();
      await expect(optB).toBeVisible();
      await optB.click();

      // 点击确认本题答案
      const confirmCoreBtn = ticketModal.getByRole('button', { name: '确认本题答案' });
      await expect(confirmCoreBtn).toBeEnabled();
      await confirmCoreBtn.click();

      // 6. 验证自适应高阶挑战分支成功解锁（证明概念过关）
      await expect(page.getByText('✓ 概念通关')).toBeVisible({ timeout: 10_000 });
      const challengeBranch = page.locator('[data-testid="challenge-branch"]');
      await expect(challengeBranch).toBeVisible();
      await expect(challengeBranch).toContainText('Lv.2 进阶探究挑战题');

      // 选做挑战题选项 B
      const challengeOptB = challengeBranch.locator('button').filter({ hasText: '当速度衰减为 0 前' }).first();
      await expect(challengeOptB).toBeVisible();
      await challengeOptB.click();

      // 7. 填写困惑知识点与星级评价
      const puzzledInput = ticketModal.locator('input[placeholder*="变力做功"]');
      await expect(puzzledInput).toBeVisible();
      await puzzledInput.fill(confusedText);

      // 截图存盘：展示作答完成、挑战题解锁与自评价就绪状态
      const TICKET_SCREENSHOT = path.resolve(process.cwd(), 'artifacts/screenshots/classroom_exit_ticket_filled.png');
      await page.screenshot({ path: TICKET_SCREENSHOT });
      expect(fs.existsSync(TICKET_SCREENSHOT)).toBe(true);

      // 8. 提交自适应结课通票
      const submitBtn = ticketModal.getByRole('button', { name: '提交自适应结课通票' });
      await expect(submitBtn).toBeEnabled();
      await submitBtn.click();

      // 9. 验证提交成功界面与关闭
      await expect(page.getByText('结课通票提交成功！')).toBeVisible({ timeout: 15_000 });
      const doneBtn = ticketModal.getByRole('button', { name: '完成' });
      await expect(doneBtn).toBeVisible();
      await doneBtn.click();
      await expect(ticketModal).toBeHidden({ timeout: 10_000 });

      // 10. 验证教师端学情接口汇总与分层统计正确归档
      const summaryRes = await request.get(`/api/classroom/sessions/${lessonId}/exit-ticket-summary`);
      expect(summaryRes.ok()).toBeTruthy();
      const summaryJson = await summaryRes.json();

      expect(summaryJson.totalCount).toBeGreaterThanOrEqual(1);
      expect(summaryJson.tierDistribution).toBeDefined();
      expect(summaryJson.tierDistribution.challenge_done).toBeGreaterThanOrEqual(1);
      expect(summaryJson.puzzledConcepts).toContain(confusedText);

      // 记录证据日志
      const LOG_DIR = path.resolve(process.cwd(), 'artifacts/logs');
      fs.mkdirSync(LOG_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(LOG_DIR, 'classroom_exit_ticket_evidence.log'),
        `[${new Date().toISOString()}] Classroom Adaptive Exit Ticket E2E Test Passed:
- Lesson ID: ${lessonId}
- Student: ${stuNum}
- Core Question Answer: Correct (Option B) -> Unlocked Challenge Tier
- Challenge Question Answer: Option B (challenge_done tier)
- Confused Concept Recorded: "${confusedText}"
- Backend Summary Verified: totalCount=${summaryJson.totalCount}, challenge_done=${summaryJson.tierDistribution.challenge_done}
- Screenshot Saved: ${TICKET_SCREENSHOT}
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
