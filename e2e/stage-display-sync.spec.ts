import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

function purgeStageDisplayE2EFromDb() {
  const dbPath = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath);
  try {
    const e2eLessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 大屏展台%'")
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
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_STAGE_%-%'")
      .all() as { id: string }[];

    if (e2eStudents.length > 0) {
      const studentIds = e2eStudents.map((s) => s.id);
      const sPlaceholders = studentIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM student_seats WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM class_students WHERE student_id IN (${sPlaceholders})`).run(...studentIds);
      db.prepare(`DELETE FROM students WHERE id IN (${sPlaceholders})`).run(...studentIds);
    }

    const e2eClasses = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 大屏展台班级%'")
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

async function cleanupStageDisplayE2EViaApi(request: APIRequestContext) {
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
        if (l.title?.startsWith('E2E 大屏展台')) {
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
        if (s.student_number?.startsWith('STU_STAGE_') && s.student_number?.includes('-')) {
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
        if (c.name?.startsWith('E2E 大屏展台班级')) {
          await request.delete(`/api/classes/${encodeURIComponent(c.id)}`).catch(() => {});
        }
      }
    }
  } catch {}
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });
  await page.goto('/');

  const usernameInput = page.locator('input[placeholder*="教工账户名"]');
  const sidebarIndicator = page.locator('button:has-text("在线课堂"), button:has-text("课程管理"), aside');

  await Promise.race([
    usernameInput.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
    sidebarIndicator.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
  ]);

  if (await usernameInput.isVisible()) {
    await usernameInput.fill('admin');
    await page.locator('input[placeholder*="输入登录密码"]').fill('admin');
    await page.locator('button:has-text("安全验证登录"), button[type="submit"]').first().click();
    await expect(usernameInput).toBeHidden({ timeout: 15_000 });
  }

  await expect(page.locator('button:has-text("在线课堂"), button:has-text("课程管理")').first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('大屏独立展台（StageDisplayView）投屏与实时交互同步 E2E 测试', () => {
  test.beforeAll(async ({ request }) => {
    await cleanupStageDisplayE2EViaApi(request);
    purgeStageDisplayE2EFromDb();
  });

  test.afterAll(async ({ request }) => {
    await cleanupStageDisplayE2EViaApi(request);
    purgeStageDisplayE2EFromDb();
  });

  test('大屏展台自主建连、课前口令展示、投票实时同步与作业互评赏析联动 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 大屏展台演示课 ${suffix}`;
    const className = `E2E 大屏展台班级 ${suffix}`;
    const studentNum = `STU_STAGE_${suffix}-1`;
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
          content: '变力做功与动能定理大屏实测',
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
          name: `展台测试生_${suffix.slice(0, 4)}`,
          gender: 'M',
        },
      });
      expect(createStudentRes.ok()).toBeTruthy();
      const studentData = await createStudentRes.json();
      studentId = studentData.id || studentData.data?.id;

      // 绑定学生至班级
      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
        data: { studentId },
      });

      // 初始化课堂 Session，处于课前就绪阶段 PRE_CLASS_READY
      const initSessionRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: {
          classId,
          teachingModeId: 'lecture',
        },
      });
      expect(initSessionRes.ok()).toBeTruthy();
      const initJson = await initSessionRes.json();
      const session = initJson.session;
      expect(session).toBeTruthy();
      const checkinCode = String(session.checkin_code);

      // 2. 浏览器 context 登录并打开大屏独立展台
      const ctxLoginRes = await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(ctxLoginRes.ok()).toBeTruthy();

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      // 导航到大屏展台 URL 模式
      await page.goto(`/?mode=stage_display&lessonId=${encodeURIComponent(lessonId)}`);

      // 验证大屏容器成功挂载
      const stageModal = page.locator('#stage-display-modal');
      await expect(stageModal).toBeVisible({ timeout: 15_000 });

      // 验证课程标题
      await expect(stageModal.locator('h1')).toContainText(lessonTitle);

      // 验证课前就绪看板与入课口令
      await expect(stageModal.getByText('即将开始上课，请同学们准备')).toBeVisible();
      await expect(stageModal.getByText(checkinCode)).toBeVisible();

      // 验证侧边学习节奏晴雨表已渲染
      await expect(stageModal.getByText('学习节奏晴雨表')).toBeVisible();

      // 截取证据 1：课前大屏展台就绪看板
      await page.screenshot({
        path: 'artifacts/screenshots/stage_display_pre_class.png',
        fullPage: true,
      });

      // 3. 推进课堂阶段至 IN_CLASS_TEACHING 并发起极速单选投票
      const advanceStageRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(advanceStageRes.ok()).toBeTruthy();

      const pollQuestion = `在变力做功过程中，微元位移下的恒力功累加对应什么？ (${suffix.slice(0, 4)})`;
      const startPollRes = await request.post(
        `/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll`,
        {
          data: {
            title: pollQuestion,
            options: ['A', 'B', 'C', 'D'],
            type: 'single',
          },
        }
      );
      expect(startPollRes.ok()).toBeTruthy();
      const pollJson = await startPollRes.json();
      const pollId = pollJson.poll?.id || pollJson.id || pollJson.data?.id;
      expect(pollId).toBeTruthy();

      // 验证大屏展台自动刷新并展示投票题目与选项
      await expect(stageModal.getByText(pollQuestion)).toBeVisible({ timeout: 15_000 });
      await expect(stageModal.getByText('选项 A')).toBeVisible();
      await expect(stageModal.getByText('选项 B')).toBeVisible();
      await expect(stageModal.getByText('人已作答')).toBeVisible();

      // 4. 学生提交选票
      const voteRes = await request.post(
        `/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll/${encodeURIComponent(pollId)}/vote`,
        {
          data: {
            option: 'A',
          },
        }
      );
      expect(voteRes.ok()).toBeTruthy();

      // 验证大屏展台自动刷新总票数与选项 A 占比
      await expect(stageModal.getByText('100% (1)')).toBeVisible({ timeout: 15_000 });

      // 截取证据 2：课中投票实时柱状图更新
      await page.screenshot({
        path: 'artifacts/screenshots/stage_display_poll_active.png',
        fullPage: true,
      });

      // 5. 联动作业互评赏析弹窗
      const peerReviewBtn = stageModal.locator('#stage-peer-review-toggle');
      await expect(peerReviewBtn).toBeVisible();
      await peerReviewBtn.click();

      const peerReviewModal = page.locator('#peer-review-showcase-modal');
      await expect(peerReviewModal).toBeVisible({ timeout: 10_000 });
      await expect(peerReviewModal.locator('#peer-review-telemetry-header')).toBeVisible();

      // 截取证据 3：大屏作业互评赏析全景
      await page.screenshot({
        path: 'artifacts/screenshots/stage_display_peer_review.png',
        fullPage: true,
      });

      // 关闭互评弹窗，退回大屏主视口
      const closeBtn = peerReviewModal.locator('button[title="关闭大屏互评"]').first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(peerReviewModal).toBeHidden({ timeout: 10_000 });
      await expect(stageModal).toBeVisible();
    } finally {
      // 6. 彻底清理临时数据
      purgeStageDisplayE2EFromDb();
    }
  });
});
