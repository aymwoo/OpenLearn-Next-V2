import type { MacroPreset, MacroExecutionState, MacroId } from '../types';
import { CLASSROOM_MACRO_PRESETS } from './macro-presets';

export type MacroStateListener = (state: MacroExecutionState) => void;
export type MacroStepExecutor = (step: MacroPreset['steps'][0]) => Promise<boolean | void>;

export class ClassroomMacroEngine {
  private static instance: ClassroomMacroEngine | null = null;
  private currentMacro: MacroPreset | null = null;
  private state: MacroExecutionState = {
    macroId: 'MACRO_BURST_QUIZ',
    status: 'idle',
    currentStepIndex: 0,
    progressPercent: 0,
    stepStartTime: 0,
    totalSteps: 0,
    logMessages: [],
  };
  private listeners: Set<MacroStateListener> = new Set();
  private stepExecutor: MacroStepExecutor | null = null;
  private isAborted: boolean = false;

  private constructor() {}

  public static getInstance(): ClassroomMacroEngine {
    if (!ClassroomMacroEngine.instance) {
      ClassroomMacroEngine.instance = new ClassroomMacroEngine();
    }
    return ClassroomMacroEngine.instance;
  }

  public setStepExecutor(executor: MacroStepExecutor): void {
    this.stepExecutor = executor;
  }

  public getPresetById(macroId: MacroId): MacroPreset | undefined {
    return CLASSROOM_MACRO_PRESETS.find((p) => p.id === macroId);
  }

  public async runMacro(macroId: MacroId): Promise<boolean> {
    const preset = this.getPresetById(macroId);
    if (!preset) return false;

    this.currentMacro = preset;
    this.isAborted = false;
    this.state = {
      macroId,
      status: 'running',
      currentStepIndex: 0,
      progressPercent: 0,
      stepStartTime: Date.now(),
      totalSteps: preset.steps.length,
      logMessages: [`[${new Date().toLocaleTimeString()}] 启动宏动作流: ${preset.name}`],
    };
    this.notify();

    for (let i = 0; i < preset.steps.length; i++) {
      if (this.isAborted) {
        this.state.status = 'aborted';
        this.state.logMessages.push(`[${new Date().toLocaleTimeString()}] 宏动作流被教师手动中止`);
        this.notify();
        return false;
      }

      const step = preset.steps[i];
      this.state.currentStepIndex = i;
      this.state.progressPercent = Math.round(((i + 1) / preset.steps.length) * 100);
      this.state.logMessages.push(
        `[${new Date().toLocaleTimeString()}] 执行步骤 ${i + 1}/${preset.steps.length}: ${step.title}`,
      );
      this.notify();

      if (this.stepExecutor) {
        try {
          await this.stepExecutor(step);
        } catch (err: any) {
          this.state.logMessages.push(`[${new Date().toLocaleTimeString()}] 步骤执行异常: ${err?.message}`);
        }
      }
    }

    this.state.status = 'completed';
    this.state.logMessages.push(`[${new Date().toLocaleTimeString()}] 宏动作流编排全部执行完成 ✓`);
    this.notify();
    return true;
  }

  public abortCurrentMacro(): void {
    if (this.state.status === 'running') {
      this.isAborted = true;
      this.state.status = 'aborted';
      this.notify();
    }
  }

  public reset(): void {
    this.isAborted = false;
    this.currentMacro = null;
    this.state = {
      macroId: 'MACRO_BURST_QUIZ',
      status: 'idle',
      currentStepIndex: 0,
      progressPercent: 0,
      stepStartTime: 0,
      totalSteps: 0,
      logMessages: [],
    };
    this.notify();
  }

  public getState(): MacroExecutionState {
    return { ...this.state };
  }

  public subscribe(listener: MacroStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const s = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(s);
      } catch (err) {
        console.error('Error in macro state listener:', err);
      }
    });
  }
}

export const classroomMacroEngine = ClassroomMacroEngine.getInstance();
