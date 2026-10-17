import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

function purgeTeacherCockpitE2EFromDb() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  try {
    const lessons = db
      .prepare("SELECT id FROM lessons WHERE title LIKE 'E2E 中控操控课节%'")
      .all() as { id: string }[];
    for (const l of lessons) {
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_buzzers WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    }

    const classes = db
      .prepare("SELECT id FROM classes WHERE name LIKE 'E2E 中控操控班级%'")
      .all() as { id: string }[];
    for (const c of classes) {
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
    }

    const students = db
      .prepare("SELECT id FROM students WHERE student_number LIKE 'STU_COCKPIT_%'")
      .all() as { id: string }[];
    for (const s of students) {
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(s.id);
      db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    }
  } finally {
    db.close();
  }
}

test.describe('教师端中控与白板多环节操控 E2E 测试 (Phase 2)', () => {
  test.beforeAll(async () => {
    purgeTeacherCockpitE2EFromDb();
  });

  test.afterAll(async () => {
    purgeTeacherCockpitE2EFromDb();
  });

  test('验证教学环节切换、白板页面大纲导航、视野伸缩与中控互动工具箱唤起 (Generates Artifact: Screenshot)', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(90_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `E2E 中控操控课节 ${suffix}`;
    const className = `E2E 中控操控班级 ${suffix}`;
    const studentNum = `STU_COCKPIT_${suffix}`;

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

      // 1. 创建测试课节（包含 3 个教学环节）
      const createLessonRes = await request.post('/api/lessons', {
        data: {
          title: lessonTitle,
          subject: '物理',
          grade: '高一',
          content: '变力做功与微元累加综合探究',
          timeline_segments: JSON.stringify([
            { id: `seg_1_${suffix}`, title: '1. 情境导入与实验演示', duration: '5m', notes: '观察弹簧振子与非恒力拉伸' },
            { id: `seg_2_${suffix}`, title: '2. 微元离散分析与积分推导', duration: '15m', notes: '将位移划分为无限小段求和' },
            { id: `seg_3_${suffix}`, title: '3. 随堂随测与变式训练', duration: '10m', notes: '独立作答随堂测试题' },
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
          name: `中控测试生_${suffix.slice(0, 4)}`,
          gender: 'M',
        },
      });
      expect(createStuRes.ok()).toBeTruthy();
      const stuJson = await createStuRes.json();
      studentId = stuJson.id;

      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
        data: { studentId },
      });

      // 3. 初始化会话并流转至 IN_CLASS_TEACHING
      const initRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
        data: { classId, teachingModeId: 'lecture' },
      });
      expect(initRes.ok()).toBeTruthy();

      const stageRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(stageRes.ok()).toBeTruthy();

      // 4. 登录教师账号并进入互动课堂
      await context.request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });

      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');
      await page.locator('button:has-text("互动课堂")').first().click();

      // Issue #91: 进入互动课堂先展示进行中会话列表（不再自动进入）→ 点「继续上课」
      const resumeFromList = page.getByRole('button', { name: /继续上课|Resume/ }).first();
      if (await resumeFromList.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await resumeFromList.click();
      }

      // 检测到活跃课堂，如果展示“回到课堂”按钮则点击
      const resumeBtn = page.getByRole('button', { name: '回到课堂' });
      if (await resumeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await resumeBtn.click();
      }

      // 验证课中授课界面与中控导航挂载
      await expect(page.locator('#classroom-interactive-cockpit')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('教学步骤与页面大纲')).toBeVisible({ timeout: 15_000 });

      // =========================================================================
      // 5. 测试教学步骤时间轴切换（环节 1 -> 环节 2）
      // =========================================================================
      // 初始状态下点击广播第 2 环节
      const broadcastStep2Btn = page.locator('button:has-text("广播此环节")').nth(1);
      await expect(broadcastStep2Btn).toBeVisible({ timeout: 10_000 });
      await broadcastStep2Btn.click();

      // 验证第 2 环节变更为“同步演示中”
      await expect(page.locator('button:has-text("同步演示中")')).toBeVisible({ timeout: 10_000 });

      // =========================================================================
      // 6. 测试白板页面大纲导航（新增白板页、翻页、大纲折叠）
      // =========================================================================
      // 点击新增白板页
      const addPageBtn = page.locator('button[title="新建白板页面"]');
      await expect(addPageBtn).toBeVisible();
      await addPageBtn.click();

      // 验证页面大纲中出现 P2
      const page2Item = page.locator('div:has-text("P2")').first();
      await expect(page2Item).toBeVisible({ timeout: 10_000 });

      // 点击折叠白板页面大纲
      const outlineToggle = page.locator('button:has-text("白板页面大纲")');
      await expect(outlineToggle).toBeVisible();
      await outlineToggle.click();

      // 验证出现“展开”按钮
      const expandOutlineBtn = page.locator('span:has-text("展开")').first();
      await expect(expandOutlineBtn).toBeVisible();
      // 点击恢复展开
      await expandOutlineBtn.click();
      await expect(page.locator('div:has-text("P1")').first()).toBeVisible();

      // =========================================================================
      // 7. 测试视野伸缩（收起左侧边栏、收起右侧动态流）
      // =========================================================================
      // 收起左侧步骤边栏
      const collapseLeftBtn = page.locator('button[title="收起边栏以扩大白板视野"]');
      await expect(collapseLeftBtn).toBeVisible();
      await collapseLeftBtn.click();

      // 验证展开边栏按钮出现
      const expandLeftBtn = page.locator('button[title="展开环节大纲"]');
      await expect(expandLeftBtn).toBeVisible({ timeout: 5_000 });

      // 恢复左侧边栏
      await expandLeftBtn.click();
      await expect(page.getByText('教学步骤与页面大纲')).toBeVisible();

      // 截图存盘：白板大纲与时间轴操控完成
      const COCKPIT_SHOT1 = path.join(screenshotDir, 'teacher_cockpit_timeline_and_whiteboard.png');
      await page.screenshot({ path: COCKPIT_SHOT1 });
      expect(fs.existsSync(COCKPIT_SHOT1)).toBe(true);

      // =========================================================================
      // 8. 测试教师端中控工具箱唤出与关闭（抢答器、随机抽问、积分榜）
      // =========================================================================
      // 8.1 抢答器控制
      const startBuzzerBtn = page.locator('#classroom-interactive-cockpit button:has-text("发起抢答")');
      await expect(startBuzzerBtn).toBeVisible();
      await startBuzzerBtn.click();

      // 按钮状态翻转为“重置抢答”
      const resetBuzzerBtn = page.locator('#classroom-interactive-cockpit button:has-text("重置抢答")');
      await expect(resetBuzzerBtn).toBeVisible({ timeout: 5_000 });
      await resetBuzzerBtn.click();
      // 重置后抢答器就绪，按钮依然保持就绪重置状态
      await expect(resetBuzzerBtn).toBeVisible({ timeout: 5_000 });

      // 8.2 唤出随机抽问模态窗并关闭
      const rollcallBtn = page.locator('#classroom-interactive-cockpit button:has-text("随机抽问")');
      await expect(rollcallBtn).toBeVisible();
      await rollcallBtn.click();

      const rollcallModal = page.locator('div[role="dialog"]');
      await expect(rollcallModal.getByText('课堂抽问与表现激励')).toBeVisible({ timeout: 10_000 });
      // 点击关闭随机抽问弹窗
      await rollcallModal.locator('button[aria-label="Close"]').click();
      await expect(rollcallModal).toBeHidden({ timeout: 5_000 });

      // 8.3 唤出班级积分榜模态窗并关闭
      const leaderboardBtn = page.locator('#classroom-interactive-cockpit button:has-text("积分榜")');
      await expect(leaderboardBtn).toBeVisible();
      await leaderboardBtn.click();

      const leaderboardModal = page.locator('div[role="dialog"]');
      await expect(leaderboardModal.getByRole('button', { name: '小组联赛' })).toBeVisible({ timeout: 10_000 });
      await expect(leaderboardModal.getByRole('button', { name: '个人英雄榜' })).toBeVisible();

      // 截图存盘：中控模态框交互
      const COCKPIT_SHOT2 = path.join(screenshotDir, 'teacher_cockpit_interaction_modals.png');
      await page.screenshot({ path: COCKPIT_SHOT2 });
      expect(fs.existsSync(COCKPIT_SHOT2)).toBe(true);

      // 关闭积分榜弹窗
      await leaderboardModal.locator('button[aria-label="Close"]').click();
      await expect(leaderboardModal).toBeHidden({ timeout: 5_000 });
    } finally {
      if (lessonId) await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      if (classId) await request.delete(`/api/classes/${classId}`).catch(() => {});
      if (studentId) await request.delete(`/api/students/${studentId}`).catch(() => {});
    }
  });
});
