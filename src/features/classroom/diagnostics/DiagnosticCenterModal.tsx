/**
 * DiagnosticCenterModal — 课堂异常告警中心（in-class）
 *
 * 上课流程扩展 #3：复用 useErrorStore.studentErrors 已有数据，
 * 提供"本机异常 / 学生端异常"双标签、集中可视化、单个清除、
 * 复制全部 ID 给 IT 排查（占位字段留扩展点）。
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  X,
  Copy,
  Trash2,
  AlertTriangle,
  AlertOctagon,
  Info,
  RefreshCw,
  Cpu,
  Users,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { useErrorStore } from '../../../store/errorStore';
import type { SystemErrorItem, StudentErrorItem, SystemErrorType } from '../../../types/error';

// ── 类型 ────────────────────────────────────────────────────────────

// 真实类型来自 src/types/error.ts：SystemErrorType = 'react' | 'promise' | 'runtime' | 'api' | 'custom'
const ERROR_TYPE_COLOR: Record<SystemErrorType, 'rose' | 'amber' | 'blue'> = {
  react: 'rose',
  promise: 'rose',
  runtime: 'rose',
  api: 'amber',
  custom: 'blue',
};

export interface DiagnosticCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

// ── 主组件 ──────────────────────────────────────────────────────────

export const DiagnosticCenterModal: React.FC<DiagnosticCenterModalProps> = ({
  isOpen,
  onClose,
  addToast,
  lang = 'zh',
}) => {
  const errors = useErrorStore((s) => s.errors);
  const studentErrors = useErrorStore((s) => s.studentErrors);
  const removeError = useErrorStore((s) => s.removeError);
  const removeStudentError = useErrorStore((s) => s.removeStudentError);
  const clearErrors = useErrorStore((s) => s.clearErrors);
  const clearStudentErrors = useErrorStore((s) => s.clearStudentErrors);

  const [activeTab, setActiveTab] = useState<'student' | 'local'>('student');
  const [filterType, setFilterType] = useState<'all' | SystemErrorType>('all');

  // 默认切到"学生端"标签（用户最关心）
  useEffect(() => {
    if (isOpen && studentErrors.length > 0) {
      setActiveTab('student');
    }
  }, [isOpen, studentErrors.length]);

  const filteredStudentErrors = useMemo(
    () =>
      studentErrors.filter((e) => filterType === 'all' || e.type === filterType),
    [studentErrors, filterType],
  );
  const filteredLocalErrors = useMemo(
    () => errors.filter((e) => filterType === 'all' || e.type === filterType),
    [errors, filterType],
  );

  const copyAllStudentIds = useCallback(() => {
    const ids = Array.from(new Set(studentErrors.map((e) => e.studentId))).join(', ');
    if (!ids) {
      addToast(lang === 'zh' ? '暂无学生 ID' : 'No student IDs', '', 'warning');
      return;
    }
    navigator.clipboard.writeText(ids).then(
      () => addToast(lang === 'zh' ? '已复制学生 ID 列表' : 'Copied student IDs', '', 'success'),
      () => addToast(lang === 'zh' ? '复制失败' : 'Copy failed', '', 'error'),
    );
  }, [studentErrors, addToast, lang]);

  if (!isOpen) return null;

  const currentList = activeTab === 'student' ? filteredStudentErrors : filteredLocalErrors;
  const totalCount = activeTab === 'student' ? studentErrors.length : errors.length;

  return (
    <div className="fixed inset-0 z-[115] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
              <AlertOctagon size={20} className="text-rose-600" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-main">
                {lang === 'zh' ? '课堂异常告警中心' : 'Classroom Diagnostic Center'}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {lang === 'zh' ? '实时监控教师/学生端异常' : 'Real-time teacher & student error monitoring'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-main transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <div className="px-6 pt-3 flex items-center gap-1 border-b border-theme shrink-0">
          <TabButton
            active={activeTab === 'student'}
            onClick={() => setActiveTab('student')}
            icon={<Users size={12} />}
            label={lang === 'zh' ? '学生端异常' : 'Student'}
            count={studentErrors.length}
            accent="rose"
          />
          <TabButton
            active={activeTab === 'local'}
            onClick={() => setActiveTab('local')}
            icon={<Cpu size={12} />}
            label={lang === 'zh' ? '本机异常' : 'Local'}
            count={errors.length}
            accent="amber"
          />
          <ExtensionPointRenderer slot="classroom.diagnostic.feed" />
        </div>

        {/* ── Filter + Toolbar ────────────────────────────── */}
        <div className="px-6 py-3 flex items-center justify-between border-b border-theme shrink-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted">{lang === 'zh' ? '筛选' : 'Filter'}:</span>
            {(['all', 'react', 'runtime', 'promise', 'api', 'custom'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilterType(t)}
                className={`px-2 py-1 rounded font-bold ${
                  filterType === t ? 'bg-primary-theme text-white' : 'bg-surface-secondary text-main'
                }`}
              >
                {t === 'all' ? (lang === 'zh' ? '全部' : 'All') : t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'student' && (
              <button
                onClick={copyAllStudentIds}
                className="px-2.5 py-1 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface transition-colors flex items-center gap-1.5"
              >
                <Copy size={12} />
                {lang === 'zh' ? '复制所有学生 ID' : 'Copy all IDs'}
              </button>
            )}
            <button
              onClick={() =>
                activeTab === 'student' ? clearStudentErrors() : clearErrors()
              }
              disabled={totalCount === 0}
              className="px-2.5 py-1 text-xs font-bold rounded-lg border border-rose-500 text-rose-600 hover:bg-rose-50 transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={12} />
              {lang === 'zh' ? '清空' : 'Clear'}
            </button>
          </div>
        </div>

        {/* ── Error List ──────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-4 space-y-2">
          {currentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted">
              <AlertTriangle size={32} className="opacity-30 mb-2" />
              <p className="text-sm">
                {activeTab === 'student'
                  ? lang === 'zh'
                    ? '暂无学生端异常'
                    : 'No student errors'
                  : lang === 'zh'
                  ? '暂无本机异常'
                  : 'No local errors'}
              </p>
            </div>
          ) : (
            currentList.map((err) =>
              activeTab === 'student' ? (
                <StudentErrorRow
                  key={err.id}
                  error={err as StudentErrorItem}
                  onRemove={() => removeStudentError(err.id)}
                  lang={lang}
                />
              ) : (
                <LocalErrorRow
                  key={err.id}
                  error={err as SystemErrorItem}
                  onRemove={() => removeError(err.id)}
                  lang={lang}
                />
              ),
            )
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-3 border-t border-theme text-xs text-muted flex items-center justify-between shrink-0">
          <span>
            {totalCount > 0
              ? lang === 'zh'
                ? `共 ${totalCount} 条异常`
                : `${totalCount} total`
              : lang === 'zh'
              ? '一切正常'
              : 'All clear'}
          </span>
          <button
            onClick={() => {
              // 触发学生端错误上报刷新（hook 内部 setErrors）
              // 这里只更新本地视图，不发请求
              addToast(
                lang === 'zh' ? '已刷新' : 'Refreshed',
                lang === 'zh' ? '本机列表' : 'Local list',
                'info',
              );
            }}
            className="inline-flex items-center gap-1 text-muted hover:text-main transition-colors"
          >
            <RefreshCw size={10} />
            {lang === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── 子组件 ──────────────────────────────────────────────────────────

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  accent: 'rose' | 'amber';
}> = ({ active, onClick, icon, label, count, accent }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 ${
      active
        ? accent === 'rose'
          ? 'bg-surface text-rose-600 border-b-2 border-rose-500'
          : 'bg-surface text-amber-600 border-b-2 border-amber-500'
        : 'text-muted hover:text-main'
    }`}
  >
    {icon}
    {label}
    {count > 0 && (
      <span
        className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
          active
            ? accent === 'rose'
              ? 'bg-rose-500 text-white'
              : 'bg-amber-500 text-white'
            : 'bg-surface text-muted'
        }`}
      >
        {count}
      </span>
    )}
  </button>
);

const StudentErrorRow: React.FC<{
  error: StudentErrorItem;
  onRemove: () => void;
  lang: 'zh' | 'en';
}> = ({ error, onRemove, lang }) => {
  const tone = ERROR_TYPE_COLOR[error.type] ?? 'blue';
  const Icon = tone === 'rose' ? AlertOctagon : tone === 'amber' ? AlertTriangle : Info;
  const color =
    tone === 'rose'
      ? 'border-rose-500 bg-rose-50'
      : tone === 'amber'
      ? 'border-amber-500 bg-amber-50'
      : 'border-blue-500 bg-blue-50';
  const iconColor =
    tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-blue-600';

  return (
    <div className={`border-l-4 ${color} rounded-lg p-3 flex items-start gap-3 bg-surface`}>
      <Icon size={16} className={`${iconColor} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-sm text-main">{error.studentName ?? error.studentId}</span>
          <span className="text-[10px] text-muted font-mono">{error.studentId}</span>
          <span className="text-[10px] text-muted">
            {new Date(error.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-xs font-bold text-main mb-1">{error.title}</div>
        <div className="text-xs text-muted line-clamp-2">{error.message}</div>
      </div>
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-surface text-muted hover:text-rose-600 transition-colors shrink-0"
        title={lang === 'zh' ? '移除' : 'Remove'}
      >
        <X size={14} />
      </button>
    </div>
  );
};

const LocalErrorRow: React.FC<{
  error: SystemErrorItem;
  onRemove: () => void;
  lang: 'zh' | 'en';
}> = ({ error, onRemove, lang }) => {
  const tone = ERROR_TYPE_COLOR[error.type] ?? 'blue';
  const Icon = tone === 'rose' ? AlertOctagon : tone === 'amber' ? AlertTriangle : Info;
  const color =
    tone === 'rose'
      ? 'border-rose-500 bg-rose-50'
      : tone === 'amber'
      ? 'border-amber-500 bg-amber-50'
      : 'border-blue-500 bg-blue-50';
  const iconColor =
    tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-blue-600';

  return (
    <div className={`border-l-4 ${color} rounded-lg p-3 flex items-start gap-3 bg-surface`}>
      <Icon size={16} className={`${iconColor} mt-0.5 shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-bold text-sm text-main">{error.title}</span>
          {error.endpoint && <span className="text-[10px] text-muted">[{error.endpoint}]</span>}
          <span className="text-[10px] text-muted">
            {new Date(error.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="text-xs text-muted line-clamp-3">{error.message}</div>
      </div>
      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-surface text-muted hover:text-rose-600 transition-colors shrink-0"
        title={lang === 'zh' ? '移除' : 'Remove'}
      >
        <X size={14} />
      </button>
    </div>
  );
};