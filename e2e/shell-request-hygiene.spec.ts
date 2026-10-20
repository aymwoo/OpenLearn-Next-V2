import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

/**
 * 外壳请求卫生（浏览器级回归）。
 *
 * ## 背景
 *
 * 功能巡检（`pnpm sweep`）发现的三条缺陷，都是「外壳一打开就稳定报错」的类型：
 *
 * 1. 学生端每 5s 请求 `/api/db-status`（仅教师/管理员可读）→ 恒定 403；
 * 2. 学生端请求 `/api/students?pageSize=all` → 恒定 403，
 *    而且**取不到自己那一行** → 教师锁了学生、学生端却不受约束；
 * 3. 教师端在没有进行中课堂会话时回写 `/view-state` → 恒定 404。
 *
 * 单元测试锁住了各自的逻辑（见 `src/components/__tests__/shell-request-hygiene.test.tsx`
 * 与 `server/__tests__/student-self-roster-scope.test.ts`），本文件负责在**真实浏览器
 * 里**守住整条链路：外壳加载过程中不得出现任何 console 错误或 4xx/5xx 响应。
 *
 * 这类断言只有端到端跑才抓得到 —— 组件单测看不到「学生登录后那个外壳到底发了哪些请求」。
 */

/** 收集页面上的 console 错误与失败请求。 */
function watchNoise(page: Page) {
  const consoleErrors: string[] = [];
  const badResponses: { url: string; status: number }[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push({ url: res.url(), status: res.status() });
  });

  return { consoleErrors, badResponses };
}

/** 登录教师并把会话 Cookie 注入上下文。 */
async function loginTeacher(context: BrowserContext, request: APIRequestContext) {
  const res = await request.post('/api/auth/login', {
    data: { entrance: 'teacher', username: 'admin', password: 'admin' },
  });
  expect(res.ok(), '教师登录应成功').toBeTruthy();
}

/** 登录学生并把会话 Cookie 注入上下文。 */
async function loginStudent(context: BrowserContext, request: APIRequestContext, studentNumber: string) {
  const res = await request.post('/api/auth/login', {
    data: { entrance: 'student', studentId: studentNumber, password: 'password123' },
  });
  expect(res.ok(), '学生登录应成功').toBeTruthy();
}

test.describe('外壳请求卫生：加载教师/学生外壳不产生错误请求', () => {
  test('教师外壳：无 console 错误、无 4xx/5xx', async ({ page, context, request }) => {
    await loginTeacher(context, request);

    const noise = watchNoise(page);
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    await page.goto('/');
    // 教师端默认落在互动课堂 —— 正是曾经稳定产生 view-state 404 的那个视图。
    await expect(page.locator('#navigation_sidebar')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);

    expect(noise.consoleErrors, `教师外壳出现 console 错误：\n${noise.consoleErrors.join('\n')}`).toEqual([]);
    expect(
      noise.badResponses,
      `教师外壳出现失败请求：\n${noise.badResponses.map((r) => `${r.status} ${r.url}`).join('\n')}`,
    ).toEqual([]);
  });

  test('学生外壳：无 console 错误、无 4xx/5xx，且能取到自己的记录', async ({ page, context, request }) => {
    const suffix = Date.now().toString().slice(-6);
    const studentNumber = `HYG-${suffix}`;

    // 前置数据：一个班级 + 一个学生
    const classRes = await request.post('/api/classes', {
      data: { name: `外壳卫生班 ${suffix}`, description: '外壳请求卫生回归用例' },
    });
    expect(classRes.ok(), '建班应成功').toBeTruthy();
    const classId = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNumber, name: `外壳卫生生${suffix}`, password: 'password123' },
    });
    expect(stuRes.ok(), '建学生应成功').toBeTruthy();
    const studentId = (await stuRes.json()).id;

    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, {
      data: { studentId },
    });

    try {
      await loginStudent(context, request, studentNumber);

      const noise = watchNoise(page);
      await page.addInitScript(() => {
        localStorage.setItem('edu_os_tour_completed', 'true');
      });

      await page.goto('/');
      await page.waitForTimeout(4000);

      expect(
        noise.consoleErrors,
        `学生外壳出现 console 错误：\n${noise.consoleErrors.join('\n')}`,
      ).toEqual([]);
      expect(
        noise.badResponses,
        `学生外壳出现失败请求：\n${noise.badResponses.map((r) => `${r.status} ${r.url}`).join('\n')}`,
      ).toEqual([]);

      // 学生必须能取到「自己这一条」（含锁定字段），否则教师端的锁在学生端失效。
      const roster = await request.get('/api/students?pageSize=all');
      expect(roster.ok(), '学生取花名册应返回 200').toBeTruthy();
      const body = (await roster.json()) as { data: any[]; total: number };
      expect(body.total).toBe(1);
      expect(body.data[0].id).toBe(studentId);
      expect(body.data[0]).toHaveProperty('locked_lesson_id');
      expect(body.data[0].private_notes).toBeUndefined();
    } finally {
      // 清理本用例创建的数据
      await request.delete(`/api/students/${encodeURIComponent(studentId)}`).catch(() => {});
      await request.delete(`/api/classes/${encodeURIComponent(classId)}`).catch(() => {});
    }
  });
});
