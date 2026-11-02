#!/usr/bin/env node
/**
 * 生成《快速上手手册》里的截图（issue #384）。
 *
 * ## 为什么要有这个脚本
 *
 * 手册里的截图是**可复现产物**，不是一次性的手工截图：界面改版后重跑本脚本即可，
 * 不需要人工重拍、也不需要去猜当时点的是哪个按钮。脚本同时对关键文案做断言 ——
 * 页面结构一变就直接失败，避免截图悄悄过期后手册指向不存在的按钮。
 *
 * ## 前置条件
 *
 * 1. Node 22（仓库 `.nvmrc`；Node 26 下原生模块 ABI 不匹配）
 * 2. 一个**干净的演示实例**：`pnpm dev:demo`。脚本假定演示库没有进行中的课堂会话，
 *    若检测到「继续上课」会直接退出并提示重置演示库（`pnpm dev:demo -- --reset`）。
 * 3. Playwright 的 Chromium：系统装了 `/usr/bin/chromium` 也可（`--chromium` 指定）。
 *
 * ## 用法
 *
 *   node scripts/capture-quickstart-screenshots.mjs
 *   node scripts/capture-quickstart-screenshots.mjs --base-url http://127.0.0.1:9208 \
 *     --out docs/getting-started/images/quickstart
 *
 * 产物（默认写入 `docs/getting-started/images/quickstart/`）：
 *
 *   01-login.png       登录页（含首次安装的默认口令提示）
 *   02-portal.png      教师主界面：互动课堂 · 授课控制台（选课 / 选班 / 开始上课）
 *   03-classroom.png   课中授课：白板、课堂互动工具与教学环节
 *   04-briefing.png    「学情简报」全景概要弹窗（完成归档即下课）
 *
 * 插件相关截图（05/06）需要先构建并安装一个 Hello 插件，由手册的插件章节单独说明，
 * 不在本脚本内自动执行，避免截图脚本顺手改数据库状态。
 *
 * @module
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// ── 参数 ────────────────────────────────────────────────────────────────────
function argOf(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const BASE_URL = argOf('base-url', 'http://127.0.0.1:9000').replace(/\/$/, '');
const OUT_DIR = path.resolve(argOf('out', 'docs/getting-started/images/quickstart'));
const CHROMIUM = argOf('chromium', '/usr/bin/chromium');
const TEACHER_USER = argOf('teacher-user', 'demo_teacher');
const TEACHER_PASS = argOf('teacher-pass', 'Demo@2026');
const VIEWPORT = { width: 1440, height: 900 };
const CLASS_NAME = '一年级(1)班';

/** 截图前统一去掉页面滚动条带来的抖动，并保证中文字体渲染。 */
const CONTEXT_OPTIONS = {
  viewport: VIEWPORT,
  locale: 'zh-CN',
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
};

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/**
 * 关闭右下角 toast 通知。
 *
 * 服务端会广播「课堂阶段已切换」「锁状态更新」这类提示，默认停留数秒以上；
 * 直接截图会把它们叠在内容区上。截图前统一清掉，保证每张图只讲一件事。
 */
async function dismissToasts(page) {
  const closeButtons = page.getByRole('button', { name: '关闭提示' });
  for (let round = 0; round < 8; round++) {
    const count = await closeButtons.count();
    if (count === 0) break;
    await closeButtons
      .nth(0)
      .click({ timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function shot(page, name) {
  await dismissToasts(page);
  await page.waitForTimeout(250);
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`✔ ${path.relative(process.cwd(), file)}`);
}

/** 等一个可见元素出现；超时直接给出可读错误。 */
async function waitFor(locator, label, timeout = 30_000) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
  } catch {
    fail(`等待「${label}」超时 —— 界面可能已改版，请更新本脚本与手册。`);
  }
}

mkdirSync(OUT_DIR, { recursive: true });

// 优先用显式指定的系统 Chromium（服务器上常有）；没有就回退到 Playwright 自带的浏览器。
const launchOptions = {
  args: ['--no-sandbox'],
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
};
if (!existsSync(CHROMIUM)) {
  console.warn(`ℹ 未找到 ${CHROMIUM}，改用 Playwright 自带 Chromium（需先 npx playwright install chromium）`);
}
const browser = await chromium.launch(launchOptions);
try {
  const context = await browser.newContext(CONTEXT_OPTIONS);
  const page = await context.newPage();

  // ── 1. 登录页 ────────────────────────────────────────────────────────────
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const loginInputs = page.locator('input');
  await waitFor(loginInputs.first(), '登录表单');
  await page.waitForTimeout(600); // 等字体与首次引导提示稳定
  await shot(page, '01-login.png');

  // ── 2. 登录（演示教师）─────────────────────────────────────────────────
  await loginInputs.nth(0).fill(TEACHER_USER);
  await loginInputs.nth(1).fill(TEACHER_PASS);
  await page
    .getByRole('button', { name: /安全验证登录/ })
    .first()
    .click();

  const resumeBtn = page.getByRole('button', { name: /继续上课/ });
  const classChip = page.getByRole('button').filter({ hasText: CLASS_NAME }).first();
  const startBtn = page.getByRole('button', { name: /开始上课/ });

  // 演示库必须没有进行中的课堂：否则门户会先弹「进行中的课堂会话」列表。
  await page.waitForTimeout(3000);
  if (
    await resumeBtn
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    fail('演示库里已有进行中的课堂会话。请先重置演示库：`pnpm dev:demo -- --reset`，再重新运行本脚本。');
  }
  await waitFor(classChip, '授课班级选择');

  // ── 3. 授课控制台（主界面）──────────────────────────────────────────────
  if ((await classChip.getAttribute('aria-pressed')) !== 'true') {
    await classChip.click();
    await page.waitForTimeout(800);
  }
  if (!(await startBtn.isEnabled())) fail('「开始上课」仍处于禁用状态：课程/班级未就绪。');
  await page.waitForTimeout(600);
  await shot(page, '02-portal.png');

  // ── 4. 课中授课（白板）───────────────────────────────────────────────────
  await startBtn.click();
  const enterBoard = page.getByRole('button', { name: /一键开启课中授课/ });
  await waitFor(enterBoard, '「一键开启课中授课」按钮');
  await enterBoard.click();
  await waitFor(page.getByRole('button', { name: /完成授课，进入课后/ }), '白板阶段的「完成授课」按钮');
  await page.waitForTimeout(1200); // 白板初始化 + 学生在线状态刷新
  await shot(page, '03-classroom.png');

  // ── 5. 学情简报 / 归档（下课）────────────────────────────────────────────
  await page.getByRole('button', { name: /完成授课，进入课后/ }).click();
  await page.waitForTimeout(2500);
  await page.getByText('学情简报', { exact: true }).last().click();

  const briefingDialog = page.getByText('全景课堂学情简报').first();
  await waitFor(briefingDialog, '「全景课堂学情简报」弹窗');
  await page.waitForTimeout(5000); // 等「课堂阶段已切换」toast 自动消失，避免遮住截图
  await shot(page, '04-briefing.png');

  // ── 6. 清理：完成归档，让演示库回到「无进行中课堂」状态 ────────────────
  const archiveBtn = page.getByRole('button', { name: /完成归档/ });
  await waitFor(archiveBtn, '「完成归档」按钮');
  await archiveBtn.click();
  await page.waitForTimeout(2500);
  if (
    await page
      .getByRole('button', { name: /继续上课/ })
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    fail('归档后仍存在进行中的课堂会话，脚本留下脏状态。');
  }
  console.log('✔ 已归档本次演示课堂，演示库回到干净状态');
} finally {
  await browser.close();
}
