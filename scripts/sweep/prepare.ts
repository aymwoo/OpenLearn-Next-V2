/**
 * scripts/sweep/prepare.ts —— 巡检前置数据准备
 *
 * ## 为什么需要它
 *
 * 有些功能**没有前置数据就根本进不去**：
 *
 * - 学生端「查看待办作业」卡片里没有待办作业时，学生的作业视图无从进入；
 * - 学生端「进入实时课堂」卡片只在**有进行中的课堂会话**时才渲染；
 * - 教师端「互动课堂」在没有会话时只能看到起始门户，看不到真正的授课驾驶舱。
 *
 * 这些不是「功能坏了」，而是「没数据可测」。巡检工具因此在开跑前按需补齐
 * 前置数据 —— 全部落在**一次性演示库**里，跑完即弃，不影响任何真实数据。
 *
 * ## 幂等
 *
 * 每个准备动作都先查后建：已经有就跳过。因此 `--keep-db` 复用旧演示库时
 * 也不会重复堆积数据。
 *
 * @module
 */

import type { SweepLogin } from './types.js';

/** 演示数据的确定性 ID —— 与 `server/services/demo-data.ts` 的 `DEMO_IDS` 保持一致。 */
export const DEMO_IDS = {
  lesson: 'demo-lesson',
  primaryClass: 'demo-class',
} as const;

/** 巡检用作业的标题（用于幂等判断）。 */
const FIXTURE_ASSIGNMENT_TITLE = '巡检用作业';

export type FixtureKind = 'assignment' | 'classroomSession' | 'classroomInProgress' | 'crossTenantTeacher';

/** 作业列表接口的返回形状（只取用得到的字段）。 */
interface AssignmentSummary {
  title?: string;
}
interface AssignmentListResponse extends AssignmentSummary {
  assignments?: AssignmentSummary[];
  data?: AssignmentSummary[];
}

/** 课堂会话详情接口的返回形状。 */
interface SessionDetailResponse {
  session?: { id?: string; stage?: string | null };
}

/** 课前就绪阶段：会话已建立但尚未进入授课，学生端**不会被锁定**。 */
const STAGE_PRE_CLASS_READY = 'PRE_CLASS_READY';
/** 授课中阶段：教师端显示完整授课驾驶舱，学生端被锁定在课中视图。 */
const STAGE_IN_CLASS_TEACHING = 'IN_CLASS_TEACHING';

export interface FixtureResult {
  kind: FixtureKind;
  /** true = 这次真的建了；false = 已存在，跳过。 */
  created: boolean;
  detail: string;
  error?: string;
}

/** 用教师账号登录，返回带 Cookie 的请求头。 */
async function loginHeaders(baseUrl: string, credentials: SweepLogin): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      entrance: credentials.entrance,
      username: credentials.username,
      password: credentials.password,
    }),
  });
  if (!res.ok) {
    throw new Error(`准备数据时教师登录失败（HTTP ${res.status}）`);
  }
  const setCookie =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
  const match = /edu_os_token=([^;]+)/.exec(setCookie.join(';'));
  if (!match) throw new Error('准备数据时教师登录没有拿到会话 Cookie');
  return { cookie: `edu_os_token=${match[1]}` };
}

/**
 * 试登录：成功返回请求头，失败返回 null（不抛）。
 *
 * 用于幂等检查 —— 「账号是否已经存在」只能靠**能不能登录上**来判断，
 * 因为巡检没有直接访问数据库的口子。
 */
async function tryLoginHeaders(baseUrl: string, credentials: SweepLogin): Promise<Record<string, string> | null> {
  try {
    return await loginHeaders(baseUrl, credentials);
  } catch {
    return null;
  }
}

/**
 * 确保演示班级里有一份已发布的作业（学生端「待办作业」的来源）。
 */
