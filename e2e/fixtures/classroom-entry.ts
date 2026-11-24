import type { Locator, Page } from '@playwright/test';

/**
 * 等待 locator 出现后点击；超时则返回 false。
 *
 * 为什么不用 `locator.isVisible({ timeout })`：Playwright 的 `isVisible()` **不会等待**，
 * `timeout` 只是个被忽略的兼容参数，调用会立刻返回当前状态。Issue #91 把互动课堂首屏
 * 换成「进行中的课堂会话」列表后，列表要先发一次 `GET /api/classroom/sessions` 才渲染，
 * 于是「首屏刷新即立刻判断」的老写法必然判断得太早（列表还是骨架），点不到「继续上课」，
 * 后续 `#classroom-interactive-cockpit` 断言必然超时。
 */
export async function clickIfVisible(locator: Locator, timeout = 5_000): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * Issue #131：学生首次进入课中视图会自动弹出「课前破冰心情打卡」全屏遮罩
 * （`data-testid="student-icebreaker-modal"`，`aria-modal` 会拦截其后所有点击）。
 *
 * 幂等：未弹窗直接返回 false。需要在学生端做点击操作的用例应先调用本 helper，
 * 否则后续 click 会被遮罩吞掉（表现为 90s 测试超时 + `intercepts pointer events`）。
 */
export async function dismissIcebreakerIfPresent(page: Page, timeout = 5_000): Promise<boolean> {
  const modal = page.getByTestId('student-icebreaker-modal');
  const shown = await modal
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await page.getByTestId('icebreaker-skip-btn').click();
  await modal.waitFor({ state: 'hidden', timeout: 10_000 });
  return true;
}

/**
 * 白板课进入授课视图时会先弹出「开课前功能设置」。
 * 对话框盖住后面的按钮；确认后本课内不再出现，刷新后会再弹一次。
 */
export async function dismissClassroomToolbarSetup(page: Page, timeout = 8_000): Promise<boolean> {
  const dialog = page.getByRole('dialog', { name: '开课前功能设置' });
  const shown = await dialog
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await dialog.getByRole('button', { name: '开始上课' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  return true;
}

/**
 * 白板课的互动按钮收在顶栏「课堂工具」里，面板默认隐藏。
 * 已经展开时不再点，避免把面板又收起来。
 */
export async function openClassroomTools(page: Page): Promise<void> {
  const toggle = page.getByTestId('teacher-whiteboard-tools');
  await toggle.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'true') return;
  await toggle.click();
  await page.getByTestId('teacher-whiteboard-tools-panel').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Issue #91：进入互动课堂后落到「授课视图」。
 *
 * 新首屏是进行中会话列表：有进行中会话 → 点「继续上课」；有活跃课堂锁定 → 点「回到课堂」；
 * 都没有 → 走起始门户，此处不再处理（调用方自行点「开始上课」）。
 *
 * 白板课的 `#classroom-interactive-cockpit` 默认带 `hidden`，不能再用它判断「已经在课中」。
 * 顶栏「课堂工具」按钮在授课视图里一直可见。
 */
export async function enterTeachingView(page: Page): Promise<void> {
  const tools = page.getByTestId('teacher-whiteboard-tools');
  const setupDialog = page.getByRole('dialog', { name: '开课前功能设置' });

  // 刷新后课堂常常已经恢复，并先盖上开课设置。这时再点导航会被对话框挡住。
  await setupDialog.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => undefined);
  if (await setupDialog.isVisible().catch(() => false)) {
    await dismissClassroomToolbarSetup(page, 1_000);
  }
  if (await tools.isVisible().catch(() => false)) {
    await dismissClassroomToolbarSetup(page, 1_000);
    return;
  }

  const nav = page.locator('button:has-text("互动课堂")').first();
  try {
    await nav.click({ timeout: 5_000 });
  } catch {
    await dismissClassroomToolbarSetup(page, 2_000);
    if (!(await tools.isVisible().catch(() => false))) {
      await nav.click();
    }
  }

  if (!(await tools.isVisible().catch(() => false))) {
    // 1) Issue #91 首屏：进行中会话列表（需要等列表拉回来，不能立刻判断可见性）
    await clickIfVisible(page.getByRole('button', { name: /继续上课|Resume/ }).first(), 10_000);

    // 2) 旧路径：进行中会话被锁定时门户里的「回到课堂」
    await clickIfVisible(page.getByRole('button', { name: '回到课堂' }).first(), 3_000);
    await tools.waitFor({ state: 'visible', timeout: 15_000 });
  }
  await dismissClassroomToolbarSetup(page);
}

/**
 * Issue #91：进入互动课堂后落到「起始门户」（选课 → 选班 → 开始上课）。
 *
 * 新首屏是「进行中的课堂会话」列表。而 e2e 全部 spec 串行跑在**同一个 dev 库**上，
 * 前一个用例残留的未归档会话（例如 a11y-gate 的 A11Y2 课节）会让列表非空，
 * 于是列表首屏就取代了起始门户 —— 期望「选择授课课程」的用例必然找不到。
 *
 * 这里显式点「开始一节新课」把列表交回起始门户（该按钮的既定语义就是
 * 「回到门户开新课，不影响其它进行中的会话」），让门户路径的用例可稳定执行。
 */
export async function enterEntryPortal(page: Page): Promise<void> {
  const portalCourseDeck = page.getByText('选择授课课程');
  if (await portalCourseDeck.isVisible().catch(() => false)) return;

  await clickIfVisible(page.getByRole('button', { name: /开始一节新课|Start a new lesson/ }).first(), 10_000);
  await portalCourseDeck.waitFor({ state: 'visible', timeout: 15_000 });
}
