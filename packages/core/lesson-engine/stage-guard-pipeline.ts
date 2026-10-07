/**
 * OpenLearn Lesson Flow Engine - Stage Guard Pipeline
 *
 * Implements a resilient responsibility-chain pipeline for stage access gating.
 * Rules:
 * 1. Conjunction (AND) evaluation: All registered guards must pass for stage navigation to succeed.
 *    If any guard rejects access, all failure reasons are aggregated into the result.
 * 2. Fail-Close on guard failure (D-3 决策，2026-10-07): a guard that times out
 *    (default 1500ms) or throws causes access to be **denied**, not granted.
 *
 *    旧实现是 Fail-Open —— 超时/异常一律 `resolve({allowed:true})`。这意味着
 *    「插件慢或崩 → 学生直接跳过必修环节」，且旧测试把该语义固化了：慢守卫返回
 *    `{allowed:false, reason:'应该被超时熔断'}`，断言却是 `expect(allowed).toBe(true)`。
 *
 *    改为 fail-close 是**契约变更**。需恢复旧行为的部署方显式传
 *    `{ onGuardFailure: 'fail-open' }`；`onFailure` 钩子用于上报守卫失效事件。
 */

import type { StageGuard, StageGuardContext, StageGuardResult, IStageGuardService } from '../di/interfaces.js';

export interface StageGuardPipelineOptions {
  /** Timeout in milliseconds per guard execution. Defaults to 1500ms. */
  timeoutMs?: number;
  /**
   * 单次 `checkAccess` 的**全局**耗时上限（I-3）。
   *
   * 默认 `max(timeoutMs × 3, 3000)`。守卫改为并行执行后总耗时 ≈ 最慢的单个守卫，
   * 本上限用于封顶「一批守卫都卡死」的场景 —— 实测 30 个卡死守卫在旧串行实现下
   * 耗时 6011ms，且随守卫数线性增长、无上限。
   */
  totalTimeoutMs?: number;
  /**
   * 守卫超时或抛异常时的策略。默认 `'fail-close'`（D-3 决策）。
   * 传 `'fail-open'` 可恢复 3.8.0 之前的旧行为。
   */
  onGuardFailure?: StageGuardFailurePolicy;
  /** 守卫失败的观察钩子（上报/告警）。**不改变判定结果**，仅用于观测。 */
  onFailure?: (info: { guardId: string; guardName: string; reason: 'timeout' | 'threw'; error?: unknown }) => void;
}

/**
 * 超时/异常的处理策略（D-3 决策，2026-10-07）。
 *
 * | 情况 | fail-close | fail-open |
 * |---|---|---|
 * | 超时，且守卫**已给出 deny** | 拒绝（尊重守卫判定） | 放行（**否决守卫**） |
 * | 超时，守卫还没给出任何结论 | 拒绝 | 放行 |
 * | 守卫抛异常 | 拒绝 | 放行 |
 *
 * ## 为什么默认 fail-close
 *
 * 这是教学环节的**准入门禁**（gate），守卫生效的场景是「学生必须先通过测验
 * 才能进下一环节」。fail-open 意味着：**插件慢或崩 → 学生直接跳过必修环节**。
 * 开发期在测试里能直接看到这个语义 —— `stage-guard-pipeline.test.ts` 里的
 * 慢守卫返回 `{allowed:false, reason:'应该被超时熔断'}`，而旧断言是
 * `expect(result.allowed).toBe(true)`：守卫明确说了「拒绝」，平台却放行。
 *
 * ## 那为什么保留了 fail-open
 *
 * 课堂不能因为一个第三方插件卡死。但这不该由「静默放行」实现，而应由
 * `onGuardFailure` 上报 + 显式降级策略实现 —— 把选择权交回给部署方，
 * 而不是藏在超时分支里。
 *
 * 默认值从 fail-open 改为 fail-close 属**契约变更**：插件若依赖
 * 「守卫超时即放行」的旧行为，需显式传 `{ onGuardFailure: 'fail-open' }`。
 */
