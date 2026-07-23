/**
 * OpenLearn Platform Kernel - Pipeline Executor (PI-003)
 * Orchestrates sequential execution of stages, structured logging, timing, and error rollback.
 */

import { IBootstrapStage } from './bootstrap-stage.js';
import {
  PipelineResult,
  StageExecutionResult,
  PipelineDiagnosticListener,
  PipelineDiagnosticEvent,
} from './pipeline-types.js';
import { IBootstrapContext, StartupTimeoutError } from '../types/index.js';

export class PipelineExecutor {
  private listeners = new Set<PipelineDiagnosticListener>();

  public addListener(listener: PipelineDiagnosticListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: PipelineDiagnosticEvent): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        console.error('[PipelineExecutor] Listener error:', err);
      }
    }
  }

  public async execute(
    stages: ReadonlyArray<IBootstrapStage>,
    context: IBootstrapContext
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const results: StageExecutionResult[] = [];
    const executedStages: IBootstrapStage[] = [];

    this.emit({ type: 'PipelineStarted', timestamp: startTime });
    console.log('[Platform] Starting Bootstrap Pipeline execution...');

    for (const stage of stages) {
      if (context.isCancelled) {
        console.warn(`[Platform] Pipeline cancelled before stage ${stage.name}`);
        const totalDurationMs = Date.now() - startTime;
        return {
          totalDurationMs,
          status: 'Aborted',
          stageResults: Object.freeze(results),
        };
      }

      console.log(`[Platform] Entering ${stage.name}`);
      this.emit({
        type: 'StageStarted',
        timestamp: Date.now(),
        stageId: stage.id,
        stageName: String(stage.name),
      });

      const stageStart = Date.now();
      try {
        if (stage.timeoutMs && stage.timeoutMs > 0) {
          await this.executeWithTimeout(stage, context, stage.timeoutMs);
        } else {
          await stage.execute(context);
        }

        const durationMs = Date.now() - stageStart;
        console.log(`[Platform] Completed ${stage.name} (${durationMs} ms)`);

        results.push({
          stageId: stage.id,
          stageName: String(stage.name),
          durationMs,
          status: 'Success',
        });

        executedStages.push(stage);

        this.emit({
          type: 'StageCompleted',
          timestamp: Date.now(),
          stageId: stage.id,
          stageName: String(stage.name),
          durationMs,
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const durationMs = Date.now() - stageStart;

        console.error(`[Platform] Failed ${stage.name} (${durationMs} ms): ${error.message}`);
        results.push({
          stageId: stage.id,
          stageName: String(stage.name),
          durationMs,
          status: 'Failed',
          error,
        });

        this.emit({
          type: 'StageFailed',
          timestamp: Date.now(),
          stageId: stage.id,
          stageName: String(stage.name),
          durationMs,
          error,
        });

        // Trigger rollback for executed stages in reverse order
        await this.rollbackExecutedStages(executedStages, context);

        const totalDurationMs = Date.now() - startTime;
        const pipelineResult: PipelineResult = {
          totalDurationMs,
          status: 'Failed',
          stageResults: Object.freeze(results),
          failedStage: stage.id,
          error,
        };

        this.emit({
          type: 'PipelineCompleted',
          timestamp: Date.now(),
          durationMs: totalDurationMs,
          error,
        });

        return pipelineResult;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    console.log(`[Platform] Ready. Total startup duration: ${totalDurationMs} ms.`);

    const finalResult: PipelineResult = {
      totalDurationMs,
      status: 'Success',
      stageResults: Object.freeze(results),
    };

    this.emit({
      type: 'PipelineCompleted',
      timestamp: Date.now(),
      durationMs: totalDurationMs,
    });

    return finalResult;
  }

  private async executeWithTimeout(
    stage: IBootstrapStage,
    context: IBootstrapContext,
    timeoutMs: number
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new StartupTimeoutError(`Stage execution timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });

    try {
      await Promise.race([stage.execute(context), timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async rollbackExecutedStages(
    executedStages: IBootstrapStage[],
    context: IBootstrapContext
  ): Promise<void> {
    console.log('[Platform] Triggering stage rollbacks...');
    for (let i = executedStages.length - 1; i >= 0; i--) {
      const stage = executedStages[i];
      if (stage.rollback) {
        try {
          console.log(`[Platform] Rolling back ${stage.name}`);
          await stage.rollback(context);
        } catch (rbErr) {
          console.error(`[Platform] Error during rollback of ${stage.name}:`, rbErr);
        }
      }
    }
  }
}
