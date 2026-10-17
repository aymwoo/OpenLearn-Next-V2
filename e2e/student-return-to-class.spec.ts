import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Issue #109: 学生离开正在进行的课堂后，通过看板顶部「返回课堂」横幅回到课堂。
 *
 * 覆盖：
 *   1. 老师开课（未锁定）→ 学生看板出现真实会话横幅（不再依赖排课猜测）；
 *   2. 学生点 Back to Dashboard 离开 → 横幅仍在，一键返回授课视图；
 *   3. 刷新页面后仍能看到返回入口；
 *   4. 会话归档后刷新 → 入口自动消失。
 */
test.describe('学生端「返回课堂」入口 (Issue #109)', () => {
  test('离开课堂后可从看板横幅返回，刷新保留、归档后消失', async ({ browser, request }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const className = `E2E 返回课堂班级 ${suffix}`;
    const lessonTitle = `E2E 返回课堂课节 ${suffix}`;
    const studentNum = `STU_RETURN_${Date.now().toString(36).toUpperCase()}`;
    const studentPwd = '123456';

    let classId: string | null = null;
    let lessonId: string | null = null;
    let studentId: string | null = null;
    let sessionId: string | null = null;

    const teacher = await browser.newContext();
    const student = await browser.newContext();
    const teacherPage = await teacher.newPage();
    const studentPage = await student.newPage();

    try {
      // 1. 教师准备班级/学生/课程，初始化会话并推进到课中
      const loginRes = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'admin' },
      });
      expect(loginRes.ok()).toBeTruthy();

      const classRes = await request.post('/api/classes', { data: { name: className } });
      expect(classRes.ok()).toBeTruthy();
      classId = (await classRes.json()).id;

      const lessonRes = await request.post('/api/lessons', {
        data: { title: lessonTitle, content: '返回课堂测试' },
      });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonData = await lessonRes.json();
      lessonId = lessonData.result?.lessonId || lessonData.id;

      const stuRes = await request.post('/api/students', {
        data: { student_number: studentNum, name: `返回课堂学生${suffix.slice(-4)}`, password: studentPwd },
      });
      expect(stuRes.ok()).toBeTruthy();
      studentId = (await stuRes.json()).id;
      await request.post(`/api/classes/${classId}/students`, { data: { studentId } });

      const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
        data: { classId },
      });
      expect(initRes.ok()).toBeTruthy();
      const stageRes = await request.post(`/api/classroom/sessions/${lessonId}/stage`, {
        data: { stage: 'IN_CLASS_TEACHING', classId },
      });
      expect(stageRes.ok(), await stageRes.text()).toBeTruthy();

      // 2. 学生登录并进入看板
      const studentLogin = await student.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: studentNum, password: studentPwd },
      });
      expect(studentLogin.ok()).toBeTruthy();
      await studentPage.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });
      await studentPage.goto('/');

      const banner = studentPage.getByTestId('student-active-class-banner');
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner.getByText(lessonTitle)).toBeVisible();
      await expect(studentPage.getByTestId('student-header-return-to-class')).toBeVisible();

      // 3. 返回课堂 → 进入课节视图
      await banner.getByRole('button', { name: '返回课堂' }).click();
      await expect(studentPage.getByText('Back to Dashboard')).toBeVisible({ timeout: 15_000 });

      // 4. 学生离开课堂（Back to Dashboard）→ 横幅仍在，可再次返回
      await studentPage.getByText('Back to Dashboard').click();
      await expect(studentPage.getByTestId('student-active-class-banner')).toBeVisible({ timeout: 10_000 });

      // 5. 刷新页面：返回入口仍在（会话未结束）
      await studentPage.reload();
      await expect(studentPage.getByTestId('student-active-class-banner')).toBeVisible({ timeout: 20_000 });
      await expect(studentPage.getByTestId('student-active-class-banner').getByText(lessonTitle)).toBeVisible();

      // 截图留证：看板顶部「正在上课 · 返回课堂」横幅
      const shotDir = path.join(process.cwd(), 'artifacts', 'screenshots');
      if (!fs.existsSync(shotDir)) fs.mkdirSync(shotDir, { recursive: true });
      const shot = path.join(shotDir, 'student_return_to_class_banner.png');
      await studentPage.screenshot({ path: shot, fullPage: true });
      expect(fs.existsSync(shot)).toBe(true);

      // 6. 老师结束并归档会话 → 学生刷新后入口消失
      const listRes = await request.get(`/api/classroom/sessions?lessonId=${lessonId}&status=active`);
      expect(listRes.ok()).toBeTruthy();
      const listData = await listRes.json();
      sessionId = listData.items?.[0]?.id || null;
      expect(sessionId).toBeTruthy();
      const archiveRes = await request.post(`/api/classroom/sessions/${sessionId}/archive`);
      expect(archiveRes.ok(), await archiveRes.text()).toBeTruthy();

      await studentPage.reload();
      await expect(studentPage.getByTestId('student-active-class-banner')).toHaveCount(0, { timeout: 20_000 });
    } finally {
      if (sessionId) {
        await request.post(`/api/classroom/sessions/${sessionId}/archive`).catch(() => {});
      }
      if (lessonId) await request.delete(`/api/lessons/${lessonId}`).catch(() => {});
      if (studentId) await request.delete(`/api/students/${studentId}`).catch(() => {});
      if (classId) await request.delete(`/api/classes/${classId}`).catch(() => {});
      await teacher.close();
      await student.close();
    }
  });
});
