/**
 * 测评中心 · 主页面（Issue #100 / 子 issue #121）。
 *
 * 三块内容：试卷列表（+ 新建）、题库、以及选中试卷后的出题/发布/批改/统计。
 * 所有数据经 `assessmentApi` 走 P0a 的 REST 接口；页面本身不持有判分逻辑。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  FileQuestion,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { useOptionalAppData } from '../../context/AppDataContext';
import { assessmentApi, ApiError, type AssessmentSummary } from './api';
import { AssessmentEditor } from './AssessmentEditor';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { toAssessmentListCardProps } from './extension-slot-props';
import { QuestionBankPanel } from './QuestionBankPanel';

type SubTab = 'papers' | 'bank';

const KIND_LABEL: Record<string, { zh: string; en: string; cls: string }> = {
  quiz: {
    zh: '测试',
    en: 'Quiz',
    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  },
  exam: {
    zh: '考试',
    en: 'Exam',
    cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  },
  survey: {
    zh: '问卷',
    en: 'Survey',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
};

const STATUS_LABEL: Record<string, { zh: string; en: string; cls: string }> = {
  draft: { zh: '草稿', en: 'Draft', cls: 'bg-surface-secondary text-muted border-theme' },
  published: {
    zh: '已发布',
    en: 'Published',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
  closed: {
    zh: '已关闭',
    en: 'Closed',
    cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  },
  archived: { zh: '已归档', en: 'Archived', cls: 'bg-surface-secondary text-muted border-theme' },
};

export function AssessmentCenter() {
  const appData = useOptionalAppData();
  const lang: 'zh' | 'en' = appData?.lang === 'en' ? 'en' : 'zh';
  const zh = lang === 'zh';

  const [subTab, setSubTab] = useState<SubTab>('papers');
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<'all' | 'quiz' | 'exam' | 'survey'>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await assessmentApi.list(kindFilter === 'all' ? {} : { kind: kindFilter });
      setItems(res.items);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [kindFilter]);

  useEffect(() => {
    if (subTab === 'papers' && openId === null) void load();
  }, [subTab, openId, load]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [items]);

  if (openId) {
    return (
      <AssessmentEditor
        assessmentId={openId}
        lang={lang}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-theme bg-surface-secondary/70 flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-main flex items-center gap-2">
            <ClipboardList size={18} className="text-indigo-500" />
            {zh ? '测评中心' : 'Assessment Center'}
          </h1>
          <p className="text-xs text-muted mt-0.5">
            {zh
              ? '组卷、发布到班级、批改与统计。测试 / 考试 / 问卷共用同一套题目与判分模型。'
              : 'Build papers, publish to classes, grade and analyse. Quizzes, exams and surveys share one item model.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex p-1 bg-surface-secondary border border-theme rounded-xl text-xs font-semibold">
            {(
              [
                { id: 'papers', label: zh ? '试卷' : 'Papers', icon: ClipboardList },
                { id: 'bank', label: zh ? '题库' : 'Question bank', icon: FileQuestion },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id as SubTab)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                    active ? 'bg-surface text-main shadow-3xs font-bold' : 'text-muted hover:text-main'
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || subTab !== 'papers'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-xs font-semibold text-main disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {zh ? '刷新' : 'Refresh'}
          </button>
          {subTab === 'papers' && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer"
            >
              <Plus size={13} />
              {zh ? '新建测评' : 'New assessment'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-6 mt-4 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs flex items-center gap-2"
        >
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {subTab === 'bank' ? (
        <QuestionBankPanel lang={lang} />
      ) : (
        <>
          <div className="px-6 py-3 border-b border-theme flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-muted">{zh ? '类型筛选' : 'Filter by kind'}</span>
            {(['all', 'quiz', 'exam', 'survey'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setKindFilter(kind)}
                aria-pressed={kindFilter === kind}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer ${
                  kindFilter === kind
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-surface text-muted border-theme hover:text-main'
                }`}
              >
                {kind === 'all' ? (zh ? '全部' : 'All') : (KIND_LABEL[kind]?.[zh ? 'zh' : 'en'] ?? kind)}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {items === null && loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
                <Loader2 size={16} className="animate-spin" />
                {zh ? '正在加载试卷…' : 'Loading papers…'}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <ClipboardList size={40} className="text-muted opacity-40" />
                <p className="text-sm font-semibold text-main">{zh ? '还没有任何测评' : 'No assessments yet'}</p>
                <p className="text-xs text-muted max-w-sm">
                  {zh
                    ? '新建一份测试、考试或问卷，组卷后发布到班级，学生就能在「我的测评」里作答。'
                    : 'Create a quiz, exam or survey, add questions, then publish it to a class.'}
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 cursor-pointer"
                >
                  <Plus size={13} />
                  {zh ? '新建测评' : 'New assessment'}
                </button>
              </div>
            ) : (
              <ul
                data-testid="assessment-list"
                className="grid grid-cols-1 xl:grid-cols-2 gap-3 max-w-[1400px] mx-auto"
              >
                {filtered.map((item) => {
                  const kind = KIND_LABEL[item.kind] ?? KIND_LABEL.quiz;
                  const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.draft;
                  return (
                    <li
                      key={item.id}
                      data-testid={`assessment-row-${item.id}`}
                      className="bg-surface border border-theme rounded-xl p-4 flex flex-col gap-2.5 hover:border-indigo-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-main truncate" title={item.title}>
                            {item.title}
                          </p>
                          {item.description && (
                            <p className="text-xs text-muted mt-0.5 line-clamp-2">{item.description}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border ${kind.cls}`}>
                            {kind[zh ? 'zh' : 'en']}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-2xs font-semibold border ${status.cls}`}>
                            {status[zh ? 'zh' : 'en']}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-2xs text-muted flex-wrap">
                        <span>
                          {item.itemCount} {zh ? '题' : 'items'}
                        </span>
                        <span>
                          {zh ? '满分' : 'Total'} {item.totalScore}
                        </span>
                        {item.settings.anonymous && <span>🔒 {zh ? '匿名' : 'Anonymous'}</span>}
                        {item.settings.maxAttempts > 1 && (
                          <span>
                            {zh ? `可作答 ${item.settings.maxAttempts} 次` : `${item.settings.maxAttempts} attempts`}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-2">
                          {item.status === 'draft' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(zh ? `删除「${item.title}」？` : `Delete "${item.title}"?`)) return;
                                try {
                                  await assessmentApi.remove(item.id);
                                  void load();
                                } catch (e: any) {
                                  setError(e?.message ?? String(e));
                                }
                              }}
                              aria-label={zh ? `删除 ${item.title}` : `Delete ${item.title}`}
                              className="p-1 rounded-md text-muted hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setOpenId(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                          >
                            {item.status === 'draft' ? (zh ? '继续编辑' : 'Edit') : zh ? '查看与批改' : 'Open'}
                            <ChevronRight size={12} />
                          </button>
                        </span>
                      </div>
                      {/* Issue #183：插件可在每张测评卡片注入内容（props 走白名单投影，不含答案） */}
                      <ExtensionPointRenderer
                        slot="assessment.list.card"
                        slotProps={{ assessment: toAssessmentListCardProps(item), viewer: 'teacher', lang }}
                        lang={lang}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {isCreateOpen && (
        <CreateAssessmentDialog
          lang={lang}
          onClose={() => setIsCreateOpen(false)}
          onCreated={(id) => {
            setIsCreateOpen(false);
            setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 新建对话框 ─────────────────────────── */

function CreateAssessmentDialog({
  lang,
  onClose,
  onCreated,
}: {
  lang: 'zh' | 'en';
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const zh = lang === 'zh';
  const [kind, setKind] = useState<'quiz' | 'exam' | 'survey'>('quiz');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(zh ? '请填写标题' : 'Title is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await assessmentApi.create({
        kind,
        title: title.trim(),
        description: description.trim() || null,
      });
      onCreated(created.id);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-assessment-title"
        className="w-full max-w-md bg-surface border border-theme rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <h2 id="create-assessment-title" className="text-sm font-bold text-main">
          {zh ? '新建测评' : 'New assessment'}
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <fieldset>
            <legend className="text-xs font-semibold text-muted mb-1">{zh ? '类型' : 'Kind'}</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['quiz', 'exam', 'survey'] as const).map((option) => (
                <label
                  key={option}
                  className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-xs cursor-pointer ${
                    kind === option
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                      : 'border-theme text-muted hover:text-main'
                  }`}
                >
                  <input
                    type="radio"
                    name="assessment-kind"
                    value={option}
                    checked={kind === option}
                    onChange={() => setKind(option)}
                    className="sr-only"
                  />
                  <span className="font-bold">{KIND_LABEL[option][zh ? 'zh' : 'en']}</span>
                  <span className="text-2xs text-center leading-snug">
                    {option === 'quiz'
                      ? zh
                        ? '计分，可多次作答'
                        : 'Scored, retakes allowed'
                      : option === 'exam'
                        ? zh
                          ? '一次作答，发布成绩后可见'
                          : 'Single attempt, released later'
                        : zh
                          ? '不计分，可匿名'
                          : 'Not scored, can be anonymous'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="assessment-title" className="block text-xs font-semibold text-muted mb-1">
              {zh ? '标题' : 'Title'}
            </label>
            <input
              id="assessment-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder={zh ? '例如：第三单元小测' : 'e.g. Unit 3 quiz'}
            />
          </div>
          <div>
            <label htmlFor="assessment-description" className="block text-xs font-semibold text-muted mb-1">
              {zh ? '说明（可选）' : 'Description (optional)'}
            </label>
            <textarea
              id="assessment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-600">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl border border-theme text-xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
            >
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              {submitting && <Loader2 size={13} className="animate-spin" />}
              {zh ? '创建并开始组卷' : 'Create & build'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