async function ensureAssignment(baseUrl: string, headers: Record<string, string>): Promise<FixtureResult> {
  const kind: FixtureKind = 'assignment';

  try {
    const listRes = await fetch(`${baseUrl}/api/assignments?classId=${DEMO_IDS.primaryClass}`, { headers });
    if (listRes.ok) {
      const body = (await listRes.json()) as AssignmentListResponse;
      const items: AssignmentSummary[] = Array.isArray(body) ? body : (body.assignments ?? body.data ?? []);
      if (items.some((item) => item?.title === FIXTURE_ASSIGNMENT_TITLE)) {
        return { kind, created: false, detail: '巡检用作业已存在，跳过' };
      }
    }

    const res = await fetch(`${baseUrl}/api/assignments`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: FIXTURE_ASSIGNMENT_TITLE,
        description: '功能巡检自动创建的前置作业，仅存在于一次性演示库中。',
        classId: DEMO_IDS.primaryClass,
        lessonId: DEMO_IDS.lesson,
        dueDate: null,
        status: 'published',
        allowText: true,
        teacherWeight: 1,
        peerWeight: 0,
        questions: [
          {
            id: 'sweep-q1',
            type: 'single_choice',
            question: '巡检占位题：下列哪一项属于信息？',
            options: ['一张纸质地图', '一段程序代码', '一段旋律', '以上都是'],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { kind, created: false, detail: '创建失败', error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    return { kind, created: true, detail: '已创建已发布作业' };
  } catch (err) {
    return { kind, created: false, detail: '创建失败', error: (err as Error).message };
  }
}

/**
 * 确保演示课程有一节**已建立**的课堂会话，并把它推进到指定阶段。
 *
 * 阶段很关键：
 * - `PRE_CLASS_READY`：学生端不会被锁定，仪表盘可用，「进入实时课堂」入口存在；
 * - `IN_CLASS_TEACHING`：教师端显示完整授课驾驶舱，学生端被锁进课中视图。
 */
async function ensureClassroomSession(
  baseUrl: string,
  headers: Record<string, string>,
  targetStage: string,
): Promise<FixtureResult> {
  const kind: FixtureKind = targetStage === STAGE_IN_CLASS_TEACHING ? 'classroomInProgress' : 'classroomSession';

  try {
    const detailRes = await fetch(`${baseUrl}/api/classroom/sessions/${DEMO_IDS.lesson}`, { headers });
    let hasSession = false;
    if (detailRes.ok) {
      const body = (await detailRes.json()) as SessionDetailResponse;
      hasSession = !!body?.session?.id;
    }

    if (!hasSession) {
      const initRes = await fetch(`${baseUrl}/api/classroom/sessions/${DEMO_IDS.lesson}/init`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ classId: DEMO_IDS.primaryClass, teachingModeId: 'lecture' }),
      });
      if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        return {
          kind,
          created: false,
          detail: '课堂会话初始化失败',
          error: `HTTP ${initRes.status} ${text.slice(0, 200)}`,
        };
      }
    }

    const detailRes2 = await fetch(`${baseUrl}/api/classroom/sessions/${DEMO_IDS.lesson}`, { headers });
    let currentStage: string | null = null;
    if (detailRes2.ok) {
      const body2 = (await detailRes2.json()) as SessionDetailResponse;
      currentStage = body2?.session?.stage ?? null;
    }

    // 已经在目标阶段就不用再推进 —— 服务端会把「同阶段 → 同阶段」判为非法转换。
    if (currentStage !== targetStage) {
      const stageRes = await fetch(`${baseUrl}/api/classroom/sessions/${DEMO_IDS.lesson}/stage`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ stage: targetStage, classId: DEMO_IDS.primaryClass }),
      });
      if (!stageRes.ok) {
        const text = await stageRes.text().catch(() => '');
        return {
          kind,
          created: false,
          detail: `课堂阶段推进到 ${targetStage} 失败`,
          error: `HTTP ${stageRes.status} ${text.slice(0, 200)}`,
        };
      }
    }

    return {
      kind,
      created: !hasSession,
      detail: `课堂会话就绪（stage=${targetStage}）`,
    };
  } catch (err) {
    return { kind, created: false, detail: '创建失败', error: (err as Error).message };
  }
}

/**
 * 巡检用的**第二教师**账号。
 *
 * ## 为什么需要它
 *
 * 演示世界里原本只有一位教师（`demo_teacher`）与两个都归他所有的班级。
 * 于是「A 教师越权访问 B 教师的课节」这条链路**在结构上不可能触发** ——
 * 单教师世界里任何授权判定都必然放行，#211 补的对象级授权在巡检里是盲区。
 *
 * 这里用产品自己的 `user.create` 命令建一个真实的第二教师账号，
 * 让跨教师边界可以被真实地踩到（而不是靠 mock 断言）。
 */
export const CROSS_TENANT_TEACHER = {
  username: 'sweep_teacher_2',
  password: 'Sweep@2026',
  name: '巡检第二教师',
} as const;

/**
 * 确保演示环境里存在第二教师账号。
 *
 * 幂等：先试登录，登录得上就说明账号已存在（例如 `--keep-db` 复用旧库），
 * 直接跳过 —— 绝不重复创建（`user.create` 遇到重名会报错）。
 */
export async function ensureCrossTenantTeacher(baseUrl: string, adminCredentials: SweepLogin): Promise<FixtureResult> {
  const kind: FixtureKind = 'crossTenantTeacher';

  try {
    const existing = await tryLoginHeaders(baseUrl, {
      entrance: 'teacher',
      username: CROSS_TENANT_TEACHER.username,
      password: CROSS_TENANT_TEACHER.password,
    });
    if (existing) {
      return { kind, created: false, detail: '第二教师账号已存在，跳过' };
    }

    const adminHeaders = await loginHeaders(baseUrl, adminCredentials);
    const res = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        commandType: 'user.create',
        payload: {
          username: CROSS_TENANT_TEACHER.username,
          password: CROSS_TENANT_TEACHER.password,
          role: 'teacher',
          name: CROSS_TENANT_TEACHER.name,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        kind,
        created: false,
        detail: '创建第二教师失败',
        error: `HTTP ${res.status} ${text.slice(0, 200)}`,
      };
    }

    return { kind, created: true, detail: `已创建第二教师 ${CROSS_TENANT_TEACHER.username}` };
  } catch (err) {
    return { kind, created: false, detail: '创建第二教师失败', error: (err as Error).message };
  }
}

/**
 * 按需补齐前置数据。
 *
 * @param baseUrl 服务地址
 * @param teacherCredentials 用于准备数据的教师账号（拥有建作业/开课的权限）
 * @param kinds 需要准备哪几类前置数据
 */
export async function ensureFixtures(
  baseUrl: string,
  teacherCredentials: SweepLogin,
  kinds: FixtureKind[],
): Promise<FixtureResult[]> {
  if (kinds.length === 0) return [];

  const headers = await loginHeaders(baseUrl, teacherCredentials);
  const results: FixtureResult[] = [];

  for (const kind of kinds) {
    if (kind === 'assignment') {
      results.push(await ensureAssignment(baseUrl, headers));
    } else if (kind === 'classroomSession') {
      results.push(await ensureClassroomSession(baseUrl, headers, STAGE_PRE_CLASS_READY));
    } else if (kind === 'classroomInProgress') {
      results.push(await ensureClassroomSession(baseUrl, headers, STAGE_IN_CLASS_TEACHING));
    }
  }

  return results;
}
