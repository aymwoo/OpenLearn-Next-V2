/**
 * C 组迁移 P1：Student Workspace 预览壳的真实渲染验证
 *
 * 目的不是断言功能等价（它不等价，见 docs/student-workspace-migration.md），
 * 而是验证两件事：
 * 1. 开关默认关闭 —— 学生端仍是现行 `StudentView`，零影响；
 * 2. 显式开启后，那套从没挂载过的壳**能在真实浏览器里渲染出来**
 *    （它此前从未进入可达图，崩溃与否未知）。
 *
 * 归属：学生端 —— C 组迁移（docs/student-workspace-migration.md）
 */
import { test, expect } from '@playwright/test';

test.describe('Student Workspace 预览壳（C 组 P1）', () => {
  test('默认不启用：学生端仍是现行壳', async ({ page, context }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `STU_SW_${suffix}`;

    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const stuRes = await context.request.post('/api/students', {
      data: { student_number: studentNum, name: `预览壳生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();

    await context.request.post('/api/auth/logout').catch(() => {});
    const loginRes = await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    expect(loginRes.ok(), '学生登录应成功').toBeTruthy();

    await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
    await page.goto('/');
    await page.waitForTimeout(3000);

    // 默认路径：预览壳不应出现
    await expect(page.getByTestId('student-workspace-preview')).toHaveCount(0);
  });

  test('显式开启：预览壳渲染出来，且带「功能不等价」横幅', async ({ page, context }) => {
    test.setTimeout(120_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const studentNum = `STU_SW2_${suffix}`;

    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    const stuRes = await context.request.post('/api/students', {
      data: { student_number: studentNum, name: `预览壳生${suffix.slice(0, 4)}`, password: 'password123' },
    });
    expect(stuRes.ok()).toBeTruthy();

    await context.request.post('/api/auth/logout').catch(() => {});
    const loginRes = await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    expect(loginRes.ok(), '学生登录应成功').toBeTruthy();

    await page.addInitScript(() => localStorage.setItem('edu_os_tour_completed', 'true'));
    await page.goto('/?studentShell=workspace');

    const preview = page.getByTestId('student-workspace-preview');
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByText(/功能不等价于现有学生端/)).toBeVisible({ timeout: 10_000 });

    // 渲染过程不能抛未捕获错误（首次挂载的关键验证）
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForTimeout(2000);
    expect(errors, `预览壳渲染时出现未捕获错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
