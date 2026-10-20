/**
 * scripts/sweep/probe.ts —— 浏览器侧巡检
 *
 * ## 巡检做什么
 *
 * 对每个角色的每个视图：
 * 1. API 登录拿会话 Cookie（**不经过登录页 UI**），塞进浏览器上下文；
 * 2. 导航到视图；
 * 3. 收集四类信号：
 *    - `pageerror` —— 未捕获的运行时异常（React 崩溃、undefined 访问……）
 *    - `console` —— console.error（含 React 警告）
 *    - `requestfailed` —— 请求失败（网络错误、被中断）
 *    - `http` —— 4xx / 5xx 响应
 * 4. 截图落盘，产出结构化结果。
 *
 * ## 两个关键设计
 *
 * **① 巡检按「真实用户操作路径」走，而不是反复整页刷新。**
 *
 * 教师/管理员端在一个页面里连续点击导航项（SPA 路由切换），这既贴近真实使用，
 * 也避免「刷新打断在途请求」制造出 `Failed to fetch` 这类假阳性。
 * 代价是某个视图崩溃可能污染后续视图 —— 所以一旦某个视图判为 error，
 * 下一步之前会先整页重载一次。
 *
 * **② 启动期问题与视图自身问题分开。**
 *
 * 有些问题（比如无课堂会话时前端仍去 POST view-state 拿到 404）在**每个**视图
 * 都会出现，把它们算到每个视图头上会让整份报告失去信噪比。
 * 因此报告阶段会把「出现在几乎所有视图里」的问题归类为**全局问题**，
 * 单独列出，不计入各视图的成败。
 *
 * ## 巡检不做什么
 *
 * 不做断言式验证（「这里必须出现某个文案」），只报「哪里坏了」。
 * 断言式回归测试是另一件事，见 `e2e/` 下已有的 Playwright 套件。
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DANGEROUS_ACTION_PATTERN, SKIP_ACTION_PATTERN, SUB_TABS_BY_TAB } from './manifest.js';
import { ensureFixtures } from './prepare.js';
import type {
  SweepClickSpec,
  SweepIssue,
  SweepLogin,
  SweepRole,
  SweepRoleId,
  SweepSubTab,
  SweepTarget,
  SweepViewResult,
} from './types.js';

/** 视口尺寸：覆盖常见桌面分辨率，保证侧边栏不折叠。 */
const VIEWPORT = { width: 1600, height: 1000 };

/** 导航后等待网络静默的上限（毫秒）。 */
const NETWORK_IDLE_TIMEOUT_MS = 8_000;
/** 网络静默后再额外等一会儿，让懒加载组件与图表渲染完成（毫秒）。 */
const SETTLE_MS = 1_200;

/**
 * 这些 URL 的失败不计入问题：它们是开发期基础设施噪音
 * （Vite HMR 探测、source map、favicon），不是功能缺陷。
 */
const IGNORE_URL_PATTERNS: RegExp[] = [
  /favicon\.ico/i,
  /\.js\.map($|\?)/i,
  /__vite_ping/i,
  /\/@vite\//i,
  /\/@react-refresh/i,
  /\/node_modules\/\.vite\//i,
];

/** 判断一个 URL 是否应当忽略。 */
function isIgnoredUrl(url: string): boolean {
  return IGNORE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * 登录并返回会话 Cookie 的值。
 *
 * 走真实 API 而不是填登录表单，是巡检能做到「无人值守」的关键：
 * 会话 Cookie 直接注入浏览器上下文，页面加载后就是已登录状态。
 */
export async function login(baseUrl: string, credentials: SweepLogin): Promise<string> {
  const payload: Record<string, string> = { entrance: credentials.entrance };

  if (credentials.entrance === 'student') {
    if (!credentials.studentId) throw new Error('学生登录缺少 studentId');
    if (!credentials.password) throw new Error('学生登录缺少口令（可用班级上课临时口令）');
    payload.studentId = credentials.studentId;
  } else {
    if (!credentials.username || !credentials.password) throw new Error('教师登录缺少用户名或口令');
    payload.username = credentials.username;
  }
  payload.password = credentials.password!;

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const setCookie =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''];
  const raw = setCookie.join('; ');
  const match = /edu_os_token=([^;]+)/.exec(raw);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`登录失败（HTTP ${res.status}）：${body.slice(0, 300)}`);
  }
  if (!match) {
    throw new Error(`登录响应里没有 edu_os_token Cookie。原始 Set-Cookie：${raw.slice(0, 200)}`);
  }
  return match[1]!;
}

