import type { APIRequestContext } from '@playwright/test';

/**
 * `@playwright/test` 只导出 `request` 常量、不导出 `APIRequestFactory` 这个类型名，
 * 所以这里用结构类型描述「能新建 API 上下文的那部分」——
 * 直接用 `import { request } from '@playwright/test'` 传进来即可。
 */
export type ApiRequestFactoryLike = Pick<typeof import('@playwright/test').request, 'newContext'>;

/**
 * 「教师端操作 → 学生端实时可见」e2e 的数据夹具。
 *
 * ## 为什么需要它
 *
 * 这一整轮排查出的 bug 有一个共同特征：**只在跨端时才能复现**。
 *   - `ClassroomSyncChannel` 在构造时抓 socket → 同机多标签页走 BroadcastChannel，
 *     恰好把 socket 失效掩盖了；
 *   - `io.to('lesson-<id>')` 幽灵房间 → 单 context 时投递对象恰好在房间里；
 *   - `frontendEventBus` 的 socket 桥从未接线 → 本地「看起来一切正常」。
 *
 * 而修复前的全部验证都是 mock —— **假 socket 证明不了跨机投递真的通**。
 * 本夹具 + `realtime-sync.spec.ts` 就是补上这个验证缺口。
 *
 * ## 设计取舍：教师侧走 API，学生侧走浏览器
 *
 * 教师动作全部用 `request`（HTTP）驱动，而不是点教师 UI：
 *   - 确定性：不受教师端 UI 改版影响，也不会因为点错按钮而假失败；
 *   - **关键**：教师动作不来自浏览器 ⇒ **不存在 BroadcastChannel 对端**，
 *     学生只能靠真实的 socket 收到事件 —— 这正是被修坏的那条通路。
 *
 * 代价：本 spec 验证的是**传输链路**（服务端广播 → socket → 学生端渲染），
 * 不验证教师按钮本身的点击行为（那部分由单元测试覆盖）。
 *
 * ## 命名必须匹配 `scripts/cleanup-test-data.mjs` 的清理模式
 *
 * 该脚本在 global-setup 与 global-teardown 各跑一次，**测试数据的清除完全依赖它**：
 *   - 课节 / 班级标题须以 `E2E ` 开头（模式 `'E2E %'`）
 *   - 学生学号须形如 `STU_xxx-<时间戳>`（模式 `STU_%-%`）
 *     —— 注意 SQL `LIKE` 里 `_` 是**单字符通配符**，所以这里必须真的带一个 `-`
 *
 * 历史教训：清理脚本曾用 `name LIKE '测试学生_%'` 误删正式学生
 * （`测试学生A`~`测试学生E`，学号 `TEST001`~`TEST005`），因为 `_` 是通配符。
 * 因此**只按 student_number 精确匹配，绝不按 name 匹配**。
 */

export const TEACHER_CREDENTIALS = { entrance: 'teacher', username: 'admin', password: 'admin' } as const;

export interface RealtimeFixture {
  classId: string;
  className: string;
  lessonId: string;
  lessonTitle: string;
  studentId: string;
  studentNumber: string;
  studentPassword: string;
  studentName: string;
}

export const E2E_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:9000';

/**
 * 创建一个**独立**的教师 API 上下文（已登录）。
 *
 * 两个刻意选择：
 *
 * 1. **不用 `request` fixture**：Playwright 规定 `beforeAll` 里用过的 `request`
 *    不能在 test 里复用（会抛 "Fixture { request } from beforeAll cannot be reused"）。
 *    自建 context 彻底绕开这个约束。
 * 2. **全文件只登录一次**：`POST /api/auth/login` 有限流 **5 次/IP/分钟**
 *    （`server.ts` 的 `loginLimiter`）。每用例登录一次必然撞限流，
 *    而且撞出来的 429 会被误读成「同步失败」。
 */
export async function createTeacherApi(apiRequestFactory: ApiRequestFactoryLike): Promise<APIRequestContext> {
  const ctx = await apiRequestFactory.newContext({ baseURL: E2E_BASE_URL });
  const res = await ctx.post('/api/auth/login', { data: { ...TEACHER_CREDENTIALS } });
  if (!res.ok()) {
    await ctx.dispose();
    throw new Error(
      `教师登录失败: ${res.status()} ${await res.text()}\n` +
        `提示：登录接口限流 5 次/IP/分钟，若 CI 上与其它 spec 并跑请错开或复用本 helper。`,
    );
  }
  return ctx;
}

