import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Square,
  Sparkles,
  Layers,
  Clock,
  CheckCircle2,
  Terminal,
  Activity,
} from 'lucide-react';
import { classroomMacroEngine } from './classroom-macro-engine';
import { CLASSROOM_MACRO_PRESETS } from './macro-presets';
import type { MacroPreset, MacroExecutionState, MacroId } from '../types';

export interface ClassroomMacroRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomMacroRunnerModal({ isOpen, onClose, addToast }: ClassroomMacroRunnerModalProps) {
  const [selectedMacroId, setSelectedMacroId] = useState<MacroId>('MACRO_BURST_QUIZ');
  const [state, setState] = useState<MacroExecutionState>(classroomMacroEngine.getState());

  useEffect(() => {
    const unsub = classroomMacroEngine.subscribe((s) => {
      setState(s);
    });
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const currentPreset = CLASSROOM_MACRO_PRESETS.find((p) => p.id === selectedMacroId) || CLASSROOM_MACRO_PRESETS[0];
  const isRunning = state.status === 'running';

  const handleRun = async () => {
    addToast('教学动作流启动', `正在执行宏动作: ${currentPreset.name}`, 'info');
    const success = await classroomMacroEngine.runMacro(selectedMacroId);
    if (success) {
      addToast('✓ 教学宏动作执行完成', `${currentPreset.name} 所有流水线步骤已全部落实。`, 'success');
    }
  };

  const handleAbort = () => {
    classroomMacroEngine.abortCurrentMacro();
    addToast('已中止宏动作', '当前流水线操作已停止。', 'warning');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface border border-theme rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary-theme/10 text-primary-theme flex items-center justify-center font-bold">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-main flex items-center gap-2">
                <span>课堂宏动作编排中枢 (Classroom Action Macros)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary-theme/10 text-primary-theme">
                  一键教学流
                </span>
              </h3>
              <p className="text-xs text-muted">自定义与预设一键动作流：倒计时、锁屏推题、切榜单无缝联动</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-main hover:bg-surface-secondary cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 预设宏卡片选择 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {CLASSROOM_MACRO_PRESETS.map((macro) => {
            const isSelected = macro.id === selectedMacroId;
            return (
              <button
                key={macro.id}
                type="button"
                disabled={isRunning}
                onClick={() => setSelectedMacroId(macro.id)}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between gap-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-primary-theme bg-primary-theme/5 ring-1 ring-primary-theme shadow-xs'
                    : 'border-theme bg-surface hover:bg-surface-secondary/60'
                } disabled:opacity-50`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xl">{macro.icon}</span>
                  <span className="text-[10px] font-mono text-muted flex items-center gap-1">
                    <Clock size={10} />
                    <span>~{macro.estimatedSeconds}s</span>
                  </span>
                </div>
                <div>
                  <h4 className="text-xs font-black text-main">{macro.name}</h4>
                  <p className="text-[10px] text-muted line-clamp-2 mt-0.5">{macro.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* 选中宏的流水线步骤拆解 */}
        <div className="p-4 rounded-xl bg-surface-secondary border border-theme flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-main flex items-center gap-1.5">
              <Layers size={14} className="text-primary-theme" />
              <span>动作流水线拆解 ({currentPreset.steps.length} 个原子动作)</span>
            </span>

            {isRunning && (
              <span className="text-xs font-mono font-bold text-primary-theme animate-pulse">
                执行中 · {state.progressPercent}%
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {currentPreset.steps.map((step, idx) => {
              const isDone = isRunning && idx < state.currentStepIndex;
              const isCurrent = isRunning && idx === state.currentStepIndex;
              return (
                <div
                  key={step.id}
                  className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
                    isCurrent
                      ? 'border-primary-theme bg-primary-theme/10 text-main font-bold shadow-2xs'
                      : isDone
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-muted'
                        : 'border-theme bg-surface text-muted'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${
                        isCurrent
                          ? 'bg-primary-theme text-white animate-spin'
                          : isDone
                            ? 'bg-emerald-500 text-white'
                            : 'bg-surface-secondary text-muted'
                      }`}
                    >
                      {isDone ? '✓' : idx + 1}
                    </span>
                    <div>
                      <div className="text-main font-bold">{step.title}</div>
                      <div className="text-[10px] text-muted">{step.description}</div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-theme">
                    {step.actionType}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 控制台日志 */}
        {state.logMessages.length > 0 && (
          <div className="p-2.5 rounded-xl bg-black/80 font-mono text-[11px] text-sky-400 h-24 overflow-y-auto border border-theme flex flex-col gap-0.5">
            {state.logMessages.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        )}

        {/* 底部动作控制 */}
        <div className="flex items-center justify-between pt-2 border-t border-theme">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-surface hover:bg-surface-secondary border border-theme text-main rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            关闭窗口
          </button>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <button
                type="button"
                id="btn-abort-macro"
                onClick={handleAbort}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Square size={13} />
                <span>中止执行</span>
              </button>
            ) : (
              <button
                type="button"
                id="btn-execute-macro"
                onClick={handleRun}
                className="px-4 py-2 bg-primary-theme hover:bg-primary-theme-hover text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Play size={13} />
                <span>立即一键执行宏动作</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
