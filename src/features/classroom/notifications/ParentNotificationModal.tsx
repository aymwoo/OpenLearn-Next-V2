/**
 * ParentNotificationModal — 家校通知生成器（post-class）
 *
 * 上课流程扩展 #1：从 ClassroomBriefingView 进入，生成全班 Markdown 简报 +
 * 每个学生的家长通知（AI 生成），支持一键复制 / 导出。
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Sparkles,
  Users,
  AlertTriangle,
  FileText,
  RefreshCw,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

// ── 输入数据类型 ──────────────────────────────────────────────────────

export interface ClassSummarySnapshot {
  lessonTitle: string;
  lessonId: string | null;
  className: string;
  classId: string | null;
  startTimeMs: number;
  endTimeMs: number;
  totalStudents: number;
  onlineStudentIds: string[];
  highlights: string[];
  stages: Array<{ stageName: string; plannedMin: number; actualMin: number }>;
  students: Array<{
    id: string;
    name: string;
    student_number?: string;
    participationScore: number;
    quizScore?: number;
    behaviorTags: string[];
    note?: string;
  }>;
}

export interface ParentNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshot: ClassSummarySnapshot;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lang?: 'zh' | 'en';
}

interface StudentNotificationResult {
  studentId: string;
  studentName: string;
  markdown: string;
}

interface GenerateResponse {
  lessonId: string;
  generatedAt: number;
  classMarkdown: string;
  studentNotifications: StudentNotificationResult[];
  counts: { students: number; online: number; highlights: number };
}

// ── 主组件 ──────────────────────────────────────────────────────────

export const ParentNotificationModal: React.FC<ParentNotificationModalProps> = ({
  isOpen,
  onClose,
  snapshot,
  addToast,
  lang = 'zh',
}) => {
  const [response, setResponse] = useState<GenerateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'class' | 'students'>('class');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 构造请求体
  const requestBody = useMemo(() => {
    return {
      lessonTitle: snapshot.lessonTitle,
      className: snapshot.className,
      startTimeMs: snapshot.startTimeMs,
      endTimeMs: snapshot.endTimeMs,
      totalStudents: snapshot.totalStudents,
      onlineCount: snapshot.onlineStudentIds.length,
      highlights: snapshot.highlights,
      stages: snapshot.stages,
      studentReports: snapshot.students.map((s) => ({
        studentId: s.id,
        studentName: s.name,
        online: snapshot.onlineStudentIds.includes(s.id),
        participationScore: s.participationScore,
        quizScore: s.quizScore,
        behaviorTags: s.behaviorTags,
        note: s.note,
      })),
    };
  }, [snapshot]);

  // 自动生成（首次打开时）
  const generate = useCallback(async () => {
    if (!snapshot.lessonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/classroom/${snapshot.lessonId}/parent-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data: GenerateResponse = await res.json();
      setResponse(data);
      addToast(
        lang === 'zh' ? '✅ 通知生成成功' : '✅ Notifications generated',
        `${data.counts.students} ${lang === 'zh' ? '位学生' : 'students'}`,
        'success',
      );
    } catch (e: any) {
      addToast(
        lang === 'zh' ? '❌ 生成失败' : '❌ Generation failed',
        e?.message ?? 'Unknown error',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [snapshot.lessonId, requestBody, addToast, lang]);

  useEffect(() => {
    if (isOpen && !response && !loading) {
      void generate();
    }
  }, [isOpen, response, loading, generate]);

  // 关闭时清空（避免下次打开时残留旧数据）
  useEffect(() => {
    if (!isOpen) {
      setResponse(null);
      setSelectedStudentId(null);
      setCopied(false);
    }
  }, [isOpen]);

  const currentMarkdown =
    activeTab === 'class'
      ? response?.classMarkdown ?? ''
      : response?.studentNotifications.find((n) => n.studentId === selectedStudentId)?.markdown ?? '';

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentMarkdown);
      setCopied(true);
      addToast(
        lang === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard',
        lang === 'zh' ? '可粘贴到微信/邮件' : 'Paste anywhere',
        'success',
      );
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast(lang === 'zh' ? '复制失败' : 'Copy failed', '', 'error');
    }
  }, [currentMarkdown, addToast, lang]);

  const downloadAsMarkdown = useCallback(() => {
    if (!response) return;
    const blob = new Blob(
      [
        response.classMarkdown,
        '\n\n---\n\n',
        response.studentNotifications
          .map((n) => `## ${n.studentName}\n\n${n.markdown}`)
          .join('\n\n---\n\n'),
      ],
      { type: 'text/markdown;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parent-notification-${snapshot.lessonTitle}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [response, snapshot.lessonTitle]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface border border-theme rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-4 border-b border-theme flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-theme/10 flex items-center justify-center">
              <FileText size={20} className="text-primary-theme" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-main">
                {lang === 'zh' ? '家校通知生成器' : 'Parent Notification Generator'}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {snapshot.lessonTitle} · {snapshot.className} ·{' '}
                <span className="inline-flex items-center gap-1">
                  <Users size={10} />
                  {snapshot.totalStudents}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={generate}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              {lang === 'zh' ? '重新生成' : 'Regenerate'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-main transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────── */}
        <div className="px-6 pt-4 flex items-center gap-1 border-b border-theme shrink-0">
          <TabButton
            active={activeTab === 'class'}
            onClick={() => setActiveTab('class')}
            icon={<Sparkles size={12} />}
            label={lang === 'zh' ? '全班简报' : 'Class Summary'}
            count={1}
          />
          <TabButton
            active={activeTab === 'students'}
            onClick={() => setActiveTab('students')}
            icon={<Users size={12} />}
            label={lang === 'zh' ? '逐生通知' : 'Per-Student'}
            count={response?.studentNotifications.length ?? 0}
          />
          <ExtensionPointRenderer slot="classroom.notification.tabs" />
        </div>

        {/* ── Content ─────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex">
          {/* 学生侧栏（仅逐生模式显示） */}
          {activeTab === 'students' && response && (
            <div className="w-64 shrink-0 border-r border-theme bg-surface-secondary overflow-y-auto scrollbar-thin">
              <div className="p-3 space-y-1">
                {response.studentNotifications.map((s) => (
                  <button
                    key={s.studentId}
                    onClick={() => setSelectedStudentId(s.studentId)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                      selectedStudentId === s.studentId
                        ? 'bg-primary-theme text-white shadow-sm'
                        : 'hover:bg-surface text-main'
                    }`}
                  >
                    <div className="font-bold truncate">{s.studentName}</div>
                    <div className="text-[10px] opacity-70 truncate">{s.studentId}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Markdown 内容区 */}
          <div className="flex-1 min-w-0 flex flex-col bg-surface">
            {loading && !response ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted">
                <Sparkles size={32} className="animate-pulse text-primary-theme" />
                <p className="text-sm font-bold">
                  {lang === 'zh' ? 'AI 正在生成家校通知…' : 'AI is generating notifications…'}
                </p>
                <p className="text-xs">
                  {lang === 'zh' ? '通常需要 5-15 秒' : 'Usually takes 5-15s'}
                </p>
              </div>
            ) : activeTab === 'students' && !selectedStudentId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted p-8">
                <Users size={32} className="opacity-30" />
                <p className="text-sm">
                  {lang === 'zh' ? '从左侧选择一位学生查看通知' : 'Select a student from the left'}
                </p>
              </div>
            ) : (
              <pre className="flex-1 min-h-0 overflow-auto scrollbar-thin p-6 text-sm font-mono whitespace-pre-wrap text-main leading-relaxed">
                {currentMarkdown || (lang === 'zh' ? '无内容' : 'No content')}
              </pre>
            )}
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div className="bg-surface-secondary px-6 py-3 border-t border-theme flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-muted flex items-center gap-2">
            {response && (
              <>
                <span>
                  {lang === 'zh' ? '生成时间' : 'Generated'}:{' '}
                  {new Date(response.generatedAt).toLocaleTimeString()}
                </span>
                {response.counts.highlights > 0 && (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Check size={10} />
                    {response.counts.highlights} highlights
                  </span>
                )}
              </>
            )}
            {response === null && !loading && (
              <span className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={12} />
                {lang === 'zh' ? '尚未生成' : 'Not generated'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadAsMarkdown}
              disabled={!response}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download size={12} />
              {lang === 'zh' ? '导出 Markdown' : 'Export MD'}
            </button>
            <button
              onClick={copyToClipboard}
              disabled={!currentMarkdown}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-primary-theme text-white hover:bg-primary-theme-hover disabled:opacity-50'
              }`}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied
                ? lang === 'zh'
                  ? '已复制'
                  : 'Copied'
                : lang === 'zh'
                ? '复制到剪贴板'
                : 'Copy'}
            </button>
          </div>
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
}> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 ${
      active
        ? 'bg-surface text-main border-b-2 border-primary-theme'
        : 'text-muted hover:text-main'
    }`}
  >
    {icon}
    {label}
    {count > 0 && (
      <span
        className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
          active ? 'bg-primary-theme/15 text-primary-theme' : 'bg-surface text-muted'
        }`}
      >
        {count}
      </span>
    )}
  </button>
);