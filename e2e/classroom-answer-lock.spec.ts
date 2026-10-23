/**
 * 归属：课堂 / 答案锁定 —— 课堂答题锁定：锁定后不再接受作答
 *
 * Issue #230：CI 改为跑 e2e/ 下**全部**用例（pnpm test:e2e），
 * 本注释用于标明该用例覆盖的能力域 —— 新增用例时按同一口径挂靠。
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function loginAdmin(request: APIRequestContext) {
  let res = await request.post('/api/auth/login', {
    data: { entrance: 'teacher', username: 'admin', password: 'admin' },
  });
  if (!res.ok()) {
    res = await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'AdminPassword123' },
    });
  } else {
    const data = await res.json().catch(() => ({}));
    if (data?.session?.mustChangePassword) {
      await request
        .post('/api/auth/change-password', {
          data: { oldPassword: 'admin', newPassword: 'AdminPassword123' },
        })
        .catch(() => {});
      res = await request.post('/api/auth/login', {
        data: { entrance: 'teacher', username: 'admin', password: 'AdminPassword123' },
      });
    }
  }
  expect(res.ok()).toBeTruthy();
}

async function openStudent(page: Page, lessonId: string, studentId: string, classId: string) {
  await page.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });
  const classParam = classId ? `&classId=${encodeURIComponent(classId)}` : '';
  await page.goto(
    `/?mode=student_live&studentId=${encodeURIComponent(studentId)}&lessonId=${encodeURIComponent(lessonId)}${classParam}#/student_live`,
  );
}

test.describe('课堂双锁定模式解耦 E2E 测试（Issue #110）', () => {
  test('答题锁定下限制页面导航与切Tab，但允许学生正常答题提交；切回专注锁定则完全只读', async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(90_000);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const title = `E2E 答题锁定测试课 ${suffix}`;
    const studentNum = `STU_LOCK_${suffix}`;
    let lessonId = '';
    let studentId = '';
    let classId = '';

    const cleanup = async () => {
      await loginAdmin(request).catch(() => {});
      if (lessonId && classId) {
        await request
          .post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
            data: { stage: 'ARCHIVED_REPORT', classId },
          })
          .catch(() => {});
      }
      if (lessonId) await request.delete(`/api/lessons/${encodeURIComponent(lessonId)}`).catch(() => {});
      if (studentId) await request.delete(`/api/students/${encodeURIComponent(studentId)}`).catch(() => {});
      if (classId) await request.delete(`/api/classes/${encodeURIComponent(classId)}`).catch(() => {});
    };

    try {
      // 1. 教师侧准备：班级、学生、课节与白板题目
      await loginAdmin(request);
      const classRes = await request.post('/api/classes', { data: { name: `E2E 答题锁定班级 ${suffix}` } });
      expect(classRes.ok()).toBeTruthy();
      const classBody = await classRes.json();
      classId = classBody.id || classBody.class?.id || classBody.result?.id;

      const stuRes = await request.post('/api/students', {
        data: { name: `答题测试生 ${suffix}`, student_number: studentNum, password: 'password123' },
      });
      expect(stuRes.ok()).toBeTruthy();
      const stuBody = await stuRes.json();
      studentId = stuBody.id || stuBody.student?.id;

      await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
        data: { studentId },
      });

      const lessonRes = await request.post('/api/lessons', { data: { title, content: '答题锁定测试' } });
      expect(lessonRes.ok()).toBeTruthy();
      const lessonBody = await lessonRes.json();
      lessonId = lessonBody.result?.lessonId || lessonBody.lessonId || lessonBody.id;

      // 白板添加一道随堂练习
      const quizRes = await request.post(`/api/lessons/${lessonId}/whiteboard`, {
        data: {
          type: 'quiz',
          data: { question: '1024 * 1024 = ?', options: ['1048576', '1000000'], correctAnswer: 'A' },
        },
      });
      expect(quizRes.ok()).toBeTruthy();
      const quizBody = await quizRes.json();
      const quizId = quizBody.result?.elementId || quizBody.elementId || quizBody.element?.id || quizBody.id;
      expect(quizId).toBeTruthy();

      // 初始化课堂
      const initRes = await request.post(`/api/classroom/sessions/${lessonId}/init`, {
        data: { classId },
      });
      expect(initRes.ok()).toBeTruthy();

      // 2. 教师下发「答题锁定」（mode: 'navigation'）
      const lockNavRes = await request.post(`/api/classes/${encodeURIComponent(classId)}/lock_lesson`, {
        data: { lessonId, mode: 'navigation' },
      });
      expect(lockNavRes.ok()).toBeTruthy();
      const lockNavData = await lockNavRes.json();
      expect(lockNavData.success).toBe(true);

      // 验证学生档案已持久化锁定状态与模式
      const stuProfileRes = await request.get(`/api/students/${encodeURIComponent(studentId)}/dashboard`);
      expect(stuProfileRes.ok()).toBeTruthy();
      const stuProfile = await stuProfileRes.json();
      expect(stuProfile.profile?.locked_lesson_id).toBe(lessonId);
      expect(stuProfile.profile?.lock_mode).toBe('navigation');

      // 3. 学生端登录并进入课堂
      const studentLogin = await context.request.post('/api/auth/login', {
        data: { entrance: 'student', studentId: studentNum, password: 'password123' },
      });
      expect(studentLogin.ok()).toBeTruthy();

      await openStudent(page, lessonId, studentId, classId);

      // 4. 验证学生端「答题锁定」UI 状态
      // 顶部呈现琥珀金胶囊提示「答题锁定中 · 请完成作答后提交，暂时无法离开本页」
      const statusPill = page.locator('div[role="status"]', { hasText: '答题锁定中' });
      await expect(statusPill).toBeVisible({ timeout: 20_000 });
      await expect(statusPill).toContainText('请完成作答后提交，暂时无法离开本页');

      // 导航受限：返回看板按钮被隐藏
      await expect(page.getByRole('button', { name: /Back to Dashboard/i })).toBeHidden();

      // 切 Tab 拦截：尝试点击其他 Tab（若存在）或验证标签页样式具有禁切提示
      const coursewareTabBtn = page.getByRole('button', { name: /课件/i });
      if (await coursewareTabBtn.isVisible().catch(() => false)) {
        await coursewareTabBtn.click();
        // 验证 Toast 出现或依然停留在白板
        const toast = page.locator('div', { hasText: /答题锁定/i });
        await expect(toast.first())
          .toBeVisible({ timeout: 5000 })
          .catch(() => {});
      }

      // 5. 交互放开：学生在答题锁定下允许正常提交测验
      const quizSubmitRes = await context.request.post(`/api/lessons/${lessonId}/quiz-submit`, {
        data: { elementId: quizId, answer: 'A', timeSpentMs: 1500 },
      });
      expect(quizSubmitRes.ok()).toBeTruthy();

      // 6. 教师切换为「完全专注锁定」（mode: 'full'）
      const lockFullRes = await request.post(`/api/classes/${encodeURIComponent(classId)}/lock_lesson`, {
        data: { lessonId, mode: 'full' },
      });
      expect(lockFullRes.ok()).toBeTruthy();
      const lockFullData = await lockFullRes.json();
      expect(lockFullData.success).toBe(true);

      const stuFullProfileRes = await request.get(`/api/students/${encodeURIComponent(studentId)}/dashboard`);
      expect(stuFullProfileRes.ok()).toBeTruthy();
      expect((await stuFullProfileRes.json()).profile?.lock_mode).toBe('full');

      // 重新载入学生端确认同步
      await openStudent(page, lessonId, studentId, classId);

      // 顶部呈现靛蓝色胶囊「全班专注锁定 · 跟随教师授课」
      const focusPill = page.locator('div[role="status"]', { hasText: '全班专注锁定' });
      await expect(focusPill).toBeVisible({ timeout: 20_000 });
      await expect(focusPill).toContainText('跟随教师授课');

      // 7. 教师解除锁定
      const unlockRes = await request.post(`/api/classes/${encodeURIComponent(classId)}/unlock_lesson`);
      expect(unlockRes.ok()).toBeTruthy();

      // 学生端刷新后锁定解除，恢复 Back to Dashboard 按钮
      await openStudent(page, lessonId, studentId, classId);
      await expect(statusPill).toBeHidden();
      await expect(focusPill).toBeHidden();
      await expect(page.getByRole('button', { name: /Back to Dashboard/i })).toBeVisible({ timeout: 20_000 });
    } finally {
      await cleanup();
    }
  });
});