export type StageGuardFailurePolicy = 'fail-close' | 'fail-open';

/**
 * 带归属信息的守卫（内部用）。
 * `owner` 为空时退化为旧行为（按 guard.id 唯一），但会打告警 —— 见 registerGuard。
 */
export interface OwnedStageGuard extends StageGuard {
  /** 注册方标识（通常是 pluginId）。空字符串表示未声明 owner。 */
  readonly owner: string;
}

export class StageGuardPipeline implements IStageGuardService {
  /**
   * 键为 `owner \u0000 id`：跨插件同名不再互相覆盖（I-3）。
   *
   * 改用嵌套键的原因见 `registerGuard` 的注释 —— 旧实现用 `guard.id` 单键，
   * 两个插件都注册 `id:'gate'` 时后者静默覆盖前者，实测把「A 拒绝」变成「放行」。
   */
  private guards: Map<string, OwnedStageGuard> = new Map();
  private timeoutMs: number;
  /** I-3：单次判定的**全局**耗时上限，防止守卫数越多越慢 */
  private totalTimeoutMs: number;
  /** D-3：默认 fail-close —— 守卫失效时**不放行**，避免学生跳过必修环节 */
  private failurePolicy: StageGuardFailurePolicy;
  private onFailure: StageGuardPipelineOptions['onFailure'];

  constructor(options?: StageGuardPipelineOptions) {
    this.timeoutMs = options?.timeoutMs ?? 1500;
    // 全局上限默认 = 单守卫超时 ×3，下限 3s。
    // 取 3 倍而非 1 倍：多个合法守卫叠加仍有余量，同时把「30 个卡死守卫」
    // 从 6s 压到封顶值。实测旧实现 30×200ms = 6011ms 且随守卫数线性增长。
    this.totalTimeoutMs = options?.totalTimeoutMs ?? Math.max(this.timeoutMs * 3, 3_000);
    this.failurePolicy = options?.onGuardFailure ?? 'fail-close';
    this.onFailure = options?.onFailure;
  }

  /**
   * 注册守卫，返回注销函数。
   *
   * @param guard  守卫定义
   * @param owner  注册方（通常是 pluginId）。**强烈建议提供** ——
   *               见下方同名冲突说明。
   *
   * ## 为什么 owner 是必需的（I-3）
   *
   * 旧实现用 `guard.id` 作唯一键。实测两个插件都注册 `id:'gate'` 时：
   *   listGuards().length === 1
   *   判定结果 = {allowed:true}
   * 即**插件 A 的拒绝被插件 B 静默覆盖成放行**。这不是性能问题，是正确性问题 ——
   * 一个门禁守卫的拒绝可以被另一个插件无声吃掉。
   *
   * 声明 owner 后键变为 `owner\u0000id`，跨插件同名互不干扰。
   * 未声明 owner 时退化为旧行为（按 id 唯一）并打告警 —— 没有 owner 就无从区分，
   * 只能沿用旧语义，但至少让它可见而不是静默。
   */
  public registerGuard(guard: StageGuard, owner?: string): () => void {
    if (!guard || !guard.id) {
      throw new Error('[StageGuardPipeline] Invalid guard: must have a non-empty id');
    }
    const effectiveOwner = owner ?? '';
    if (!owner) {
      console.warn(
        `[StageGuardPipeline] Guard "${guard.id}" registered without owner. ` +
          `Guards are keyed by id only — another plugin registering the same id will silently ` +
          `override it. Pass owner (pluginId) to registerGuard().`,
      );
    }
    const key = this.keyOf(effectiveOwner, guard.id);
    const previous = this.guards.get(key);
    if (previous && previous !== guard && effectiveOwner) {
      console.warn(
        `[StageGuardPipeline] Guard "${guard.id}" replaced for owner "${effectiveOwner}" ` +
          `(previous: "${previous.name}"). This is normal for hot reload.`,
      );
    }
    this.guards.set(key, { ...guard, owner: effectiveOwner });
    return () => {
      this.unregisterGuard(guard.id, effectiveOwner);
    };
  }

