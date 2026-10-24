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
 * Issue #91：进入互动课堂后落到「授课视图」。
 *
 * 新首屏是进行中会话列表：有进行中会话 → 点「继续上课」；有活跃课堂锁定 → 点「回到课堂」；
 * 都没有 → 走起始门户，此处不再处理（调用方自行点「开始上课」）。
 */
export async function enterTeachingView(page: Page, cockpitSelector = '#classroom-interactive-cockpit'): Promise<void> {
  const cockpit = page.locator(cockpitSelector);
  if (await cockpit.isVisible().catch(() => false)) return;

  await page.locator('button:has-text("互动课堂")').first().click();

  // 1) Issue #91 首屏：进行中会话列表（需要等列表拉回来，不能立刻判断可见性）
  await clickIfVisible(page.getByRole('button', { name: /继续上课|Resume/ }).first(), 10_000);

  // 2) 旧路径：进行中会话被锁定时门户里的「回到课堂」
  await clickIfVisible(page.getByRole('button', { name: '回到课堂' }).first(), 3_000);
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
