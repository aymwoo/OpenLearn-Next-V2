import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

function purgeResilienceAndModalsFromDb() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  try {
    const lessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 容灾与模态课节%'")
      .all() as { id: string }[];
    for (const l of lessons) {
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    }

    const classes = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 容灾与模态班级%'")
      .all() as { id: string }[];
    for (const c of classes) {
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
    }

    const students = db
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_RESILIENCE_%'")
      .all() as { id: string }[];
    for (const s of students) {
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(s.id);
      db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    }
  } finally {
    db.close();
  }
}

test.describe('课堂意外刷新容灾与高级教学模态框 E2E 测试 (Phase 3)', () => {
  test.beforeAll(async () => {
    purgeResilienceAndModalsFromDb();
  });

  test.afterAll(async () => {
    purgeResilienceAndModalsFromDb();
  });

  test('验证课中意外刷新恢复现场与 4 大高级教学模态框唤起 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(90_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 容灾与模态课节 ${suffix}`;
    const className = `E2E 容灾与模态班级 ${suffix}`;
    const studentNum = `STU_RESILIENCE_${suffix}`;

    const screenshotDir = path.resolve(process.cwd(), 'artifacts/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    let lessonId = '';
    let classId = '';
    let studentId = '';

    try {
      // 0. API 认证
      const loginRes = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(loginRes.ok()).toBeTruthy();

      // 1. 创建测试课节
      const createLessonRes = await request.post('/api/lessons', {
        data: {
          title: lessonTitle,
          subject: '物理',
          grade: '高一',
          content: '离散微元与冲量动量定理探究',
          timeline_segments: JSON.stringify([
            { id: `seg_1_${suffix}`, title: '1. 现象导入', duration: '5m', notes: '观察冲量变化' },
            { id: `seg_2_${suffix}`, title: '2. 积分理论推导', duration: '20m', notes: '微元累加' },
          ]),
        },
      });
      expect(createLessonRes.ok()).toBeTruthy();
      const lessonJson = await createLessonRes.json();
      lessonId = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

      // 2. 创建班级与学生并绑定
      const createClassRes = await request.post('/api/classes', {
        data: { name: className, grade: '高一' },
      });
      expect(createClassRes.ok()).toBeTruthy();
      const classJson = await createClassRes.json();
      classId = classJson.id;

      const createStuRes = await request.post('/api/students', {
        data: {
          student_number: studentNum,
          name: `容灾测试生_${suffix.slice(0, 4)}`,
          gender: 'F',
        },
      });
      expect(createStuRes.ok()).toBeTruthy();
      const stuJson = await createStuRes.json();
      studentId = stuJson.id;

      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
        data: { studentId },
      });

      // 3. 初始化会话并直接推进至 IN_CLASS_TEACHING
      const initRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();

      const stageRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(stageRes.ok()).toBeTruthy();

      // 4. 浏览器登录并进入互动课堂
      await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');
      await page.locator('button:has-text("互动课堂")').first().click();

      // 检测活跃课堂，若展示“回到课堂”则点击
      const resumeBtn = page.getByRole('button', { name: '回到课堂' });
      if (await resumeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await resumeBtn.click();
      }

      // 验证授课界面就绪
      await expect(page.locator('#classroom-interactive-cockpit')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('教学步骤与页面大纲')).toBeVisible({ timeout: 15_000 });

      // =========================================================================
      // 5. 测试课中意外刷新容灾恢复 (Session Resilience: page.reload())
      // =========================================================================
      await page.reload();

      // 刷新后验证自动恢复到课中授课状态，未退回课前准备
      await expect(page.locator('#classroom-interactive-cockpit')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('教学步骤与页面大纲')).toBeVisible({ timeout: 15_000 });

      // 截图存盘：刷新恢复后现场
      const RESILIENCE_SHOT = path.join(screenshotDir, 'resilience_after_reload.png');
      await page.screenshot({ path: RESILIENCE_SHOT });
      expect(fs.existsSync(RESILIENCE_SHOT)).toBe(true);

      // =========================================================================
      // 6. 测试高级模态框 1：AI 实时学情预测 (MasteryPredictionModal)
      // =========================================================================
      const masteryBtn = page.locator('button[aria-label="AI 实时学情预测"]');
      await expect(masteryBtn).toBeVisible();
      await masteryBtn.click();

      const masteryModal = page.locator('div[role="dialog"]');
      await expect(masteryModal.getByText('AI 实时学情预测')).toBeVisible({ timeout: 10_000 });
      await expect(masteryModal.getByText('课堂进度')).toBeVisible();

      // 关闭 AI 预测弹窗
      await masteryModal.locator('button[aria-label="Close"]').click();
      await expect(masteryModal).toBeHidden({ timeout: 5_000 });

      // =========================================================================
      // 7. 测试高级模态框 2：课堂异常告警中心 (DiagnosticCenterModal)
      // =========================================================================
      const diagnosticBtn = page.locator('button[aria-label="课堂异常告警中心"]');
      await expect(diagnosticBtn).toBeVisible();
      await diagnosticBtn.click();

      const diagModal = page.locator('div[role="dialog"]');
      await expect(diagModal.getByText('课堂异常告警中心')).toBeVisible({ timeout: 10_000 });
      await expect(diagModal.getByRole('button', { name: /学生端异常/ })).toBeVisible();
      await expect(diagModal.getByRole('button', { name: /本机异常/ })).toBeVisible();

      // 关闭异常告警弹窗
      await diagModal.locator('button[aria-label="Close"]').click();
      await expect(diagModal).toBeHidden({ timeout: 5_000 });

      // =========================================================================
      // 8. 测试高级模态框 3：家校通知生成器 (ParentNotificationModal)
      // =========================================================================
      const parentNoticeBtn = page.locator('button[aria-label="家校通知生成器（课中预生成可在下课期间直接复制）"]');
      await expect(parentNoticeBtn).toBeVisible();
      await parentNoticeBtn.click();

      const noticeModal = page.locator('div[role="dialog"]');
      await expect(noticeModal.getByText('家校通知生成器')).toBeVisible({ timeout: 10_000 });

      // 关闭家校通知弹窗
      await noticeModal.locator('button[aria-label="Close"]').click();
      await expect(noticeModal).toBeHidden({ timeout: 5_000 });

      // =========================================================================
      // 9. 测试高级模态框 4：学生五维雷达成长档案 (StudentGrowthProfileModal)
      // =========================================================================
      const rollcallBtn = page.locator('#classroom-interactive-cockpit button:has-text("随机抽问")');
      await expect(rollcallBtn).toBeVisible();
      await rollcallBtn.click();

      const rollcallModal = page.locator('div[role="dialog"]');
      await expect(rollcallModal.getByText('课堂抽问与表现激励')).toBeVisible({ timeout: 10_000 });

      // 点击抽中学生的学情档案按钮
      const profileBtn = rollcallModal.locator('button:has-text("学情档案")');
      await expect(profileBtn).toBeVisible({ timeout: 10_000 });
      await profileBtn.click();

      // 验证学生成长档案弹窗展示
      const growthProfileBackdrop = page.locator('#student-growth-profile-modal-backdrop');
      await expect(growthProfileBackdrop).toBeVisible({ timeout: 10_000 });
      await expect(growthProfileBackdrop.getByText('个人综合成长档案')).toBeVisible();

      // 截图存盘：高级模态框五维档案全景
      const MODALS_SHOT = path.join(screenshotDir, 'advanced_teaching_modals.png');
      await page.screenshot({ path: MODALS_SHOT });
      expect(fs.existsSync(MODALS_SHOT)).toBe(true);

      // 关闭学情档案弹窗
      await growthProfileBackdrop.locator('button[aria-label="Close"]').click();
      await expect(growthProfileBackdrop).toBeHidden({ timeout: 5_000 });

      // 关闭抽问弹窗
      await rollcallModal.locator('button[aria-label="Close"]').click();
      await expect(rollcallModal).toBeHidden({ timeout: 5_000 });
    } finally {
      if (lessonId) await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      if (classId) await request.delete(`/api/classes/${classId}`).catch(() => {});
      if (studentId) await request.delete(`/api/students/${studentId}`).catch(() => {});
    }
  });
});
