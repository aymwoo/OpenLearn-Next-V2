/**
 * scripts/sweep/scenario.ts —— 写流程剧本引擎
 *
 * ## 为什么要有剧本
 *
 * 只读巡检（`runSweep`）覆盖的是「打开每个视图有没有报错」。但教学平台最重的
 * 链路是**写流程**：教师发布 → 学生作答 → 教师批改 → 学生看到分数。
 * 这条链路上的接口调用比只读浏览多得多，也更容易出现「权限不对 / 数据没带上」
 * 导致的 403/404。
 *
 * ## 设计取舍：写操作走 API，界面走浏览器
 *
 * - **写操作用 API**：UI 一改版剧本就碎，而 API 契约稳定。剧本的价值不在
 *   「把按钮点一遍」，而在**动作前后浏览器的真实渲染**。
 * - **观察用浏览器**：每一步之后在对应角色的浏览器里打开相关界面，沿途收集
 *   console 错误与 4xx/5xx —— 这正是只读巡检抓不到的部分。
 *
 * 换句话说：剧本 = 业务真相（API）+ 渲染噪音（浏览器）。
 *
 * ## 安全边界
 *
 * 剧本只在**一次性演示库**上跑（`scripts/sweep/server.ts` 起的独立服务），
 * 写操作的影响范围被限制在演示库里；且剧本里的动作是**显式编写**的，
 * 不会像只读巡检那样「点到什么算什么」——不会误触删除类按钮。
 *
 * @module
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { attachCollector, capture, dismissBlockingModals, login, settle } from './probe.js';
import type {
  SweepIssue,
  SweepRole,
  SweepRoleId,
  SweepScenario,
  SweepScenarioResult,
  SweepScenarioStep,
  SweepScenarioStepResult,
} from './types.js';

/** 一个角色在剧本执行期间的会话。 */
interface ScenarioRoleSession {
  role: SweepRoleId;
  roleLabel: string;
  token: string;
  context: BrowserContext;
  page: Page;
}

/** 从响应体里按点分路径取值（如 `result.calculatedFinalScore`）。 */
function pick(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, body);
}

/** 把 `{{name}}` 占位符替换成剧本里捕获到的变量。 */
function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{(\w+)\}\}/g, (match, name) => vars[name] ?? match);
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolate(item, vars);
    }
    return out;
  }
  return value;
}

/** 把一个字符串渲染成模板（用于 URL 与 body 里的路径片段）。 */
function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, name) => vars[name] ?? match);
}

export interface RunScenariosOptions {
  baseUrl: string;
  scenarios: SweepScenario[];
  /** 角色清单（提供账号凭据）。 */
  roles: SweepRole[];
  /** 截图目录。 */
  screenshotDir: string;
  onProgress?: (message: string) => void;
}

/**
 * 执行所有写流程剧本。
 */
export async function runScenarios(options: RunScenariosOptions): Promise<SweepScenarioResult[]> {
  const { baseUrl, scenarios, roles, screenshotDir } = options;
  const log = options.onProgress ?? (() => {});
  const results: SweepScenarioResult[] = [];
  if (scenarios.length === 0) return results;

  const browser = await chromium.launch({ headless: true });

  try {
    for (const scenario of scenarios) {
      log(`▶ 剧本：${scenario.label}`);
      const sessions = await openSessions(browser, baseUrl, scenario, roles);
      const vars: Record<string, string> = {};
      const stepResults: SweepScenarioStepResult[] = [];
      let aborted = false;

      for (const step of scenario.steps) {
        if (aborted) {
          stepResults.push({
            label: step.label,
            role: step.role,
            roleLabel: sessions.find((s) => s.role === step.role)?.roleLabel ?? step.role,
            status: 'skipped',
            issues: [],
            detail: '前序步骤失败，跳过',
            durationMs: 0,
          });
          continue;
        }

        const session = sessions.find((s) => s.role === step.role);
        if (!session) {
          stepResults.push({
            label: step.label,
            role: step.role,
            roleLabel: step.role,
            status: 'error',
            issues: [],
            detail: `剧本未声明角色 ${step.role}`,
            durationMs: 0,
          });
          aborted = true;
          continue;
        }

        const result = await runStep(step, session, { baseUrl, vars, screenshotDir });
        stepResults.push(result);
        log(`  ${result.status === 'ok' ? '✅' : result.status === 'skipped' ? '⭕' : '❌'} ${step.label}`);
        if (result.status === 'error') aborted = true;
      }

      for (const session of sessions) {
        await session.context.close().catch(() => {});
      }

      const status: SweepScenarioResult['status'] = stepResults.some((s) => s.status === 'error')
        ? 'error'
        : stepResults.some((s) => s.status === 'skipped')
          ? 'skipped'
          : 'ok';
      results.push({ id: scenario.id, label: scenario.label, status, steps: stepResults });
    }
  } finally {
    await browser.close();
  }

  return results;
}