  /**
   * 注销守卫。
   * @param guardId 守卫 id
   * @param owner 注册方；省略时按「无 owner」注销（兼容旧调用）
   */
  public unregisterGuard(guardId: string, owner?: string): void {
    this.guards.delete(this.keyOf(owner ?? '', guardId));
  }

  /**
   * 按注册方批量注销 —— 插件停用/热重载时用。
   *
   * 旧实现没有这个能力：守卫没记 owner，插件只能按 id 全局删，
   * 会误删同名的他人守卫（或漏删自己的）。
   */
  public unregisterByOwner(owner: string): number {
    let removed = 0;
    for (const [key, g] of this.guards) {
      if (g.owner === owner) {
        this.guards.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** 列出某注册方的全部守卫（诊断/管理用） */
  public listGuardsByOwner(owner: string): OwnedStageGuard[] {
    return this.listGuards().filter((g) => g.owner === owner);
  }

  private keyOf(owner: string, guardId: string): string {
    return `${owner}\u0000${guardId}`;
  }

  /**
   * List all currently registered stage guards sorted by priority ascending.
   */
  public listGuards(): OwnedStageGuard[] {
    return Array.from(this.guards.values()).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  /**
   * Evaluate all registered guards against the requested stage navigation context.
   * Enforces Conjunction (AND): all guards must return allowed: true.
   * If any fails, returns allowed: false with aggregated reasons.
   */
  public async checkAccess(ctx: StageGuardContext): Promise<StageGuardResult> {
    const guards = this.listGuards();
    if (guards.length === 0) {
      return { allowed: true };
    }

    // I-3：并行执行 + 全局耗时上限。
    //
    // 旧实现是串行 for-await，总耗时 = Σ(每个守卫耗时)。
    // 实测：5 个守卫各 250ms → 1253ms（并行应 ~250ms）；
    //      30 个卡死守卫、单守卫超时 200ms → 6011ms，且**随守卫数线性增长、无上限**。
    // 学生点一下环节时间线等 6 秒是不可接受的，且守卫越多越慢。
    //
    // 并行后总耗时 ≈ max(各守卫耗时)，再由 totalTimeoutMs 封顶。
    const settled = await Promise.all(guards.map((g) => this.executeGuardWithResilience(g, ctx, this.totalTimeoutMs)));

    // 按 listGuards() 的优先级顺序聚合，保证 reason 拼接顺序稳定（可测试、可复现）
    const failedGuardIds: string[] = [];
    const failureReasons: string[] = [];
    let aggregatedProgress: StageGuardResult['progress'] | undefined;

    for (let i = 0; i < guards.length; i++) {
      const result = settled[i];
      if (result.allowed) continue;
      failedGuardIds.push(guards[i].id);
      if (result.reason) failureReasons.push(result.reason);
      if (result.progress && !aggregatedProgress) aggregatedProgress = result.progress;
    }

    if (failedGuardIds.length > 0) {
      return {
        allowed: false,
        reason: failureReasons.join('；') || '未满足进入下一环节的前置条件',
        guardIds: failedGuardIds,
        progress: aggregatedProgress,
      };
    }

    return { allowed: true };
  }

  /**
   * 执行单个守卫，带超时与异常保护（D-3 决策：默认 fail-close）。
   *
   * 旧实现（fail-open）在超时与抛异常时都 `resolve({allowed:true})` ——
   * 即便守卫本来要拒绝。这条路径被直接写进了测试：慢守卫返回
   * `{allowed:false, reason:'应该被超时熔断'}`，旧断言 `expect(allowed).toBe(true)`。
   * 也就是说：**「应该被拒绝」被实现成了「放行」**。
   *
   * 新实现：
   * - 超时 → 按 `failurePolicy` 决定放行与否；fail-close 时给出**可读原因**，
   *   而不是让前端看到「未满足进入下一环节的前置条件」这种无从追溯的措辞。
   * - 抛异常 → 同上。
   * - `onFailure` 钩子用于上报，让运维能区分「守卫判定不通过」与「守卫本身坏了」。
   *
   * @param budgetMs 该守卫的耗时预算，取「单守卫超时」与「全局剩余预算」的较小者。
   *                  I-3：并行执行时必须按剩余预算收口，否则一批慢守卫叠加起来
   *                  仍会突破全局上限（Promise.all 只等最先完成的那个）。
   */
  private async executeGuardWithResilience(
    guard: StageGuard,
    ctx: StageGuardContext,
    budgetMs?: number,
  ): Promise<StageGuardResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const budget = budgetMs === undefined ? this.timeoutMs : Math.min(this.timeoutMs, Math.max(budgetMs, 1));

    const timeoutPromise = new Promise<StageGuardResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(this.onGuardFailure(guard, 'timeout', undefined));
      }, budget);
    });

