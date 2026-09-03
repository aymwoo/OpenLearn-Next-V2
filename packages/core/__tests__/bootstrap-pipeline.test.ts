import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BootstrapPipeline,
  PipelineExecutor,
  PipelineDiagnosticEvent,
} from '../bootstrap/pipeline/index.js';
import type { IBootstrapStage } from '../bootstrap/types/index.js';
import {
  IBootstrapContext,
  PlatformStage,
  DEFAULT_BOOTSTRAP_CONFIG,
} from '../bootstrap/types/index.js';

class MockBootstrapContext implements IBootstrapContext {
  public startupTimestamp = Date.now();
  public startupOptions = {};
  public startupStage = PlatformStage.Created;
  public startupToken = { token: 'test', isCancelled: false, cancel: () => {} };
  public isCancelled = false;
  public platformContext = {} as any;

  public config = DEFAULT_BOOTSTRAP_CONFIG;
  public state: any = 'Bootstrapping';
  public currentStage = PlatformStage.Created;
  public startTime = Date.now();

  private metadata = new Map<string, unknown>();

  getMetadata(key: string): unknown {
    return this.metadata.get(key);
  }

  setStage(stage: PlatformStage): void {
    this.currentStage = stage;
    this.startupStage = stage;
  }
}

describe('PI-003 Bootstrap Pipeline Test Suite', () => {
  let context: MockBootstrapContext;

  beforeEach(() => {
    context = new MockBootstrapContext();
  });

  describe('1. Default Standard Stages & Order', () => {
    it('should execute standard 5 wrapper stages in exact sequence', async () => {
      const pipeline = new BootstrapPipeline();
      expect(pipeline.stages.length).toBe(5);

      const events: PipelineDiagnosticEvent[] = [];
      pipeline.addListener((evt) => events.push(evt));

      const result = await pipeline.execute(context);
      expect(result.status).toBe('Success');
      expect(result.stageResults.length).toBe(5);
      expect(context.currentStage).toBe(PlatformStage.Ready);

      const stageNames = result.stageResults.map((s) => s.stageName);
      expect(stageNames).toEqual([
        PlatformStage.Created,
        PlatformStage.Registering,
        PlatformStage.Initializing,
        PlatformStage.Activating,
        PlatformStage.Ready,
      ]);

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('PipelineStarted');
      expect(eventTypes).toContain('StageStarted');
      expect(eventTypes).toContain('StageCompleted');
      expect(eventTypes).toContain('PipelineCompleted');
    });
  });

  describe('2. Pipeline Failure & Rollback Execution', () => {
    it('should stop execution, generate PipelineResult with error, and run rollbacks on failure', async () => {
      const rollbackSpy1 = vi.fn();
      const rollbackSpy2 = vi.fn();

      const stage1: IBootstrapStage = {
        id: 's1',
        name: 'Stage 1',
        description: 'First stage',
        execute: async () => {},
        rollback: rollbackSpy1,
      };

      const stage2: IBootstrapStage = {
        id: 's2',
        name: 'Stage 2',
        description: 'Second stage with failure',
        execute: async () => {
          throw new Error('Stage 2 Fatal Error');
        },
        rollback: rollbackSpy2,
      };

      const stage3: IBootstrapStage = {
        id: 's3',
        name: 'Stage 3',
        description: 'Third stage should be skipped',
        execute: async () => {},
      };

      const pipeline = new BootstrapPipeline([stage1, stage2, stage3]);
      const result = await pipeline.execute(context);

      expect(result.status).toBe('Failed');
      expect(result.failedStage).toBe('s2');
      expect(result.error?.message).toBe('Stage 2 Fatal Error');
      expect(result.stageResults.length).toBe(2);

      // Verify rollback executed for stage1 in reverse order
      expect(rollbackSpy1).toHaveBeenCalledTimes(1);
      expect(rollbackSpy2).not.toHaveBeenCalled(); // Stage 2 failed, only executed prior stages rolled back
    });
  });

  describe('3. Execution Timing & Cancellation', () => {
    it('should measure stage duration and handle cancellation', async () => {
      const slowStage: IBootstrapStage = {
        id: 'slow',
        name: 'SlowStage',
        description: 'Slow stage',
        execute: async () => {
          await new Promise((res) => setTimeout(res, 20));
        },
      };

      const pipeline = new BootstrapPipeline([slowStage]);
      const result = await pipeline.execute(context);

      expect(result.status).toBe('Success');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(15);
      expect(result.stageResults[0].durationMs).toBeGreaterThanOrEqual(15);

      // Cancel context
      context.isCancelled = true;
      const cancelResult = await pipeline.execute(context);
      expect(cancelResult.status).toBe('Aborted');
    });
  });
});