/** 为剧本需要的角色各开一个已登录的浏览器上下文。 */
async function openSessions(
  browser: Browser,
  baseUrl: string,
  scenario: SweepScenario,
  roles: SweepRole[],
): Promise<ScenarioRoleSession[]> {
  const sessions: ScenarioRoleSession[] = [];

  for (const roleId of scenario.roles) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) continue;

    const token = await login(baseUrl, role.login);
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    await context.addCookies([
      { name: 'edu_os_token', value: token, url: baseUrl, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('edu_os_tour_completed', 'true');
      } catch {
        /* 隐私模式下 localStorage 可能不可用 */
      }
    });
    page.on('dialog', (dialog) => {
      dialog.dismiss().catch(() => {});
    });

    sessions.push({ role: roleId, roleLabel: role.label, token, context, page });
  }

  return sessions;
}

/** 执行单步。 */
async function runStep(
  step: SweepScenarioStep,
  session: ScenarioRoleSession,
  ctx: { baseUrl: string; vars: Record<string, string>; screenshotDir: string },
): Promise<SweepScenarioStepResult> {
  const started = Date.now();
  const collector = attachCollector(session.page);
  const issues: SweepIssue[] = [];
  let detail: string | undefined;
  let failed = false;

  try {
    // ① 业务动作（API）
    if (step.api) {
      const path = renderTemplate(step.api.path, ctx.vars);
      const body = step.api.body ? interpolate(step.api.body, ctx.vars) : undefined;

      const res = await fetch(`${ctx.baseUrl}${path}`, {
        method: step.api.method,
        headers: {
          cookie: `edu_os_token=${session.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (!res.ok) {
        failed = true;
        detail = `API ${step.api.method} ${path} → HTTP ${res.status}：${text.slice(0, 200)}`;
        issues.push({
          kind: 'nav',
          severity: 'error',
          message: detail,
          url: path,
          status: res.status,
        });
      } else {
        // 捕获变量
        if (step.capture) {
          const captured = pick(parsed, step.capture.path);
          if (captured === undefined || captured === null || captured === '') {
            failed = true;
            detail = `响应里没找到要捕获的字段 ${step.capture.path}`;
          } else {
            ctx.vars[step.capture.name] = String(captured);
          }
        }
        // 断言
        if (step.expect) {
          const actual = pick(parsed, step.expect.path);
          if (step.expect.notEmpty && (actual === undefined || actual === null || actual === '')) {
            failed = true;
            detail = `期望 ${step.expect.path} 非空，实际 ${JSON.stringify(actual)}`;
          } else if (step.expect.equals !== undefined && actual !== step.expect.equals) {
            failed = true;
            detail = `期望 ${step.expect.path} = ${JSON.stringify(step.expect.equals)}，实际 ${JSON.stringify(actual)}`;
          }
        }
      }
    }

    // ② 观察（浏览器）：动作后打开对应界面，沿途收集噪音
    if (step.view) {
      const url = new URL(step.view.path ?? '/', ctx.baseUrl);
      url.searchParams.set('sweep', 'scenario');
      if (step.view.hash) url.hash = `/${step.view.hash}`;
      await session.page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
      await settle(session.page);
      // 关掉盖住整页的弹窗（破冰打卡），否则截图里只有弹窗、看不到真实界面
      await dismissBlockingModals(session.page);
    }
  } catch (err) {
    failed = true;
    detail = (err as Error).message;
    issues.push({ kind: 'nav', severity: 'error', message: `步骤异常：${detail}` });
  }

  collector.detach();
  const allIssues = [...collector.issues, ...issues];

  const shot = await capture(session.page, ctx.screenshotDir, session.role, `scenario-${step.label}`);

  return {
    label: step.label,
    role: session.role,
    roleLabel: session.roleLabel,
    status: failed ? 'error' : 'ok',
    issues: allIssues,
    screenshot: shot,
    detail,
    durationMs: Date.now() - started,
  };
}
