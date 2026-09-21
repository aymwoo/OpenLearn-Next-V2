import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  Copy,
  Check,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Bug,
  GraduationCap,
  Laptop,
} from 'lucide-react';
import {
  useErrorStore,
  formatBatchErrorReport,
  formatSingleErrorReport,
  formatSingleStudentErrorReport,
} from '../../store/errorStore';
import { useAppStore } from '../../store/appStore';
import { copyToClipboard } from '../../utils/clipboard';
import type { SystemErrorItem, StudentErrorItem } from '../../types/error';

export function SystemErrorCenterModal() {
  const session = useAppStore((s) => s.session);
  const isStudentLiveMode =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('mode') === 'student_live' ||
      window.location.hash.includes('student_live'));
  const isStudent = session?.role === 'student' || isStudentLiveMode;

  const errors = useErrorStore((s) => s.errors);
  const studentErrors = useErrorStore((s) => s.studentErrors);
  const activeTab = useErrorStore((s) => s.activeTab);
  const setActiveTab = useErrorStore((s) => s.setActiveTab);
  const isOpen = useErrorStore((s) => s.isErrorCenterOpen);
  const setIsOpen = useErrorStore((s) => s.setIsErrorCenterOpen);
  const clearErrors = useErrorStore((s) => s.clearErrors);
  const clearStudentErrors = useErrorStore((s) => s.clearStudentErrors);
  const removeError = useErrorStore((s) => s.removeError);
  const removeStudentError = useErrorStore((s) => s.removeStudentError);

  const [copiedBatch, setCopiedBatch] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isPillDismissed, setIsPillDismissed] = useState(false);

  const totalErrors = errors.length + (isStudent ? 0 : studentErrors.length);
  const hasAnyErrors = errors.length > 0 || (!isStudent && studentErrors.length > 0);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyAll = async () => {
    const markdown = formatBatchErrorReport(errors, isStudent ? [] : studentErrors);
    const success = await copyToClipboard(markdown);
    if (success) {
      setCopiedBatch(true);
      setTimeout(() => setCopiedBatch(false), 2500);
    }
  };

  const handleCopyItem = async (e: React.MouseEvent, item: SystemErrorItem | StudentErrorItem, isStudentErr = false) => {
    e.stopPropagation();
    const markdown = isStudentErr
      ? formatSingleStudentErrorReport(item as StudentErrorItem)
      : formatSingleErrorReport(item);
    const success = await copyToClipboard(markdown);
    if (success) {
      setCopiedItemId(item.id);
      setTimeout(() => setCopiedItemId(null), 2500);
    }
  };

  const getTypeBadge = (type: SystemErrorItem['type']) => {
    switch (type) {
      case 'react':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
            React
          </span>
        );
      case 'api':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
            API 5xx
          </span>
        );
      case 'promise':
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            Promise
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
            Runtime
          </span>
        );
    }
  };

  return (
    <>
      {/* 1. Floating Diagnostics Indicator (Minimal Icon Badge for Students; Detailed Pill for Teachers/Admins) */}
      {hasAnyErrors && !isOpen && !isPillDismissed && (
        isStudent ? (
          // 学生端极简模式：仅显示感叹号图标 + 红色数字角标，降低干扰
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed bottom-5 left-5 z-40 w-8 h-8 rounded-full bg-slate-900/80 hover:bg-slate-900 text-rose-400 border border-rose-500/40 shadow-lg flex items-center justify-center cursor-pointer transition-all hover:scale-105 select-none"
            onClick={() => setIsOpen(true)}
            id="system-error-pill"
            title={`系统状态提示: ${errors.length} 处异常`}
          >
            <AlertTriangle size={15} />
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center leading-none shadow-xs border border-slate-900">
              {errors.length}
            </span>
          </motion.button>
        ) : (
          // 教师端/管理员端常规模式：完整信息胶囊
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-5 left-5 z-40 flex items-center gap-2 bg-slate-900/90 hover:bg-slate-900 backdrop-blur-md text-white px-3.5 py-2 rounded-2xl shadow-xl border border-rose-500/40 cursor-pointer select-none transition-all group"
            onClick={() => {
              if (errors.length === 0 && studentErrors.length > 0) {
                setActiveTab('student');
              }
              setIsOpen(true);
            }}
            id="system-error-pill"
          >
            <div className="relative flex items-center justify-center">
              <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </div>
            <AlertTriangle size={15} className="text-rose-400 group-hover:scale-110 transition-transform" />
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <span>捕获到</span>
              <span className="bg-rose-500/80 text-white font-mono px-1.5 py-0.2 rounded-md text-xs font-bold">
                {totalErrors}
              </span>
              <span>处系统异常</span>
              {studentErrors.length > 0 && (
                <span className="text-[10px] text-rose-300 font-normal">
                  (含学生端 {studentErrors.length})
                </span>
              )}
            </div>
            <button
              type="button"
              className="text-xs font-bold text-rose-300 hover:text-white bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-lg transition-colors ml-1"
            >
              查看与复制
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsPillDismissed(true);
              }}
              className="text-gray-400 hover:text-gray-200 p-0.5 hover:bg-white/10 rounded transition-colors ml-0.5"
              title="暂时隐藏胶囊"
            >
              <X size={13} />
            </button>
          </motion.div>
        )
      )}

      {/* 2. System Diagnostics Modal Dialog */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-hidden select-text">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden text-gray-900 dark:text-gray-100"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gray-50/80 dark:bg-slate-850/80 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl">
                    <Bug size={18} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold flex items-center gap-2">
                        <span>系统异常诊断中心 (System Diagnostics)</span>
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                          ({totalErrors} 项记录)
                        </span>
                      </h2>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      自动捕获运行时、Promise 及接口 5xx 异常，支持一键导出 Markdown 格式排查报告。
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyAll}
                    disabled={totalErrors === 0}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer ${
                      copiedBatch
                        ? 'bg-emerald-600 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                    title="复制所有异常报告为 Markdown 文本"
                  >
                    {copiedBatch ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedBatch ? '已复制全部！' : '一键复制全部诊断日志'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!isStudent && activeTab === 'student') {
                        clearStudentErrors();
                      } else {
                        clearErrors();
                      }
                    }}
                    disabled={activeTab === 'student' ? studentErrors.length === 0 : errors.length === 0}
                    className="p-1.5 text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    title={activeTab === 'student' ? '清空学生端异常记录' : '清空记录'}
                  >
                    <Trash2 size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Teacher/Admin Tabs: 本机异常 vs 学生端异常 */}
              {!isStudent && (
                <div className="px-5 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-slate-900/50 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('local')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'local'
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-gray-200 dark:border-gray-700'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
                    }`}
                  >
                    <Laptop size={13} />
                    <span>本机异常 ({errors.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('student')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      activeTab === 'student'
                        ? 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-xs border border-gray-200 dark:border-gray-700'
                        : 'text-gray-500 hover:text-gray-800 dark:text-gray-400'
                    }`}
                  >
                    <GraduationCap size={14} />
                    <span>学生端异常 ({studentErrors.length})</span>
                    {studentErrors.length > 0 && (
                      <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    )}
                  </button>
                </div>
              )}

              {/* Error List Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 bg-slate-50/50 dark:bg-slate-950/30">
                {/* 1. Student Errors Tab View (Teacher / Admin) */}
                {!isStudent && activeTab === 'student' ? (
                  studentErrors.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 dark:text-gray-500 space-y-2">
                      <Check size={32} className="mx-auto text-emerald-500 opacity-80" />
                      <p className="text-sm font-semibold">暂无学生端上报的系统异常</p>
                      <p className="text-xs opacity-75">全班学生端运行良好，未发生未捕获的前端崩溃或接口 5xx 故障。</p>
                    </div>
                  ) : (
                    studentErrors.map((item, index) => {
                      const isExpanded = expandedIds.has(item.id);
                      const isCopied = copiedItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-2xs hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
                        >
                          {/* Item Summary Bar */}
                          <div
                            onClick={() => toggleExpand(item.id)}
                            className="px-4 py-3 flex items-start justify-between gap-3 cursor-pointer select-none hover:bg-gray-50/50 dark:hover:bg-slate-850/50 transition-colors"
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <span className="text-gray-400 mt-0.5 shrink-0">
                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </span>
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1">
                                    <GraduationCap size={11} />
                                    <span>{item.studentName || item.studentId}</span>
                                  </span>
                                  {getTypeBadge(item.type)}
                                  <span className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">
                                    #{studentErrors.length - index} {item.title}
                                  </span>
                                  <span className="text-xs text-gray-400 font-mono">
                                    {new Date(item.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-xs text-rose-600 dark:text-rose-400 font-mono break-all line-clamp-2">
                                  {item.message}
                                </p>
                                <div className="flex items-center gap-3 text-xs text-gray-500 font-mono truncate">
                                  <span>学生学号/ID: {item.studentId}</span>
                                  {item.lessonId && <span>课节: {item.lessonId}</span>}
                                  {item.classId && <span>班级: {item.classId}</span>}
                                  {item.endpoint && <span>接口: {item.endpoint}</span>}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => handleCopyItem(e, item, true)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                  isCopied
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-gray-200'
                                }`}
                                title="一键复制此条学生错误报告"
                              >
                                {isCopied ? <Check size={11} /> : <Copy size={11} />}
                                <span>{isCopied ? '已复制' : '复制'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeStudentError(item.id);
                                }}
                                className="p-1 text-gray-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                title="移除此项"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Expandable Stack Trace & Environment Details */}
                          {isExpanded && (
                            <div className="px-4 py-3 bg-slate-900 text-slate-200 border-t border-gray-100 dark:border-gray-800 text-xs font-mono space-y-2.5">
                              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-1.5">
                                <span>学生: {item.studentName || '未知'} ({item.studentId})</span>
                                <span>页面地址: {item.url || '未知'}</span>
                                <span>时间: {new Date(item.timestamp).toLocaleString()}</span>
                              </div>

                              {item.stack && (
                                <div>
                                  <span className="text-rose-400 font-bold block mb-1">Stack Trace:</span>
                                  <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-48 overflow-y-auto opacity-90">
                                    {item.stack}
                                  </pre>
                                </div>
                              )}

                              {item.componentStack && (
                                <div className="pt-2 border-t border-slate-800">
                                  <span className="text-amber-400 font-bold block mb-1">Component Stack:</span>
                                  <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-36 overflow-y-auto opacity-80">
                                    {item.componentStack}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )
                ) : (
                  /* 2. Local Errors Tab View */
                  errors.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 dark:text-gray-500 space-y-2">
                      <Check size={32} className="mx-auto text-emerald-500 opacity-80" />
                      <p className="text-sm font-semibold">暂无捕获到的系统异常</p>
                      <p className="text-xs opacity-75">系统运行顺畅，所有模块均在正常状态下运作。</p>
                    </div>
                  ) : (
                    errors.map((item, index) => {
                      const isExpanded = expandedIds.has(item.id);
                      const isCopied = copiedItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-2xs hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
                        >
                          {/* Item Summary Bar */}
                          <div
                            onClick={() => toggleExpand(item.id)}
                            className="px-4 py-3 flex items-start justify-between gap-3 cursor-pointer select-none hover:bg-gray-50/50 dark:hover:bg-slate-850/50 transition-colors"
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <span className="text-gray-400 mt-0.5 shrink-0">
                                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                              </span>
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {getTypeBadge(item.type)}
                                  <span className="font-bold text-xs text-gray-900 dark:text-gray-100 truncate">
                                    #{errors.length - index} {item.title}
                                  </span>
                                  <span className="text-xs text-gray-400 font-mono">
                                    {new Date(item.timestamp).toLocaleTimeString()}
                                  </span>
                                </div>
                                <p className="text-xs text-rose-600 dark:text-rose-400 font-mono break-all line-clamp-2">
                                  {item.message}
                                </p>
                                {item.endpoint && (
                                  <p className="text-xs text-gray-500 font-mono truncate">接口: {item.endpoint}</p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => handleCopyItem(e, item, false)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                  isCopied
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-gray-200'
                                }`}
                                title="一键复制此条错误报告"
                              >
                                {isCopied ? <Check size={11} /> : <Copy size={11} />}
                                <span>{isCopied ? '已复制' : '复制'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeError(item.id);
                                }}
                                className="p-1 text-gray-400 hover:text-rose-600 rounded transition-colors cursor-pointer"
                                title="移除此项"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Expandable Stack Trace & Environment Details */}
                          {isExpanded && (
                            <div className="px-4 py-3 bg-slate-900 text-slate-200 border-t border-gray-100 dark:border-gray-800 text-xs font-mono space-y-2.5">
                              <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-1.5">
                                <span>页面地址: {item.url || '未知'}</span>
                                <span>时间: {new Date(item.timestamp).toLocaleString()}</span>
                              </div>

                              {item.stack && (
                                <div>
                                  <span className="text-rose-400 font-bold block mb-1">Stack Trace:</span>
                                  <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-48 overflow-y-auto opacity-90">
                                    {item.stack}
                                  </pre>
                                </div>
                              )}

                              {item.componentStack && (
                                <div className="pt-2 border-t border-slate-800">
                                  <span className="text-amber-400 font-bold block mb-1">Component Stack:</span>
                                  <pre className="whitespace-pre-wrap text-xs leading-relaxed max-h-36 overflow-y-auto opacity-80">
                                    {item.componentStack}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

