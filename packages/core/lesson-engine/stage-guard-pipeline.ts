/**
 * OpenLearn Lesson Flow Engine - Stage Guard Pipeline
 *
 * Implements a resilient responsibility-chain pipeline for stage access gating.
 * Rules:
 * 1. Fail-Open: On guard execution timeout (default 1500ms) or thrown exceptions,
 *    gracefully logs warnings and allows access to avoid deadlocking classroom lessons.
 * 2. Conjunction (AND) evaluation: All registered guards must pass for stage navigation to succeed.
 *    If any guard rejects access, all failure reasons are aggregated into the result.
 */

import type {
  StageGuard,
  StageGuardContext,
  StageGuardResult,
  IStageGuardService,
} from '../di/interfaces.js';

export interface StageGuardPipelineOptions {
  /** Timeout in milliseconds per guard execution. Defaults to 1500ms. */
  timeoutMs?: number;
}

export class StageGuardPipeline implements IStageGuardService {
  private guards: Map<string, StageGuard> = new Map();
  private timeoutMs: number;

  constructor(options?: StageGuardPipelineOptions) {
    this.timeoutMs = options?.timeoutMs ?? 1500;
  }

  /**
   * Register a new stage guard.
   * Returns a disposal function to unregister cleanly.
   */
  public registerGuard(guard: StageGuard): () => void {
    if (!guard || !guard.id) {
      throw new Error('[StageGuardPipeline] Invalid guard: must have a non-empty id');
    }
    this.guards.set(guard.id, guard);
    return () => {
      this.unregisterGuard(guard.id);
    };
  }

  /**
   * Unregister an existing stage guard by id.
   */
  public unregisterGuard(guardId: string): void {
    this.guards.delete(guardId);
  }

  /**
   * List all currently registered stage guards sorted by priority ascending.
   */
  public listGuards(): StageGuard[] {
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

    const failedGuardIds: string[] = [];
    const failureReasons: string[] = [];
    let aggregatedProgress: StageGuardResult['progress'] | undefined;

    for (const guard of guards) {
      const result = await this.executeGuardWithResilience(guard, ctx);
      if (!result.allowed) {
        failedGuardIds.push(guard.id);
        if (result.reason) {
          failureReasons.push(result.reason);
        }
        if (result.progress && !aggregatedProgress) {
          aggregatedProgress = result.progress;
        }
      }
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
   * Wraps guard execution with timeout race and error catch (Fail-Open policy).
   */
  private async executeGuardWithResilience(guard: StageGuard, ctx: StageGuardContext): Promise<StageGuardResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<StageGuardResult>((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `[StageGuardPipeline] Guard "${guard.id}" (${guard.name}) timed out after ${this.timeoutMs}ms. Failing open.`,
        );
        resolve({ allowed: true });
      }, this.timeoutMs);
    });

    const executionPromise = (async (): Promise<StageGuardResult> => {
      try {
        const res = await guard.canEnterStage(ctx);
        return res;
      } catch (err: unknown) {
        console.error(
          `[StageGuardPipeline] Guard "${guard.id}" (${guard.name}) threw an exception. Failing open:`,
          err,
        );
        return { allowed: true };
      }
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Clear all registered guards.
   */
  public clear(): void {
    this.guards.clear();
  }
}

/** Global singleton instance for runtime and frontend store */
export const defaultStageGuardPipeline = new StageGuardPipeline();
