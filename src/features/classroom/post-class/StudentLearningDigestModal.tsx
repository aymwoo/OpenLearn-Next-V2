import React, { useState } from 'react';
import {
  X,
  Award,
  Star,
  Copy,
  Check,
  Share2,
  Sparkles,
  BookOpen,
  MessageSquare,
  UserCheck,
} from 'lucide-react';
import type { StudentPersonalDigest } from './types';

export interface StudentLearningDigestModalProps {
  digest: StudentPersonalDigest | null;
  onClose: () => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function StudentLearningDigestModal({
  digest,
  onClose,
  addToast,
}: StudentLearningDigestModalProps) {
  const [copied, setCopied] = useState(false);
  const [reportText, setReportText] = useState(digest?.parentReportText || '');

  if (!digest) return null;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(reportText)
        .then(() => {
          setCopied(true);
          addToast('✓ 已复制到剪贴板', '家长同步报告文案已复制，可直接发送微信群或家长私信。', 'success');
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          setCopied(true);
          addToast('✓ 内容已就绪', '请直接在文本框中全选复制。', 'info');
          setTimeout(() => setCopied(false), 2000);
        });
    } else {
      setCopied(true);
      addToast('✓ 已复制到剪贴板', '家长同步报告文案已复制。', 'success');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface border border-theme rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-theme pb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary-theme/10 text-primary-theme flex items-center justify-center font-bold text-lg">
              {digest.studentName.slice(0, 1)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-main">{digest.studentName}</h3>
                <span className="text-xs font-mono text-muted">({digest.studentNumber})</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary-theme/10 text-primary-theme border border-primary-theme/20">
                  {digest.tierLabel}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">课堂全景表现个人报告与家校同步成长单</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-surface-secondary text-muted hover:text-main transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 核心指标 4 宫格 */}
        <div className="grid grid-cols-4 gap-2.5 text-center">
          <div className="p-3 rounded-xl bg-surface-secondary border border-theme flex flex-col">
            <span className="text-[10px] text-muted font-bold">随堂得分</span>
            <span className="text-lg font-black font-mono text-primary-theme mt-0.5">
              {digest.quizScore !== null ? `${digest.quizScore}分` : '—'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-surface-secondary border border-theme flex flex-col">
            <span className="text-[10px] text-muted font-bold">答题互动</span>
            <span className="text-lg font-black font-mono text-amber-500 mt-0.5">
              {digest.pollsAnswered} 次
            </span>
          </div>

          <div className="p-3 rounded-xl bg-surface-secondary border border-theme flex flex-col">
            <span className="text-[10px] text-muted font-bold">通票自评</span>
            <span className="text-lg font-black font-mono text-indigo-500 mt-0.5">
              {digest.exitRating !== null ? `${digest.exitRating}★` : '—'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-surface-secondary border border-theme flex flex-col">
            <span className="text-[10px] text-muted font-bold">出勤状态</span>
            <span className="text-lg font-black text-emerald-600 mt-0.5">
              {digest.attendance}
            </span>
          </div>
        </div>

        {/* 荣誉勋章展示 */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-main flex items-center gap-1.5">
            <Award size={14} className="text-amber-500" />
            <span>当堂获得成就勋章</span>
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {digest.badges.map((badge) => (
              <div
                key={badge.id}
                className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-center gap-2.5"
              >
                <span className="text-2xl">{badge.icon}</span>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    {badge.name}
                  </span>
                  <span className="text-[10px] text-muted leading-tight">{badge.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 教师评语 */}
        <div className="p-3 rounded-xl bg-primary-theme/5 border border-primary-theme/20 flex flex-col gap-1">
          <span className="text-xs font-bold text-primary-theme flex items-center gap-1">
            <MessageSquare size={13} />
            <span>教师诊断与课堂评价</span>
          </span>
          <p className="text-xs text-main leading-relaxed">{digest.teacherNote}</p>
        </div>

        {/* 家校同步卡片与一键复制 */}
        <div className="flex flex-col gap-2 border-t border-theme pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-main flex items-center gap-1.5">
              <Share2 size={13} className="text-indigo-500" />
              <span>家校互联·家长端同步文案</span>
            </span>

            <button
              type="button"
              id="btn-copy-parent-digest"
              onClick={handleCopy}
              className="px-3 py-1 bg-surface-secondary hover:bg-primary-theme hover:text-white border border-theme text-main rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
              <span>{copied ? '已复制' : '一键复制文案'}</span>
            </button>
          </div>

          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            rows={5}
            className="w-full bg-surface-secondary border border-theme rounded-xl p-3 text-xs text-main font-mono leading-relaxed outline-none focus:border-primary-theme resize-none"
          />
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-surface hover:bg-surface-secondary border border-theme text-main rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            关闭预览
          </button>
        </div>
      </div>
    </div>
  );
}
