import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgePostClassWrapupE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 课后复盘%'")
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
            db.prepare(
              `DELETE FROM classroom_poll_votes WHERE poll_id IN (SELECT id FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders}))`
            ).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_quick_polls WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_buzzers WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_exit_tickets WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_feed WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_pacing_signals WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
          } catch {}
          try {
            db.prepare(`DELETE FROM classroom_danmaku WHERE session_id IN (${sPlaceholders})`).run(...sessionIds);
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
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_WRAP_%-%'")
      .all() as { id: string }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const sPlaceholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 课后复盘班级%'")
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

async function cleanupPostClassWrapupE2EViaApi(request: APIRequestContext) {
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
        if (l.title?.startsWith('E2E 课后复盘')) {
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
        if (s.student_number?.startsWith('STU_WRAP_') && s.student_number?.includes('-')) {
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
        if (c.name?.startsWith('E2E 课后复盘班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

test.describe('课后学情复盘面板（PostClassWrapupView）与结课简报流转 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupPostClassWrapupE2EViaApi(request);
    purgePostClassWrapupE2EFromDb();
  });

  test.afterAll(async ({ request }) => {
    await cleanupPostClassWrapupE2EViaApi(request);
    purgePostClassWrapupE2EFromDb();
  });

  test('推进至WRAP_UP_EXIT_TICKET、4大标签页联动、知识树点亮与学情简报流转 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 课后复盘演示课 ${suffix}`;
    const className = `E2E 课后复盘班级 ${suffix}`;
    const studentNum = `STU_WRAP_${suffix}-1`;
    let lessonId = '';
    let classId = '';
    let studentId = '';

    try {
      // 1. 登录管理员并准备基础数据
      const adminLogin = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(adminLogin.ok()).toBeTruthy();

      // 创建测试课程
      const createLessonRes = await request.post('/api/lessons', {
        data: {
          title: lessonTitle,
          subject: '物理',
          grade: '高一',
          content: '变力做功与动能定理全流程实测',
        },
      });
      expect(createLessonRes.ok()).toBeTruthy();
      const lessonData = await createLessonRes.json();
      lessonId = lessonData.result?.lessonId || lessonData.lessonId || lessonData.id || lessonData.data?.id;
      expect(lessonId).toBeTruthy();

      // 创建测试班级与学生
      const createClassRes = await request.post('/api/classes', {
        data: { name: className, grade: '高一' },
      });
      expect(createClassRes.ok()).toBeTruthy();
      const classData = await createClassRes.json();
      classId = classData.id || classData.data?.id;

      const createStudentRes = await request.post('/api/students', {
        data: {
          student_number: studentNum,
          name: `复盘测试生_${suffix.slice(0, 4)}`,
          gender: 'F',
        },
      });
      expect(createStudentRes.ok()).toBeTruthy();
      const studentData = await createStudentRes.json();
      studentId = studentData.id || studentData.data?.id;

      // 绑定学生至班级
      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
        data: { studentId },
      });

      // 初始化课堂 Session
      const initSessionRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: {
          classId,
          teachingModeId: 'lecture',
        },
      });
      expect(initSessionRes.ok()).toBeTruthy();

      // 预先写入一条结课通票反馈数据
      const puzzledConceptText = '变力微元与动量极值';
      const studentFeedbackText = `微元累加法非常生动！(${suffix.slice(0, 4)})`;
      const submitTicketRes = await request.post(
        `/api/classroom/sessions/${encodeURIComponent(lessonId)}/exit-ticket`,
        {
          data: {
            rating: 5,
            puzzledConcept: puzzledConceptText,
            feedback: studentFeedbackText,
            tierLevel: 'passed',
          },
        }
      );
      expect(submitTicketRes.ok()).toBeTruthy();

      // 将课堂推进至 WRAP_UP_EXIT_TICKET (结课通票与复盘阶段)
      const advanceToWrapupRes = await request.post(
        `/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`,
        {
          data: {
            stage: 'WRAP_UP_EXIT_TICKET',
            classId,
          },
        }
      );
      expect(advanceToWrapupRes.ok()).toBeTruthy();

      // 2. 浏览器 context 登录并进入应用
      const ctxLoginRes = await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(ctxLoginRes.ok()).toBeTruthy();

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');

      // 3. 点击导航栏“互动课堂”
      const liveClassNavBtn = page.locator('button:has-text("互动课堂")').first();
      await expect(liveClassNavBtn).toBeVisible({ timeout: 15_000 });
      await liveClassNavBtn.click();

      // 活跃课堂检测到后，等待“回到课堂”按钮就绪并点击恢复
      const resumeBtn = page.getByRole('button', { name: '回到课堂' });
      await expect(resumeBtn).toBeVisible({ timeout: 15_000 });
      await expect(resumeBtn).toBeEnabled({ timeout: 10_000 });
      await resumeBtn.click();

      // 4. 断言课后复盘主面板 #post-class-wrapup-view 成功挂载
      const wrapupView = page.locator('#post-class-wrapup-view');
      await expect(wrapupView).toBeVisible({ timeout: 15_000 });
      await expect(wrapupView.getByText('阶段 3 / 4 · 课后小结与作业批改')).toBeVisible();

      // 验证 4 大 Tab 完整存在
      await expect(wrapupView.getByRole('button', { name: /作业成绩评定/ })).toBeVisible();
      await expect(wrapupView.getByRole('button', { name: /随堂互动提交明细/ })).toBeVisible();
      await expect(wrapupView.getByRole('button', { name: /60s 结课通票反馈/ })).toBeVisible();
      await expect(wrapupView.getByRole('button', { name: /课后任务下发与反思备忘/ })).toBeVisible();

      // 证据 1：课后复盘面板概览截图
      await page.screenshot({
        path: 'artifacts/screenshots/post_class_wrapup_dashboard.png',
        fullPage: true,
      });

      // 5. 切换到「60s 结课通票反馈」Tab，点亮知识树
      await wrapupView.getByRole('button', { name: /60s 结课通票反馈/ }).click();

      // 验证概念词云面板已渲染
      const wordcloudPanel = wrapupView.locator('[data-testid="concept-wordcloud-panel"]');
      await expect(wordcloudPanel).toBeVisible({ timeout: 10_000 });

      // 验证学生反馈原声流中包含预填的反馈
      await expect(wrapupView.getByText(studentFeedbackText)).toBeVisible({ timeout: 10_000 });

      // 点击打开知识树点亮模态框
      const openTreeBtn = wordcloudPanel.getByRole('button', { name: /点亮本堂课知识树/ });
      await expect(openTreeBtn).toBeVisible();
      await openTreeBtn.click();

      const treeModal = page.locator('[data-testid="knowledge-tree-lighting-modal"]');
      await expect(treeModal).toBeVisible({ timeout: 10_000 });
      await expect(treeModal.getByText('课堂知识树即时点亮仪式')).toBeVisible();

      // 点击弹窗内的点亮大按钮
      const lightUpTreeActionBtn = treeModal.getByRole('button', { name: /🌟 点亮本堂课知识树/ });
      await expect(lightUpTreeActionBtn).toBeVisible();
      await lightUpTreeActionBtn.click();

      // 验证变更为全员达成勋章或点亮完成
      await expect(treeModal.locator('[data-testid="tree-lit-badge"]')).toBeVisible({ timeout: 10_000 });
      await expect(treeModal.getByText('知识图谱已点亮')).toBeVisible();

      // 证据 2：知识树点亮仪式全景截图
      await page.screenshot({
        path: 'artifacts/screenshots/post_class_knowledge_tree.png',
        fullPage: true,
      });

      // 关闭知识树弹窗
      await treeModal.locator('button[aria-label="Close"]').click();
      await expect(treeModal).toBeHidden({ timeout: 5000 });

      // 6. 切换到「课后任务下发与反思备忘」Tab
      await wrapupView.getByRole('button', { name: /课后任务下发与反思备忘/ }).click();

      const reflectionTextarea = wrapupView.locator('textarea[placeholder*="记录本次课的教学亮点"]');
      await expect(reflectionTextarea).toBeVisible();
      await reflectionTextarea.fill(`E2E 教学反思：学生在微元累加理解深入，需增加变阻力极值习题。(${suffix})`);

      // 保存反思
      const saveReflectionBtn = wrapupView.getByRole('button', { name: '保存反思记录' });
      await expect(saveReflectionBtn).toBeVisible();
      await saveReflectionBtn.click();

      // 7. 点击右上角推进至全景简报 (ARCHIVED_REPORT)
      const advanceReportBtn = wrapupView.locator('#post-class-advance-report-btn');
      await expect(advanceReportBtn).toBeVisible();
      await advanceReportBtn.click();

      // 验证成功转入学情全景简报视图
      const briefingView = page.locator('#classroom-briefing-view');
      await expect(briefingView).toBeVisible({ timeout: 15_000 });
      await expect(briefingView.getByText('阶段 4 / 4 · 课堂学情全景简报')).toBeVisible();

      // 证据 3：全景简报视图截图
      await page.screenshot({
        path: 'artifacts/screenshots/post_class_briefing_report.png',
        fullPage: true,
      });
    } finally {
      purgePostClassWrapupE2EFromDb();
    }
  });
});
