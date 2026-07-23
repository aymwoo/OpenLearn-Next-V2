/**
 * OpenLearn Platform Kernel - Pipeline Types & Events (PI-003)
 */

import { PlatformStage } from '../types/index.js';

export type PipelineStatus = 'Success' | 'Failed' | 'Aborted';

export interface StageExecutionResult {
  readonly stageId: string;
  readonly stageName: string;
  readonly durationMs: number;
  readonly status: 'Success' | 'Failed' | 'Skipped';
  readonly error?: Error;
}

export interface PipelineResult {
  readonly totalDurationMs: number;
  readonly status: PipelineStatus;
  readonly stageResults: ReadonlyArray<StageExecutionResult>;
  readonly failedStage?: string;
  readonly error?: Error;
}

export type PipelineDiagnosticEventType =
  | 'PipelineStarted'
  | 'StageStarted'
  | 'StageCompleted'
  | 'StageFailed'
  | 'PipelineCompleted';

export interface PipelineDiagnosticEvent {
  readonly type: PipelineDiagnosticEventType;
  readonly timestamp: number;
  readonly stageName?: string;
  readonly stageId?: string;
  readonly durationMs?: number;
  readonly error?: Error;
}

export type PipelineDiagnosticListener = (event: PipelineDiagnosticEvent) => void;
