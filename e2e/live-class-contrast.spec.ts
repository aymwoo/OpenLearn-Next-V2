/**
 * Issue #77 — live_class 课中授课页面「文字对比度（WCAG AA）」回归。
 *
 * 用 axe-core 的 `color-contrast` 规则检查**真实浏览器渲染后**的文字对比度：
 * 单元测试只能保证设计令牌合规，组件里写死的 Tailwind 色阶（如 `bg-amber-500
 * text-white` 只有 2.15:1）只有真正渲染出来才能发现。
 *
 * ## 两条必须遵守的约定（都是踩过的坑）
 *
 * 1. **每个页面只跑一次 axe**：axe 在同一个 document 上重复 analyze 后会把元素的
 *    computed `color` 留在错误状态（实测第二次之后读到 `rgb(243,244,246)`，
 *    而 `--text-main` 仍正确），下一次检查就会报出并不存在的违规。
 *    因此每个「主题 × 检查面」都用一次**全新加载**，并且主题通过 localStorage
 *    在加载前写入 —— 这也更贴近用户切主题后重新进入课堂的真实路径。
 *
 * 2. **审计前冻结动画**：axe 会按元素不透明度把前景色与背景混合，
 *    `animate-pulse` / `animate-slide-up` 在采样瞬间可能只有几成不透明度，
 *    于是算出「几乎白字」的假阳性。
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

/** 四套内置主题（与 src/index.css / themeStore 一致） */
const THEMES = ['light', 'dark', 'eyecare', 'chalkboard'] as const;
type Theme = (typeof THEMES)[number];

const COCKPIT = '#classroom-interactive-cockpit';
const POLL_DIALOG = '[data-testid="classroom-quick-poll-dialog"]';
const STUDENT_POLL_CARD = '[data-testid="student-quick-poll-card"]';

const TEACHER_LESSON_PREFIX = 'E2E 对比度课节';
const STUDENT_LESSON_PREFIX = 'E2E 对比度学生课节';
const CLASS_PREFIX = 'E2E 对比度班级';

function purgeContrastE2EFromDb() {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH);
  try {
    const lessons = db
      .prepare('SELECT id FROM lessons WHERE title LIKE ? OR title LIKE ?')
      .all(`${TEACHER_LESSON_PREFIX}%`, `${STUDENT_LESSON_PREFIX}%`) as { id: string }[];
    for (const l of lessons) {
      db.prepare('DELETE FROM classroom_sessions WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_quick_polls WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_buzzers WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM classroom_feed WHERE lesson_id = ?').run(l.id);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
    }

    const classes = db.prepare('SELECT id FROM classes WHERE name LIKE ?').all(`${CLASS_PREFIX}%`) as {
      id: string;
    }[];
    for (const c of classes) {
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
    }

    const students = db.prepare('SELECT id FROM students WHERE student_number LIKE ?').all('STU_CONTRAST_%') as {
      id: string;
    }[];
    for (const s of students) {
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(s.id);
      db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
    }
  } finally {
    db.close();
  }
}

/** 写入主题偏好并重新加载（等价于用户切主题后重新进入课堂） */
async function reloadWithTheme(page: Page, theme: Theme) {
  await page.evaluate((t) => localStorage.setItem('openlearn_theme', t), theme);
  await page.reload();
}

/**
 * 冻结动画 / 过渡：axe 的 color-contrast 会按元素不透明度混合前景与背景，
 * 动效途中的中间态会算出「几乎白字」的假阳性。
 */
async function freezeAnimations(page: Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** 进入课中授课界面（已在新标签页时直接复用） */
async function openTeacherClassroom(page: Page) {
  const cockpit = page.locator(COCKPIT);
  if (await cockpit.isVisible().catch(() => false)) return;
  await page.locator('button:has-text("互动课堂")').first().click();
  const resumeBtn = page.getByRole('button', { name: '回到课堂' });
  if (await resumeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await resumeBtn.click();
  }
  await expect(cockpit).toBeVisible({ timeout: 20_000 });
}

/** 对指定子树跑一次 axe color-contrast，返回可读失败清单 */
async function contrastViolations(page: Page, selector: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).include(selector).analyze();
  return results.violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')} :: ${n.failureSummary ?? 'contrast failure'}`),
  );
}

async function expectNoContrastViolations(page: Page, selector: string, label: string) {
  const offenders = await contrastViolations(page, selector);
  expect(offenders, `${label} 文字对比度未达 WCAG AA：\n${offenders.join('\n')}`).toEqual([]);
}

