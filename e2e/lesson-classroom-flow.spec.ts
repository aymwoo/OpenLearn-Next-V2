import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('edu_os_tour_completed', 'true');
  });
  await page.goto('/');

  const usernameInput = page.locator('input[placeholder*="教工账户名"]');
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  await usernameInput.fill('admin');
  await page.locator('input[placeholder*="输入登录密码"]').fill('admin');
  await page.locator('button:has-text("安全验证登录"), button[type="submit"]').first().click();

  await expect(usernameInput).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('button:has-text("课程管理")').first()).toBeVisible();
}

async function openCourseEditor(page: Page, courseTitle: string): Promise<void> {
  await page.locator('button:has-text("课程管理")').first().click();
  const search = page.getByPlaceholder('Search courses by title...');
  await expect(search).toBeVisible();
  await search.fill(courseTitle);
  await page.getByText(courseTitle, { exact: true }).click();
  await expect(page.getByText(`课程编辑器: ${courseTitle}`)).toBeVisible();
}

async function courseHasSegment(request: APIRequestContext, title: string, segmentTitle: string): Promise<boolean> {
  const response = await request.get('/api/lessons');
  if (!response.ok()) return false;

  const lessons = (await response.json()) as Array<{ title: string; timeline?: string | unknown[] | null }>;
  const lesson = lessons.find((item) => item.title === title);
  if (!lesson?.timeline) return false;

  try {
    const timeline = typeof lesson.timeline === 'string' ? JSON.parse(lesson.timeline) : lesson.timeline;
    return Array.isArray(timeline) && timeline.some((segment) => segment.title === segmentTitle);
  } catch {
    return false;
  }
}

async function courseHasElement(request: APIRequestContext, lessonId: string, type: string): Promise<boolean> {
  const response = await request.get(`/api/lessons/${lessonId}/whiteboard`);
  if (!response.ok()) return false;
  const elements = (await response.json()) as Array<{ type: string }>;
  return Array.isArray(elements) && elements.some((element) => element.type === type);
}

test('管理员可编辑课程、保存回读并按所选班级与模式开课', async ({ page, request }) => {
  test.setTimeout(180_000);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const courseTitle = `E2E 课程编辑与开课 ${suffix}`;
  const className = `E2E 授课班级 ${suffix}`;
  const segmentTitle = `E2E 已保存环节 ${suffix}`;
  const createdClassIds: string[] = [];
  let lessonId: string | null = null;

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    expect(loginResponse.ok()).toBeTruthy();

    const classResponse = await request.post('/api/classes', {
      data: { name: className, description: 'Playwright classroom-flow fixture' },
    });
    expect(classResponse.ok()).toBeTruthy();
    const classData = (await classResponse.json()) as { id: string };
    createdClassIds.push(classData.id);

    const lessonResponse = await request.post('/api/lessons', {
      data: { title: courseTitle, content: 'Playwright persistence and classroom flow fixture.' },
    });
    expect(lessonResponse.ok()).toBeTruthy();
    const lessonData = (await lessonResponse.json()) as { result?: { lessonId?: string } };
    lessonId = lessonData.result?.lessonId ?? null;
    expect(lessonId).toBeTruthy();

    await loginAsAdmin(page);
    await openCourseEditor(page, courseTitle);

    await page.getByRole('button', { name: /加环节/ }).click();
    const segmentName = page.getByLabel('环节名称');
    await expect(segmentName).toBeVisible();
    await segmentName.fill(segmentTitle);
    await expect.poll(() => courseHasSegment(request, courseTitle, segmentTitle)).toBe(true);

    const helloPaletteCard = page
      .locator('[title="点击编辑并添加到画板，或拖拽到画板"]')
      .filter({ hasText: '问候插件' });
    await expect(helloPaletteCard).toBeVisible();
    await helloPaletteCard.click();
    await expect(page.getByText('编辑：问候插件')).toBeVisible();
    await page.getByRole('button', { name: '添加到画板' }).click();
    await expect.poll(() => courseHasElement(request, lessonId!, 'hello-world')).toBe(true);

    await page.getByRole('button', { name: '返回课程库' }).click();
    await openCourseEditor(page, courseTitle);
    await expect(page.getByLabel('环节名称')).toHaveValue(segmentTitle);
    await expect(page.getByText('Hello World 插件')).toBeVisible();
    await expect.poll(() => courseHasElement(request, lessonId!, 'hello-world')).toBe(true);

    await page.locator('button:has-text("互动课堂")').first().click();
    await expect(page.getByText('选择授课课程')).toBeVisible();
    await page.getByRole('button', { name: new RegExp(courseTitle) }).click();

    const classSearch = page.getByRole('searchbox', { name: '搜索班级' });
    await classSearch.fill(className);
    await page.getByRole('button', { name: new RegExp(className) }).click();
    await page.getByRole('radio', { name: /讲授式/ }).click();
    await page.getByRole('button', { name: /进入数字赋能课堂/ }).click();
    await expect(page.locator('#pre-class-ready-view')).toBeVisible();

    await expect
      .poll(async () => {
        const response = await request.get(`/api/classroom/sessions/${lessonId}`);
        if (!response.ok()) return null;
        const data = (await response.json()) as { session?: Record<string, unknown> };
        if (!data.session) return null;
        return {
          lesson_id: data.session.lesson_id,
          class_id: data.session.class_id,
          teaching_mode_id: data.session.teaching_mode_id,
          stage: data.session.stage,
        };
      })
      .toEqual({
        lesson_id: lessonId,
        class_id: classData.id,
        teaching_mode_id: 'lecture',
        stage: 'PRE_CLASS_READY',
      });
  } finally {
    if (lessonId) {
      await request.delete(`/api/lessons/${lessonId}`).catch(() => undefined);
    }
    for (const classId of createdClassIds) {
      await request.delete(`/api/classes/${classId}`).catch(() => undefined);
    }
  }
});
