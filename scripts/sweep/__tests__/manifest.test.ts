/**
 * 巡检剧本与世界线的结构约束（Issue #247）。
 *
 * ## 为什么这些要钉住
 *
 * 剧本是巡检里唯一能踩到**写链路**的东西（只读巡检只看「打开视图有没有报错」）。
 * #208 之后剧本只有一条 `assignment-loop`，于是近期三个安全/一致性修复面
 * ——课堂互动对象级授权（#211）、课件成绩唯一入口（#213/#215）、
 * 课程包导入（#204）—— **在巡检里全是盲区**。
 *
 * 这些断言的作用是：剧本被改坏（角色写错、关键步骤被删）时，**先在这里红**，
 * 而不是等到 CI 上跑完整场巡检才发现少覆盖了一个面。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SWEEP_ROLES, SWEEP_SCENARIOS } from '../manifest.js';
import { CROSS_TENANT_TEACHER, ensureCrossTenantTeacher } from '../prepare.js';
import { isStatusAsExpected } from '../scenario.js';
import type { SweepRoleId } from '../types.js';

const roleIds = new Set<string>(SWEEP_ROLES.map((r) => r.id));

function scenario(id: string) {
  const found = SWEEP_SCENARIOS.find((s) => s.id === id);
  expect(found, `剧本 ${id} 不存在`).toBeTruthy();
  return found!;
}

describe('巡检剧本 · 结构约束（Issue #247）', () => {
  it('每个剧本声明的角色都在角色清单里', () => {
    for (const s of SWEEP_SCENARIOS) {
      for (const role of s.roles) {
        expect(roleIds.has(role), `剧本 ${s.id} 引用了未定义的角色 ${role}`).toBe(true);
      }
      for (const step of s.steps) {
        expect(roleIds.has(step.role), `剧本 ${s.id} 的步骤「${step.label}」引用了未定义的角色 ${step.role}`).toBe(
          true,
        );
      }
    }
  });

  it('剧本里出现的角色都必须是对话角色（不存在拼错的 role id）', () => {
    const known: SweepRoleId[] = ['admin', 'teacher', 'teacher-2', 'student', 'student-live', 'teacher-live'];
    for (const s of SWEEP_SCENARIOS) {
      for (const role of s.roles) {
        expect(known).toContain(role);
      }
    }
  });

  it('课堂互动全链剧本存在，并覆盖投票 → 抢答 → 通票 → 倒计时', () => {
    const s = scenario('classroom-interaction-loop');
    const paths = s.steps.map((step) => step.api?.path ?? '').join('\n');
    expect(paths).toContain('/quick-poll');
    expect(paths).toContain('/vote');
    expect(paths).toContain('/buzzer');
    expect(paths).toContain('/countdown');
    expect(paths).toContain('/exit-ticket');
    // 互动由教师发起、学生参与 —— 两端都要在
    expect(s.roles).toContain('teacher');
    expect(s.roles).toContain('student');
  });

  it('课堂互动剧本自建课节，不复用演示课节 demo-lesson', () => {
    // 只读巡检刻意在「还没有课堂会话」时先跑管理员/学生轮次，
    // 用来覆盖「无会话时前端仍去 POST view-state 拿到 404」这类冷启动缺陷。
    // 剧本若给 demo-lesson 建会话，那层覆盖就没了。
    const s = scenario('classroom-interaction-loop');
    const usesDemoLesson = s.steps.some((step) => (step.api?.path ?? '').includes('/demo-lesson'));
    expect(usesDemoLesson).toBe(false);
    expect(s.steps.some((step) => step.api?.path === '/api/lessons')).toBe(true);
  });

  it('课件成绩剧本存在，并覆盖提交 → 自动录分 → 成绩查询', () => {
    const s = scenario('courseware-grade-loop');
    const paths = s.steps.map((step) => step.api?.path ?? '');
    expect(paths.some((p) => p.includes('/submit'))).toBe(true);
    expect(paths.some((p) => p.includes('/auto-record'))).toBe(true);
    expect(paths.some((p) => p.includes('/submissions'))).toBe(true);
  });

  it('课件成绩剧本先开启自动录分规则 —— 规则默认关闭，否则 recorded 恒为 0', () => {
    const s = scenario('courseware-grade-loop');
    const ruleIndex = s.steps.findIndex((step) => step.api?.path === '/api/commands');
    expect(ruleIndex).toBeGreaterThanOrEqual(0);
    const body = s.steps[ruleIndex]!.api!.body as Record<string, any>;
    expect(body.commandType).toBe('courseware.save_score_config');
    expect(body.payload.autoRecordEnabled).toBe(true);

    // 规则开启必须排在「触发自动录分」之前
    const autoIndex = s.steps.findIndex((step) => step.api?.path === '/api/courseware/attempts/auto-record');
    expect(autoIndex).toBeGreaterThan(ruleIndex);
  });

  it('课程包剧本存在，并覆盖导入 → 课程出现', () => {
    const s = scenario('course-package-import-loop');
    const paths = s.steps.map((step) => step.api?.path ?? '');
    expect(paths.some((p) => p.includes('/api/course-packages/import'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/lessons/{{importedLessonId}}'))).toBe(true);
  });

  it('课程包导入必须带 allowDuplicate —— 否则同一个包第二次导入必然 409', () => {
    const s = scenario('course-package-import-loop');
    const importStep = s.steps.find((step) => step.api?.path === '/api/course-packages/import');
    expect(importStep).toBeTruthy();
    expect((importStep!.api!.body as Record<string, unknown>).allowDuplicate).toBe(true);
  });

  it('跨教师/跨班剧本存在，并对越权访问断言 403', () => {
    const s = scenario('cross-tenant-authorization');
    const forbidden = s.steps.filter((step) => step.expectStatus === 403);
    // 至少：另一教师读他班课节、另一教师操作他班投票、别班学生读他班课节
    expect(forbidden.length).toBeGreaterThanOrEqual(3);
    // 并且要有一条「本人访问自己 → 200」的正向断言，避免把「全都不许访问」也当成通过
    expect(s.steps.some((step) => step.expectStatus === 200)).toBe(true);
    expect(s.roles).toContain('teacher-2');
  });

  it('第二教师角色存在，且凭据与前置数据用的是同一份常量', () => {
    const role = SWEEP_ROLES.find((r) => r.id === 'teacher-2');
    expect(role).toBeTruthy();
    expect(role!.login.username).toBe(CROSS_TENANT_TEACHER.username);
    expect(role!.login.password).toBe(CROSS_TENANT_TEACHER.password);
  });
});

describe('剧本引擎 · 状态码期望（Issue #247）', () => {
  it('默认从严：任何非 2xx 都算失败', () => {
    expect(isStatusAsExpected(200)).toBe(true);
    expect(isStatusAsExpected(204)).toBe(true);
    expect(isStatusAsExpected(403)).toBe(false);
    expect(isStatusAsExpected(404)).toBe(false);
    expect(isStatusAsExpected(500)).toBe(false);
  });

  it('指定 expectStatus 时只有匹配才算通过', () => {
    expect(isStatusAsExpected(403, 403)).toBe(true);
    expect(isStatusAsExpected(200, 403)).toBe(false);
    expect(isStatusAsExpected(500, 403)).toBe(false);
    expect(isStatusAsExpected(200, 200)).toBe(true);
  });
});

describe('前置数据 · 第二教师账号（Issue #247）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('账号已存在时跳过创建（幂等）', async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('/api/auth/login')) {
        return new Response('{}', { status: 200, headers: { 'set-cookie': 'edu_os_token=tok-2' } });
      }
      throw new Error(`不应再调用 ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureCrossTenantTeacher('http://127.0.0.1:9300', {
      entrance: 'teacher',
      username: 'admin',
      password: 'admin',
    });
    expect(result.created).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('账号不存在时用产品自己的 user.create 命令创建', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/api/auth/login')) {
        // 第一次登录失败（账号还没有），随后创建成功
        if (seen.filter((u) => u.includes('/api/auth/login')).length === 1) {
          return new Response('{}', { status: 401 });
        }
        return new Response('{}', { status: 200, headers: { 'set-cookie': 'edu_os_token=tok-2' } });
      }
      if (url.includes('/api/commands')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        expect(body.commandType).toBe('user.create');
        expect(body.payload.username).toBe(CROSS_TENANT_TEACHER.username);
        expect(body.payload.role).toBe('teacher');
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`意外调用 ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ensureCrossTenantTeacher('http://127.0.0.1:9300', {
      entrance: 'teacher',
      username: 'admin',
      password: 'admin',
    });
    expect(result.created).toBe(true);
    expect(result.error).toBeUndefined();
    expect(seen.some((u) => u.includes('/api/commands'))).toBe(true);
  });
});