test.describe('live_class 课中页面文字对比度（Issue #77）', () => {
  test.beforeAll(() => {
    purgeContrastE2EFromDb();
  });

  test.afterAll(() => {
    purgeContrastE2EFromDb();
  });

  test('极速投票（中控投票中状态 + 配置弹窗）在四套主题下无对比度违规', async ({ page, request, context }) => {
    test.setTimeout(300_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `${TEACHER_LESSON_PREFIX} ${suffix}`;
    const className = `${CLASS_PREFIX} ${suffix}`;
    const studentNum = `STU_CONTRAST_${suffix}`;

    // 0. 教师 API 认证
    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });

    // 1. 课节 / 班级 / 学生
    const lessonRes = await request.post('/api/lessons', {
      data: { title: lessonTitle, subject: '物理', grade: '高一', content: '对比度回归' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    const classRes = await request.post('/api/classes', { data: { name: className, grade: '高一' } });
    expect(classRes.ok()).toBeTruthy();
    const classId: string = (await classRes.json()).id;

    const stuRes = await request.post('/api/students', {
      data: { student_number: studentNum, name: `对比度测试生_${suffix.slice(0, 4)}`, gender: 'M' },
    });
    expect(stuRes.ok()).toBeTruthy();
    const studentId: string = (await stuRes.json()).id;
    await request.post(`/api/classes/${encodeURIComponent(classId)}/students`, { data: { studentId } });

    // 2. 会话进入课中
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/init`, {
      data: { classId, teachingModeId: 'lecture' },
    });
    await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/stage`, {
      data: { stage: 'IN_CLASS_TEACHING', classId },
    });

    // 3. 发起投票 → 中控进入「投票进行中」状态
    const pollRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll`, {
      data: {
        title: `对比度回归投票 ${suffix}`,
        questionType: 'ABCD',
        options: ['完全掌握', '基本掌握', '还有疑惑', '需要再讲'],
      },
    });
    expect(pollRes.ok()).toBeTruthy();
    const pollId: string = (await pollRes.json()).poll?.id;

    // 4. 浏览器登录（一次；后续用 reload 切主题）
    await context.request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto('/');
    await openTeacherClassroom(page);

    // 5. 投票进行中：每个主题一次全新加载，各跑一次 axe
    for (const theme of THEMES) {
      await reloadWithTheme(page, theme);
      await openTeacherClassroom(page);
      await expect(page.locator(`${COCKPIT} button:has-text("结束投票")`)).toBeVisible({ timeout: 20_000 });
      await freezeAnimations(page);
      await expectNoContrastViolations(page, COCKPIT, `中控（投票进行中 / ${theme}）`);
    }

    // 6. 结束投票 → 配置弹窗同样逐主题（各一次全新加载）
    if (pollId) {
      await request.post(
        `/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll/${encodeURIComponent(pollId)}/close`,
      );
    }
    for (const theme of THEMES) {
      await reloadWithTheme(page, theme);
      await openTeacherClassroom(page);
      await page.locator(`${COCKPIT} button:has-text("极速投票")`).first().click();
      await expect(page.locator(POLL_DIALOG)).toBeVisible({ timeout: 10_000 });
      await freezeAnimations(page);
      await expectNoContrastViolations(page, POLL_DIALOG, `极速投票配置弹窗（${theme}）`);
    }
  });

  test('学生端极速投票作答卡在四套主题下无对比度违规', async ({ page, request, context }) => {
    test.setTimeout(240_000);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const lessonTitle = `${STUDENT_LESSON_PREFIX} ${suffix}`;
    const studentNum = `STU_CONTRAST_${suffix}`;

    await request.post('/api/auth/login', {
      data: { entrance: 'teacher', username: 'admin', password: 'admin' },
    });

    const lessonRes = await request.post('/api/lessons', {
      data: { title: lessonTitle, content: '对比度回归（学生端）' },
    });
    expect(lessonRes.ok()).toBeTruthy();
    const lessonJson = await lessonRes.json();
    const lessonId: string = lessonJson.result?.lessonId || lessonJson.lessonId || lessonJson.id;

    await request.post('/api/students', {
      data: { name: `对比度学生_${suffix}`, student_number: studentNum, password: 'password123' },
    });

    const pollRes = await request.post(`/api/classroom/sessions/${encodeURIComponent(lessonId)}/quick-poll`, {
      data: {
        title: `对比度回归学生投票 ${suffix}`,
        questionType: 'ABCD',
        options: ['完全掌握', '基本掌握', '还有疑惑', '需要再讲'],
      },
    });
    expect(pollRes.ok()).toBeTruthy();

    await context.request.post('/api/auth/login', {
      data: { entrance: 'student', studentId: studentNum, password: 'password123' },
    });
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });
    await page.goto(`/?mode=student_live&lessonId=${lessonId}`);
    await expect(page.locator(STUDENT_POLL_CARD)).toBeVisible({ timeout: 25_000 });

    for (const theme of THEMES) {
      await reloadWithTheme(page, theme);
      await expect(page.locator(STUDENT_POLL_CARD)).toBeVisible({ timeout: 25_000 });
      await freezeAnimations(page);
      await expectNoContrastViolations(page, STUDENT_POLL_CARD, `学生端极速投票作答卡（${theme}）`);
    }
  });
});
