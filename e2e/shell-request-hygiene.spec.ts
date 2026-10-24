/**
 * 归属：外壳 / 请求卫生 —— 外壳加载期间无 console 错误与 4xx/5xx
 *
 * Issue #230：CI 改为跑 e2e/ 下**全部**用例（pnpm test:e2e），
 * 本注释用于标明该用例覆盖的能力域 —— 新增用例时按同一口径挂靠。
 */
import { expect, test, type BrowserContext } from '@playwright/test';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'node:path';

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
 *
 * ## 测试账号
 *
 * 自建测试教工/学生（**不依赖 admin/admin** —— 开发库里的 admin 口令是随机种子值，
 * 本机未必是 admin）。命名遵循仓库约定（`e2e_%` 教工 / `E2E %` 班级 /
 * `STU_%-%` 学生），因此 `scripts/cleanup-test-data.mjs` 会在套件前后自动清理。
 */

const DB_PATH = path.resolve(process.cwd(), 'packages/core/db/educational_os.db');

const TEACHER_USERNAME = 'e2e_shell_hygiene';
const TEACHER_PASSWORD = 'E2eHygiene@Teacher1';
const TEACHER_ID = 'usr_e2e_shell_hygiene';

const STUDENT_NUMBER = `STU_HYG-${Date.now().toString().slice(-6)}`;
const STUDENT_PASSWORD = 'E2eHygiene@Student1';
const STUDENT_ID = `stu-hyg-${Date.now().toString().slice(-6)}`;

const CLASS_ID = 'e2e-class-shell-hygiene';
const LESSON_ID = 'e2e-lesson-shell-hygiene';
const SCHEDULE_ID = 'e2e-schedule-shell-hygiene';

/** 收集页面上的 console 错误与失败请求。 */
function watchNoise(page: import('@playwright/test').Page) {
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

/** 登录并把会话 Cookie 注入浏览器上下文。 */
async function loginInContext(context: BrowserContext, payload: Record<string, string>) {
  const res = await context.request.post('/api/auth/login', { data: payload });
  expect(res.ok(), `登录应成功：${JSON.stringify(payload)}`).toBeTruthy();
}

test.describe('外壳请求卫生：加载教师/学生外壳不产生错误请求', () => {
  test.beforeAll(() => {
    const db = new Database(DB_PATH);
    const now = Date.now();
    try {
      db.prepare(
        `INSERT OR REPLACE INTO users (id, username, password_hash, role, name, created_at, must_change_password)
         VALUES (?, ?, ?, 'teacher', ?, ?, 0)`,
      ).run(TEACHER_ID, TEACHER_USERNAME, bcrypt.hashSync(TEACHER_PASSWORD, 10), '外壳卫生教师', now);

      db.prepare(
        `INSERT OR REPLACE INTO classes (id, name, description, class_passcode, owner_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(CLASS_ID, 'E2E 外壳卫生班', '外壳请求卫生回归用例', 'e2ehyg', TEACHER_ID, now);

      // 教师自己的课节（排在课程列表最前 → 教师端默认选中的就是它）
      db.prepare(
        `INSERT OR REPLACE INTO lessons (id, title, content, timeline, progress_mode, created_at, updated_at, creator_id)
         VALUES (?, ?, ?, NULL, 'manual', ?, ?, ?)`,
      ).run(
        LESSON_ID,
        'E2E 外壳卫生课',
        JSON.stringify({ description: '外壳请求卫生回归用例', objectives: [], elements: [] }),
        now,
        now,
        TEACHER_ID,
      );

      // 该课节排在本班课表上 → 学生端能看到这门课
      db.prepare(
        `INSERT OR REPLACE INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      ).run(
        SCHEDULE_ID,
        CLASS_ID,
        LESSON_ID,
        new Date(now + 24 * 3600 * 1000).toISOString().slice(0, 10) + ' 09:00:00',
        '第1节',
        '外壳请求卫生回归用例',
        now,
      );

      db.prepare(
        `INSERT OR REPLACE INTO students (id, student_number, name, email, password, created_at)
         VALUES (?, ?, ?, '', ?, ?)`,
      ).run(STUDENT_ID, STUDENT_NUMBER, '外壳卫生学生', bcrypt.hashSync(STUDENT_PASSWORD, 10), now);

      db.prepare('INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
        CLASS_ID,
        STUDENT_ID,
        now,
      );
    } finally {
      db.close();
    }
  });

  test.afterAll(() => {
    const db = new Database(DB_PATH);
    try {
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(CLASS_ID);
      db.prepare('DELETE FROM schedules WHERE id = ?').run(SCHEDULE_ID);
      db.prepare('DELETE FROM classes WHERE id = ?').run(CLASS_ID);
      db.prepare('DELETE FROM lessons WHERE id = ?').run(LESSON_ID);
      db.prepare('DELETE FROM students WHERE id = ?').run(STUDENT_ID);
      db.prepare('DELETE FROM users WHERE id = ?').run(TEACHER_ID);
    } finally {
      db.close();
    }
  });

  test('教师外壳：无 console 错误、无 4xx/5xx', async ({ page, context }) => {
    await loginInContext(context, {
      entrance: 'teacher',
      username: TEACHER_USERNAME,
      password: TEACHER_PASSWORD,
    });

    const noise = watchNoise(page);
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    await page.goto('/');
    await expect(page.locator('#navigation_sidebar')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000);

    expect(
      noise.badResponses,
      `教师外壳出现失败请求：\n${noise.badResponses.map((r) => `${r.status} ${r.url}`).join('\n')}`,
    ).toEqual([]);
    expect(noise.consoleErrors, `教师外壳出现 console 错误：\n${noise.consoleErrors.join('\n')}`).toEqual([]);
  });

  test('学生外壳：无 console 错误、无 4xx/5xx，且能取到自己的记录', async ({ page, context }) => {
    await loginInContext(context, {
      entrance: 'student',
      studentId: STUDENT_NUMBER,
      password: STUDENT_PASSWORD,
    });

    const noise = watchNoise(page);
    await page.addInitScript(() => {
      localStorage.setItem('edu_os_tour_completed', 'true');
    });

    await page.goto('/');
    await page.waitForTimeout(4000);

    expect(
      noise.badResponses,
      `学生外壳出现失败请求：\n${noise.badResponses.map((r) => `${r.status} ${r.url}`).join('\n')}`,
    ).toEqual([]);
    expect(noise.consoleErrors, `学生外壳出现 console 错误：\n${noise.consoleErrors.join('\n')}`).toEqual([]);

    // 学生必须能取到「自己这一条」（含锁定字段），否则教师端的锁在学生端失效。
    const roster = await context.request.get('/api/students?pageSize=all');
    expect(roster.ok(), '学生取花名册应返回 200').toBeTruthy();
    const body = (await roster.json()) as { data: any[]; total: number };
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe(STUDENT_ID);
    expect(body.data[0]).toHaveProperty('locked_lesson_id');
    expect(body.data[0].private_notes).toBeUndefined();
  });
});