    const executionPromise = (async (): Promise<StageGuardResult> => {
      try {
        return await guard.canEnterStage(ctx);
      } catch (err: unknown) {
        return this.onGuardFailure(guard, 'threw', err);
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      // 超时后守卫仍可能在后台跑完 —— 那条结果已无人接收，
      // 但若它 reject，会变成无人处理的 rejection。加一层吸收。
      if (timedOut) {
        void executionPromise.catch(() => {
          /* 已按超时处理；迟到的失败不再影响判定 */
        });
      }
    }
  }

  /** 守卫超时/抛异常时的统一处理：按策略产出判定结果 + 上报 */
  private onGuardFailure(guard: StageGuard, reason: 'timeout' | 'threw', error?: unknown): StageGuardResult {
    const failOpen = this.failurePolicy === 'fail-open';

    if (reason === 'threw') {
      console.error(
        `[StageGuardPipeline] Guard "${guard.id}" (${guard.name}) threw an exception. ` +
          `Policy=${this.failurePolicy}.`,
        error,
      );
    } else {
      console.warn(
        `[StageGuardPipeline] Guard "${guard.id}" (${guard.name}) timed out after ` +
          `${Math.min(this.timeoutMs, this.totalTimeoutMs)}ms. Policy=${this.failurePolicy}.`,
      );
    }

    try {
      this.onFailure?.({ guardId: guard.id, guardName: guard.name, reason, error });
    } catch (hookErr) {
      // 观测钩子抛错不得影响判定
      console.error('[StageGuardPipeline] onFailure hook threw:', hookErr);
    }

    if (failOpen) return { allowed: true };

    // fail-close：给出可追溯的原因，避免前端显示「未满足前置条件」这种
    // 让学生以为是自己没达标、实际是插件坏了的措辞。
    return {
      allowed: false,
      reason:
        reason === 'timeout'
          ? `门禁插件「${guard.name || guard.id}」响应超时，本环节暂不可进入`
          : `门禁插件「${guard.name || guard.id}」执行出错，本环节暂不可进入`,
    };
  }

  /**
   * Clear all registered guards.
   */
  public clear(): void {
    this.guards.clear();
  }
}

/**
 * 全局单例（运行时与前端 store 共用）。
 *
 * 默认 **fail-close**（D-3 决策）。`onFailure` 打到 console —— 守卫失效是需要
 * 人工介入的运维事件，不该静默。
 */
export const defaultStageGuardPipeline = new StageGuardPipeline({
  onFailure: ({ guardId, reason, error }) => {
    if (reason === 'timeout') {
      console.error(`[StageGuard] 门禁插件超时，已按 fail-close 拒绝进入: guardId=${guardId}`);
    } else {
      console.error(`[StageGuard] 门禁插件抛错，已按 fail-close 拒绝进入: guardId=${guardId}`, error);
    }
  },
});