/** 创建一个已登录的浏览器上下文。 */
async function createContext(browser: Browser, baseUrl: string, token: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await context.addCookies([
    {
      name: 'edu_os_token',
      value: token,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

/** 诊断收集器：挂到 page 上，按视图重置。 */
interface Collector {
  issues: SweepIssue[];
  detach: () => void;
}

function attachCollector(page: Page): Collector {
  const issues: SweepIssue[] = [];

  const onConsole = (msg: {
    type: () => string;
    text: () => string;
    location: () => { url?: string };
  }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const location = msg.location()?.url ?? '';
    if (!text || isIgnoredUrl(location)) return;
    issues.push({ kind: 'console', severity: 'error', message: text, url: location });
  };

  const onPageError = (err: Error & { stack?: string }) => {
    issues.push({
      kind: 'pageerror',
      severity: 'error',
      message: err.message,
      url: err.stack?.split('\n')[0],
    });
  };

  const onRequestFailed = (req: { method(): string; url(): string; failure(): { errorText?: string } | null }) => {
    const failure = req.failure();
    const errorText = failure?.errorText ?? 'unknown';
    // 页面重载/跳转导致的 ERR_ABORTED 是正常现象，不是缺陷。
    if (errorText.includes('ERR_ABORTED')) return;
    if (isIgnoredUrl(req.url())) return;
    issues.push({
      kind: 'requestfailed',
      severity: 'warning',
      message: `${req.method()} ${req.url()} — ${errorText}`,
      url: req.url(),
    });
  };

  const onResponse = (res: { status(): number; url(): string; request(): { method(): string } }) => {
    const status = res.status();
    if (status < 400) return;
    if (isIgnoredUrl(res.url())) return;
    issues.push({
      kind: 'http',
      severity: status >= 500 ? 'error' : 'warning',
      message: `${status} ${res.request().method()} ${res.url()}`,
      url: res.url(),
      status,
    });
  };

  page.on('console', onConsole as never);
  page.on('pageerror', onPageError as never);
  page.on('requestfailed', onRequestFailed as never);
  page.on('response', onResponse as never);

  return {
    issues,
    detach: () => {
      page.off('console', onConsole as never);
      page.off('pageerror', onPageError as never);
      page.off('requestfailed', onRequestFailed as never);
      page.off('response', onResponse as never);
    },
  };
}

/** 等待页面稳定：DOM 就绪 → 网络静默（尽力）→ 额外静置。 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

/** 页面是否停在登录页（说明会话没生效）。 */
async function isOnLoginPage(page: Page): Promise<boolean> {
  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await passwordInput.waitFor({ state: 'visible', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** 构造巡检用的 URL。 */
function buildUrl(baseUrl: string, target: SweepTarget, nonce: number): string {
  const url = new URL(target.path ?? '/', baseUrl);
  // 加一个一次性查询参数，强制每次都是整页加载 —— 避免上一视图的 React 状态
  // 泄漏到下一个视图，让每个视图都在「冷启动」条件下被检验。
  url.searchParams.set('sweep', String(nonce));
  if (target.hash) url.hash = `/${target.hash}`;
  return url.toString();
}

/** 把结果里的文件名收拾成安全的 slug。 */
function slugify(text: string): string {
  return (
    text
      .trim()
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'view'
  );
}

/**
 * 按可访问名点击一个按钮。
 *
 * 找不到 / 不可见时返回 false —— 调用方据此把视图标成 `missing`，
 * 而不是当成缺陷（有些入口只在特定角色或特定数据下才存在）。
 */
async function clickByName(page: Page, namePattern: string, scope?: string): Promise<boolean> {
  const regex = new RegExp(namePattern, 'i');
  const root = scope ? page.locator(scope) : page;
  const locator = root.getByRole('button', { name: regex }).first();
  try {
    await locator.waitFor({ state: 'visible', timeout: 5_000 });
    await locator.click({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** 按文本点击元素。 */
async function clickByText(page: Page, textPattern: string, nth = 0): Promise<boolean> {
  const regex = new RegExp(textPattern, 'i');
  const locator = page.getByText(regex).nth(nth);
  try {
    await locator.waitFor({ state: 'visible', timeout: 5_000 });
    await locator.click({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 执行一次「点击」，带一次兜底：学生端的快捷指令浮层默认收起，
 * 先展开浮层再找按钮。
 */
async function performClick(page: Page, spec: SweepClickSpec): Promise<boolean> {
  const attempt = async (): Promise<boolean> => {
    if (spec.selector) return clickBySelector(page, spec.selector);
    if (spec.name) return clickByName(page, spec.name);
    if (spec.text) return clickByText(page, spec.text, spec.nth ?? 0);
    return false;
  };

  if (await attempt()) return true;

  // 兜底：展开学生快捷指令浮层后重试。
  const expanded = await clickBySelector(page, '#student-quick-actions-fab-btn');
  if (expanded) {
    await page.waitForTimeout(400);
    if (await attempt()) return true;
  }
  return false;
}

/** 按 CSS 选择器点击元素。 */
async function clickBySelector(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout: 5_000 });
    await locator.click({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** 从侧边栏发现导航项（读 aria-label，不依赖按钮文字是否可见）。 */
async function discoverNavLabels(page: Page): Promise<string[]> {
  const sidebar = page.locator('#navigation_sidebar');
  try {
    await sidebar.waitFor({ state: 'visible', timeout: 15_000 });
  } catch {
    return [];
  }

  const labels = await sidebar.locator('button[aria-label]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).getAttribute('aria-label') ?? ''),
  );

  return Array.from(
    new Set(
      labels
        .map((label) => label.trim())
        .filter(
          (label) =>
            label.length > 0 &&
            !SKIP_ACTION_PATTERN.test(label) &&
            !DANGEROUS_ACTION_PATTERN.test(label),
        ),
    ),
  );
}

/** 视图巡检的结果组装。 */
function finalize(
  role: SweepRole,
  target: SweepTarget,
  subTab: SweepSubTab | undefined,
  issues: SweepIssue[],
  screenshot: string | undefined,
  url: string,
  durationMs: number,
  missing: boolean,
): SweepViewResult {
  let status: SweepViewResult['status'] = 'ok';
  if (missing) {
    status = 'missing';
  } else if (issues.some((issue) => issue.severity === 'error')) {
    status = 'error';
  } else if (issues.length > 0) {
    status = 'warn';
  }

  return {
    role: role.id,
    roleLabel: role.label,
    targetId: target.id,
    targetLabel: target.label,
    subTabId: subTab?.id,
    subTabLabel: subTab?.label,
    status,
    expectedMissing: missing && target.expectMissing === true,
    issues,
    screenshot,
    url,
    durationMs,
  };
}

export interface SweepRunOptions {
  baseUrl: string;
  /** 产物根目录（artifacts/sweep）。 */
  outDir: string;
  roles: SweepRole[];
  /** 截图子目录。 */
  screenshotDir: string;
  /** 进度回调。 */
  onProgress?: (message: string) => void;
}

/**
 * 执行一次完整巡检。
 */
export async function runSweep(options: SweepRunOptions): Promise<SweepViewResult[]> {
  const { baseUrl, roles, screenshotDir } = options;
  const log = options.onProgress ?? (() => {});
  fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const results: SweepViewResult[] = [];
  let nonce = 0;

  try {
    for (const role of roles) {
      log(`▶ 角色：${role.label}（${role.id}）`);

      // ── 前置数据：没有数据的功能根本进不去，先补齐 ──────────
      const prepareKinds = role.prepare ?? [];
      if (prepareKinds.length > 0) {
        const teacherRole = roles.find((r) => r.login.entrance === 'teacher');
        if (teacherRole) {
          const fixtures = await ensureFixtures(baseUrl, teacherRole.login, prepareKinds);
          for (const fixture of fixtures) {
            log(
              `  ⓘ 前置数据 ${fixture.kind}：${fixture.detail}` +
                (fixture.error ? `（${fixture.error}）` : ''),
            );
          }
        }
      }

      let token: string;
      try {
        token = await login(baseUrl, role.login);
      } catch (err) {
        results.push({
          role: role.id,
          roleLabel: role.label,
          targetId: '__login__',
          targetLabel: '登录',
          status: 'error',
          issues: [
            {
              kind: 'nav',
              severity: 'error',
              message: `登录失败：${(err as Error).message}`,
            },
          ],
          url: `${baseUrl}/api/auth/login`,
          durationMs: 0,
        });
        log(`  ✗ 登录失败：${(err as Error).message}`);
        continue;
      }

      const context = await createContext(browser, baseUrl, token);

      if (role.id === 'student' || role.id === 'student-live') {
        await sweepStudent(context, role, results, { baseUrl, screenshotDir, log, nextNonce: () => ++nonce });
      } else {
        await sweepWorkspace(context, role, results, { baseUrl, screenshotDir, log, nextNonce: () => ++nonce });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return results;
}

/** 巡检上下文（避免参数列表过长）。 */
interface SweepCtx {
  baseUrl: string;
  screenshotDir: string;
  log: (message: string) => void;
  nextNonce: () => number;
}

/**
 * 教师 / 管理员工作台巡检。
 *
 * 流程：冷启动一次（记为「系统启动」）→ 侧边栏导航逐个点击 → 每个视图下的二级页签。
 */
async function sweepWorkspace(
  context: BrowserContext,
  role: SweepRole,
  results: SweepViewResult[],
  ctx: SweepCtx,
): Promise<void> {
  const page = await context.newPage();
  await preparePage(page);

  // ── 冷启动：单独记一条，把「系统启动就有问题」与「某视图有问题」分开 ──
  const boot = await probe(
    page,
    role,
    { id: '__boot__', label: '系统启动', path: '/' },
    ctx,
    async () => {
      await page.goto(`${ctx.baseUrl}/?sweep=${ctx.nextNonce()}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
    },
  );
  results.push(boot.result);
  ctx.log(`  · 系统启动（冷加载）（${describeIssues(boot.result.issues)}）`);

  if (boot.result.issues.some((issue) => issue.kind === 'nav')) {
    await context.close();
    return;
  }

  // ── 发现侧边栏导航 ──────────────────────────────────────────
  const navLabels = await discoverNavLabels(page);
  ctx.log(`  发现 ${navLabels.length} 个导航项：${navLabels.join(' / ') || '(无)'}`);

  let lastStatus: SweepViewResult['status'] = 'ok';

  for (const label of navLabels) {
    const target: SweepTarget = {
      id: `nav-${slugify(label)}`,
      label,
      path: '/',
      note: '侧边栏导航（运行时发现）',
    };

    // 上一个视图崩了的话，先整页重载，避免崩溃的 React 树污染下一个视图的结论。
    if (lastStatus === 'error') {
      await page.goto(`${ctx.baseUrl}/?sweep=${ctx.nextNonce()}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
    }

    const navProbe = await probe(page, role, target, ctx, async () => {
      const clicked = await clickByName(page, `^${escapeRegExp(label)}$`, '#navigation_sidebar');
      if (!clicked) {
        // 侧边栏可能处于折叠态导致定位失败，退回到全页面查找。
        const fallback = await clickByName(page, `^${escapeRegExp(label)}$`);
        if (!fallback) throw new Error(`未找到导航按钮「${label}」`);
      }
      await settle(page);
    });

    results.push(navProbe.result);
    lastStatus = navProbe.result.status;
    ctx.log(`  · ${label}（${describeIssues(navProbe.result.issues)}）`);

    // ── 二级页签 ─────────────────────────────────────────────
    const tabId = extractTabId(navProbe.result.url);
    const subTabs = tabId ? (SUB_TABS_BY_TAB[tabId] ?? []) : [];
    for (const subTab of subTabs) {
      const subProbe = await probe(page, role, target, ctx, async () => {
        // 回到父视图（当前就在父视图，但保险起见重新点一次）
        await clickByName(page, `^${escapeRegExp(label)}$`, '#navigation_sidebar');
        await settle(page);
        await dismissBlockingModals(page);

        // 页签可能需要前置操作（例如先展开某个班级，页签才出现）。
        // 先直接找页签，找不到再做前置点击 —— 前置点击往往是**开关**，
        // 重复点会把已经展开的内容又收起来。
        let clicked = await clickByName(page, subTab.name);
        if (!clicked && subTab.preClick) {
          const prepared = await performClick(page, subTab.preClick);
          if (!prepared) throw new Error(`未找到前置入口（${describeClick(subTab.preClick)}）`);
          await settle(page);
          clicked = await clickByName(page, subTab.name);
        }
        if (!clicked) throw new Error(`未找到页签按钮「${subTab.label}」`);
        await settle(page);
      }, subTab);
      results.push(subProbe.result);
      ctx.log(`    · ${label} / ${subTab.label}（${describeIssues(subProbe.result.issues)}）`);
    }
  }

  // ── 顶栏「系统总览」（不在侧边栏里，发现机制扫不到）──────────
  const dashProbe = await probe(
    page,
    role,
    { id: 'dashboard', label: '系统总览', hash: 'dashboard', note: '顶栏入口，不在侧边栏中' },
    ctx,
    async () => {
      await page.goto(`${ctx.baseUrl}/?sweep=${ctx.nextNonce()}#/dashboard`, { waitUntil: 'domcontentloaded' });
      await settle(page);
    },
  );
  results.push(dashProbe.result);
  ctx.log(`  · 系统总览（${describeIssues(dashProbe.result.issues)}）`);

  await page.close();
}

/**
 * 学生端巡检。
 *
 * 学生端没有侧边栏，视图都从仪表盘挂件/快捷指令进入，因此每个目标用
 * **独立的页面**打开：起点一致、互不污染，页面关闭时的在途请求中断也不会
 * 被算成缺陷（收集器在关闭前已经摘掉）。
 */
async function sweepStudent(
  context: BrowserContext,
  role: SweepRole,
  results: SweepViewResult[],
  ctx: SweepCtx,
): Promise<void> {
  const targets = role.targets;

  for (const target of targets) {
    const page = await context.newPage();
    await preparePage(page);

    const targetProbe = await probe(page, role, target, ctx, async () => {
      await page.goto(buildUrl(ctx.baseUrl, target, ctx.nextNonce()), { waitUntil: 'domcontentloaded' });
      await settle(page);

      if (await isOnLoginPage(page)) {
        throw new Error('页面停在登录页（会话已失效）');
      }

      // 先关掉可能盖住整页的弹窗（破冰打卡），否则后续点击全部落空。
      await dismissBlockingModals(page);

      if (target.open) {
        const opened = await performClick(page, target.open);
        if (!opened) throw new Error(`未找到展开入口（${describeClick(target.open)}）`);
        await page.waitForTimeout(400);
      }

      if (target.click) {
        const clicked = await performClick(page, target.click);
        if (!clicked) {
          throw new Error(
            `未找到可点击入口（${describeClick(target.click)}）`,
          );
        }
        await settle(page);
        await dismissBlockingModals(page);
      }
    });

    results.push(targetProbe.result);
    ctx.log(`  · ${target.label}（${describeIssues(targetProbe.result.issues)}）`);
    await page.close();
  }
}

/** 给页面装上巡检所需的环境：跳过新手引导、自动关弹窗。 */
async function preparePage(page: Page): Promise<void> {
  // 跳过新手引导浮层，否则它会挡住页面、干扰点击与截图。
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('edu_os_tour_completed', 'true');
    } catch {
      /* 隐私模式下 localStorage 可能不可用 */
    }
  });
  // 自动关掉确认弹窗，避免巡检卡死。
  page.on('dialog', (dialog) => {
    dialog.dismiss().catch(() => {});
  });
}

/**
 * 关掉会挡住后续操作的**应用内**弹窗。
 *
 * 目前只处理一个已知会挡路的：**课前破冰心情打卡弹窗**。
 * 它在学生端有进行中的课堂会话时自动弹出，盖住整个仪表盘 —— 不关掉的话
 * 后面所有点击都会被它挡住（连“打开我的测评”都点不到）。
 *
 * 不做泛化的「关掉所有弹窗」——那会误伤视图里本该看的东西。
 */
async function dismissBlockingModals(page: Page): Promise<void> {
  const icebreaker = page.locator('[data-testid="student-icebreaker-modal"]');
  const visible = await icebreaker
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return;

  const skipByTestId = icebreaker.locator('[data-testid="icebreaker-skip-btn"]');
  if ((await skipByTestId.count()) > 0) {
    await skipByTestId.first().click({ timeout: 3_000 }).catch(() => {});
  } else {
    const alt = icebreaker.getByRole('button', { name: /稍后再说|跳过|Skip/ }).first();
    await alt.click({ timeout: 3_000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
}

/** 一次视图巡检。 */
interface ProbeOutcome {
  result: SweepViewResult;
}

async function probe(
  page: Page,
  role: SweepRole,
  target: SweepTarget,
  ctx: SweepCtx,
  action: () => Promise<void>,
  subTab?: SweepSubTab,
): Promise<ProbeOutcome> {
  const collector = attachCollector(page);
  const started = Date.now();
  let url: string;
  let missing = false;

  try {
    await action();
    url = page.url();
  } catch (err) {
    const message = (err as Error).message;
    missing = message.startsWith('未找到');
    collector.issues.push({
      kind: 'nav',
      severity: missing ? 'warning' : 'error',
      message,
    });
    url = page.url();
  }

  collector.detach();
  const screenshot = await capture(page, ctx.screenshotDir, role.id, `${target.id}${subTab ? `--${subTab.id}` : ''}`);
  return {
    result: finalize(role, target, subTab, collector.issues, screenshot, url, Date.now() - started, missing),
  };
}

/** 截图；失败不视为缺陷（截图只是证据）。 */
async function capture(
  page: Page,
  screenshotDir: string,
  roleId: SweepRoleId,
  viewId: string,
): Promise<string | undefined> {
  const fileName = `${roleId}-${slugify(viewId)}.png`;
  const absPath = path.join(screenshotDir, fileName);
  try {
    await page.screenshot({ path: absPath, fullPage: false, timeout: 15_000 });
    return path.join('screenshots', fileName);
  } catch {
    return undefined;
  }
}

/** 从 URL hash 里取出 tab id（`#/classes` → `classes`）。 */
function extractTabId(url: string): string | undefined {
  const match = /#\/(.+)$/.exec(url);
  return match?.[1];
}

/** 转义正则元字符。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 状态图标。 */
function icon(status: SweepViewResult['status']): string {
  switch (status) {
    case 'ok':
      return '✅';
    case 'warn':
      return '⚠️ ';
    case 'error':
      return '❌';
    case 'missing':
      return '⭕';
  }
}

/** 把一组问题压缩成一句话（用于过程日志）。 */
function describeIssues(issues: SweepIssue[]): string {
  if (issues.length === 0) return '无异常';
  const byKind = new Map<string, number>();
  for (const issue of issues) {
    byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1);
  }
  return Array.from(byKind.entries())
    .map(([kind, count]) => `${kind}×${count}`)
    .join(' ');
}

/** 把点击描述压缩成一句话（用于错误信息）。 */
function describeClick(spec: SweepClickSpec): string {
  if (spec.selector) return `selector=${spec.selector}`;
  if (spec.name) return `name=${spec.name}`;
  if (spec.text) return `text=${spec.text}`;
  return '(空)';
}

export { icon };
