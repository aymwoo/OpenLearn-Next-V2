import React, { useState, useEffect } from 'react';
import { X, Cpu, Radio, Cast, CheckCircle, Terminal, Play } from 'lucide-react';
import { hardwareBridgeService } from './hardware-bridge-service';
import type { HardwareEvent } from '../types';

export interface HardwareBridgeSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function HardwareBridgeSettingsModal({ isOpen, onClose, addToast }: HardwareBridgeSettingsModalProps) {
  const [eventLogs, setEventLogs] = useState<HardwareEvent[]>([]);
  const [simEnabled, setSimEnabled] = useState(true);

  useEffect(() => {
    hardwareBridgeService.enableKeyboardSimulation(simEnabled);
    const unsub = hardwareBridgeService.subscribe((event) => {
      setEventLogs((prev) => [event, ...prev].slice(0, 20));
    });
    return () => unsub();
  }, [simEnabled]);

  if (!isOpen) return null;

  const handleSimulateClicker = (option: string) => {
    hardwareBridgeService.dispatchRawInput({
      deviceId: 'clicker-rf-001',
      deviceType: 'RF_CLICKER',
      keyOrAction: option,
    });
    addToast('模拟硬件触发', `物理答题器发送选项: ${option}`, 'info');
  };

  const handleSimulatePresenter = (action: 'next' | 'prev' | 'laser') => {
    hardwareBridgeService.dispatchRawInput({
      deviceId: 'presenter-pen-01',
      deviceType: 'PRESENTER_PEN',
      keyOrAction: action,
    });
    addToast('模拟翻页笔', `触发翻页动作: ${action}`, 'info');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface border border-theme rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-theme pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary-theme/10 text-primary-theme flex items-center justify-center">
              <Cpu size={18} />
            </div>
            <div>
              <h3 className="text-sm font-black text-main">硬件教具生态标准化网关 (Hardware Bridge)</h3>
              <p className="text-xs text-muted">RF433/2.4G 物理答题器、数位板与翻页笔统一映射</p>
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

        {/* 虚拟自检与模拟触发 */}
        <div className="p-4 rounded-xl bg-surface-secondary border border-theme flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-main flex items-center gap-1.5">
              <Radio size={14} className="text-emerald-500 animate-pulse" />
              <span>硬件按键自检与虚拟调试模拟器</span>
            </span>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={simEnabled}
                onChange={(e) => setSimEnabled(e.target.checked)}
                className="rounded text-primary-theme"
              />
              <span>启用键盘快捷键仿真</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 模拟答题器按键 */}
            <div className="p-3 rounded-lg bg-surface border border-theme/80 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted">模拟学生物理答题器</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {['A', 'B', 'C', 'D'].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSimulateClicker(opt)}
                    className="px-2.5 py-1 text-xs font-black rounded-lg bg-primary-theme/10 hover:bg-primary-theme hover:text-white text-primary-theme border border-primary-theme/20 transition-all cursor-pointer"
                  >
                    按键 {opt}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleSimulateClicker('BUZZER')}
                  className="px-2.5 py-1 text-xs font-black rounded-lg bg-amber-500/10 hover:bg-amber-500 hover:text-white text-amber-600 border border-amber-500/20 transition-all cursor-pointer"
                >
                  抢答键
                </button>
              </div>
            </div>

            {/* 模拟翻页笔 */}
            <div className="p-3 rounded-lg bg-surface border border-theme/80 flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted">模拟教师无线翻页笔</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleSimulatePresenter('prev')}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main cursor-pointer"
                >
                  ◀ 上一页
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatePresenter('next')}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main cursor-pointer"
                >
                  下一页 ▶
                </button>
                <button
                  type="button"
                  onClick={() => handleSimulatePresenter('laser')}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500 hover:text-white border border-rose-500/20 cursor-pointer"
                >
                  🔴 激光笔
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 实时硬件事件捕获日志 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-bold text-muted">
            <span className="flex items-center gap-1">
              <Terminal size={12} />
              <span>底层硬件事件标准化总线监控</span>
            </span>
            <span>{eventLogs.length} 条已捕获事件</span>
          </div>

          <div className="p-2.5 rounded-xl bg-black/80 font-mono text-[11px] text-emerald-400 h-40 overflow-y-auto flex flex-col gap-1 border border-theme">
            {eventLogs.length === 0 ? (
              <span className="text-zinc-500 italic p-2">等待硬件信号接入中...</span>
            ) : (
              eventLogs.map((log, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-zinc-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  <span className="text-amber-300">[{log.deviceType}]</span>
                  <span className="text-sky-300">{log.action}</span>
                  <span className="text-white">值: {String(log.value)}</span>
                  {log.studentNumber && <span className="text-zinc-400">(学号:{log.studentNumber})</span>}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-theme">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-surface hover:bg-surface-secondary border border-theme text-main rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
}
