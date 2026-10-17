/**
 * 无障碍门禁（axe-core，WCAG 2.0/2.1 A + AA）
 *
 * 覆盖登录页与教师端主要工作区，断言**零违规**。与 `live-class-contrast.spec.ts`
 * （只查 color-contrast、逐主题）互补：这里跑完整规则集，能挡住 button-name /
 * select-name / 结构性 ARIA 等回归。
 *
 * 两条实现约定（与 contrast spec 相同，都是踩过的坑）：
 * 1. 每个页面只跑一次 axe —— 同一 document 上重复 analyze 会把元素 computed
 *    color 留在错误状态，导致下一次检查报出并不存在的违规。
 * 2. 审计前冻结动画 —— axe 按元素不透明度混合前景/背景，动效中途采样会产生假阳性。
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const TABS = [
  { name: '课程管理', hash: '#/courses' },
  { name: '班级管理', hash: '#/classes' },
  { name: '课表管理', hash: '#/timetable' },
  { name: '互动课堂', hash: '#/live_class' },
  { name: '插件中心', hash: '#/plugins' },
  { name: '管理后台', hash: '#/admin' },
  { name: '帮助文档', hash: '#/help' },
  { name: '工作台', hash: '#/dashboard' },
];

async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function expectNoViolations(page: Page, surface: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const offenders = results.violations.flatMap((v) =>
    v.nodes.slice(0, 5).map((n) => {
      const html = (n.html || '').replace(/\s+/g, ' ').slice(0, 160);
      return `[${v.id}/${v.impact}] ${n.target.join(' ')} :: ${html}`;
    }),
  );
  expect(offenders, `${surface} 存在 WCAG A/AA 违规：\n${offenders.join('\n')}`).toEqual([]);
}

test.describe('无障碍门禁（WCAG 2.0/2.1 A+AA）', () => {
  test('登录页无违规', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(1500);
    await freezeAnimations(page);
    await expectNoViolations(page, '登录页');
    await ctx.close();
  });

  test('教师端主要工作区无违规', async ({ page, context }) => {
    test.setTimeout(300_000);
    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto('/');
    // 侧边栏只在已登录的教师壳里渲染 —— 用它而不是文本长度判断「壳已就绪」。
    await page.waitForSelector('#nav_btn_courses', { timeout: 30_000 });

    for (const tab of TABS) {
      await page.goto(`/${tab.hash}`);
      // 侧边栏 + 主体渲染完成（页面数据依赖若干接口，给足时间）
      await page.waitForTimeout(2500);
      await freezeAnimations(page);
      await expectNoViolations(page, tab.name);
    }
  });
});