/**
 * 建全套 E2E 数据：班级 + 课节 + 学生 + 排课。
 *
 * 排课是必需的：学生端只有在课表里看到这节课、点击「进入课堂」之后，
 * `selectedLesson` 才会被设置，`StudentInteractiveOverlay` / 倒计时横幅才会挂载。
 */
export async function provisionRealtimeFixture(
  api: APIRequestContext,
  opts: { withSchedule?: boolean } = {},
): Promise<RealtimeFixture> {
  const { withSchedule = true } = opts;
  const ts = Date.now().toString(36).toUpperCase();
  const tag = `E2E 实时同步 ${ts}`;
  const studentPassword = 'E2eSync!2026';

  // 1) 班级
  const clsRes = await api.post('/api/classes', { data: { name: tag, description: '实时同步 e2e 夹具' } });
  if (!clsRes.ok()) throw new Error(`建班失败: ${clsRes.status()} ${await clsRes.text()}`);
  const { id: classId } = await clsRes.json();

  // 2) 课节
  const lessonRes = await api.post('/api/lessons', {
    data: { title: tag, content: '# 实时同步 e2e', progress_mode: 'manual' },
  });
  if (!lessonRes.ok()) throw new Error(`建课失败: ${lessonRes.status()} ${await lessonRes.text()}`);
  // `POST /api/lessons` 返回 { success, result }，真正的 id 在 result.lessonId
  const lessonJson = await lessonRes.json();
  const lessonId: string | undefined = lessonJson?.result?.lessonId ?? lessonJson?.lessonId ?? lessonJson?.id;
  if (!lessonId) throw new Error(`建课未返回 lessonId: ${JSON.stringify(lessonJson)}`);

  // 3) 学生 —— 学号必须匹配 STU_%-%，否则清理脚本抓不到，会永久污染数据库
  const stuRes = await api.post('/api/students', {
    data: {
      name: `E2E 学生 ${ts}`,
      // 学号含 `-`：SQL LIKE 的 `_` 是单字符通配符，清理脚本依赖 `STU_%-%` 这个形状
      student_number: `STU_SYNC-${ts}`,
      password: studentPassword,
    },
  });
  if (!stuRes.ok()) throw new Error(`建学生失败: ${stuRes.status()} ${await stuRes.text()}`);
  const stuJson = await stuRes.json();
  const studentId: string = stuJson.id;
  const studentNumber: string = stuJson.student_number;

  // 4) 学生入班
  const linkRes = await api.post(`/api/classes/${classId}/students`, { data: { studentId } });
  if (!linkRes.ok()) throw new Error(`学生入班失败: ${linkRes.status()} ${await linkRes.text()}`);

  // 5) 排课 —— 让学生端课表里出现这节课
  if (withSchedule) {
    const schRes = await api.post(`/api/classes/${classId}/schedules`, {
      data: {
        lessonId,
        scheduledDate: new Date().toISOString().slice(0, 10),
        timeSlot: 'e2e',
        status: 'scheduled',
      },
    });
    if (!schRes.ok()) throw new Error(`排课失败: ${schRes.status()} ${await schRes.text()}`);
  }

  return {
    classId,
    className: tag,
    lessonId,
    lessonTitle: tag,
    studentId,
    studentNumber,
    studentPassword,
    studentName: `E2E 学生 ${ts}`,
  };
}

/** 在课节白板上放置一个「随机点名」组件（教师侧等价于从组件库拖一个出来） */
export async function seedRollcallElement(
  api: APIRequestContext,
  lessonId: string,
  data: Record<string, unknown>,
): Promise<string> {
  const res = await api.post(`/api/lessons/${lessonId}/whiteboard`, {
    data: { type: 'rollcall', data: { classId: '', ...data } },
  });
  if (!res.ok()) throw new Error(`放置点名组件失败: ${res.status()} ${await res.text()}`);
  const json = await res.json();
  return json.elementId ?? json.id;
}

/** 更新白板图元（等价于教师在点名组件上点「开始随机点名」后的持久化结果） */
export async function updateElement(
  api: APIRequestContext,
  lessonId: string,
  elementId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const res = await api.put(`/api/lessons/${lessonId}/whiteboard/${elementId}`, { data: { data } });
  if (!res.ok()) throw new Error(`更新图元失败: ${res.status()} ${await res.text()}`);
}
