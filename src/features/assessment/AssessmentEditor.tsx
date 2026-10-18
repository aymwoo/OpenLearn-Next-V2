/**
 * 试卷编辑器（Issue #100 / #121）：设置 → 组卷 → 发布 → 布置管理。
 *
 * 只有草稿可编辑；已发布的试卷进来是只读的（`draft ? 可编辑 : 只读`），
 * 与后端 `isAssessmentEditable` 的语义一致。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookMarked,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Send,
  Settings2,
  Trash2,
  Users,
} from 'lucide-react';
import { useOptionalAppData } from '../../context/AppDataContext';
import {
  assessmentApi,
  ApiError,
  type AssessmentAssignment,
  type AssessmentDetail,
  type AssessmentItemView,
  type BankItem,
} from './api';
import { assessmentQuestionTypeUiRegistry } from './question-type-ui-registry';
import './register-builtin-question-uis';
import { GradingPanel } from './GradingPanel';
import { StatsPanel } from './StatsPanel';

/** 编辑期的题目草稿：`answerKey` 可能是 null（未设置 → 交卷后进人工批改）。 */
interface DraftItem {
  id: string;
  type: string;
  stem: string;
  config: Record<string, unknown>;
  answerKey: unknown;
  maxScore: number;
}

interface AssignmentRow extends AssessmentAssignment {
  className: string | null;
  attemptCount: number;
  submittedCount: number;
  pendingReviewCount: number;
}

const INPUT =
  'w-full px-2.5 py-1.5 border border-theme rounded-lg text-xs bg-surface text-main focus:outline-none focus:ring-1 focus:ring-indigo-500';

export function AssessmentEditor({
  assessmentId,
  lang,
  onBack,
}: {
  assessmentId: string;
  lang: 'zh' | 'en';
  onBack: () => void;
}) {
  const zh = lang === 'zh';
  const appData = useOptionalAppData();
  const classes: Array<{ id: string; name: string }> = (appData?.classes as any[]) ?? [];

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [gradingAssignment, setGradingAssignment] = useState<AssignmentRow | null>(null);
  const [statsAssignment, setStatsAssignment] = useState<AssignmentRow | null>(null);
  const [bankPicker, setBankPicker] = useState<BankItem[] | null>(null);

  const isDraft = detail?.status === 'draft';
  const questionTypes = useMemo(() => {
    assessmentQuestionTypeUiRegistry.subscribe(() => undefined);
    return assessmentQuestionTypeUiRegistry.list().filter((t) => t.supports.includes(detail?.kind ?? 'quiz'));
  }, [detail?.kind]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await assessmentApi.get(assessmentId);
      setDetail(d);
      setItems(
        d.items.map((item) => ({
          id: item.id,
          type: item.type,
          stem: item.stem,
          config: item.config ?? {},
          answerKey: item.answerKey ?? null,
          maxScore: item.maxScore,
        })),
      );
      const list = await assessmentApi.getAssignments(assessmentId).catch(() => ({ items: [] as AssignmentRow[] }));
      setAssignments(list.items as AssignmentRow[]);
    } catch (e: any) {
      setError(e instanceof ApiError ? e.message : String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [assessmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const applySettings = async (patch: Record<string, unknown>) => {
    setBusy('settings');
    setError(null);
    try {
      const updated = await assessmentApi.update(assessmentId, { settings: patch as any });
      setDetail(updated);
      setNotice(zh ? '设置已保存' : 'Settings saved');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveItems = async () => {
    setBusy('items');
    setError(null);
    try {
      const updated = await assessmentApi.replaceItems(
        assessmentId,
        items.map((item, index) => ({
          id: item.id,
          type: item.type,
          stem: item.stem,
          config: item.config,
          answerKey: item.answerKey,
          maxScore: item.maxScore,
          sortOrder: index,
        })),
      );
      setDetail(updated);
      setItems(
        updated.items.map((item) => ({
          id: item.id,
          type: item.type,
          stem: item.stem,
          config: item.config ?? {},
          answerKey: item.answerKey ?? null,
          maxScore: item.maxScore,
        })),
      );
      setNotice(zh ? '题目已保存' : 'Items saved');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const addItem = (type: string) => {
    const ui = assessmentQuestionTypeUiRegistry.get(type);
    setItems((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}-${prev.length}`,
        type,
        stem: '',
        config: ui?.createDefaultConfig?.() ?? {},
        answerKey: ui?.createDefaultAnswerKey?.() ?? null,
        maxScore: 5,
      },
    ]);
  };

  const openBankPicker = async () => {
    try {
      const res = await assessmentApi.listBank();
      setBankPicker(res.items);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" />
        {zh ? '正在加载试卷…' : 'Loading assessment…'}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
        <p role="alert" className="text-sm text-rose-600">
          {error ?? (zh ? '加载失败' : 'Failed to load')}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-indigo-600 underline cursor-pointer"
        >
          {zh ? '返回列表' : 'Back to list'}
        </button>
      </div>
    );
  }

  if (gradingAssignment) {
    return (
      <GradingPanel
        assignment={gradingAssignment}
        lang={lang}
        onBack={() => {
          setGradingAssignment(null);
          void load();
        }}
      />
    );
  }

  if (statsAssignment) {
    return <StatsPanel assignment={statsAssignment} lang={lang} onBack={() => setStatsAssignment(null)} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border border-theme rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-theme bg-surface-secondary/70 flex flex-wrap items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-muted hover:text-main cursor-pointer"
          aria-label={zh ? '返回测评列表' : 'Back to assessment list'}
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold text-main truncate">{detail.title}</h1>
          <p className="text-2xs text-muted">
            {zh ? '类型' : 'Kind'}：{detail.kind} · {zh ? '状态' : 'Status'}：{detail.status} · {items.length}{' '}
            {zh ? '题' : 'items'} · {zh ? '满分' : 'total'} {items.reduce((s, i) => s + i.maxScore, 0)}
          </p>
        </div>
        {isDraft && (
          <button
            type="button"
            onClick={() => void saveItems()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
          >
            {busy === 'items' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {zh ? '保存题目' : 'Save items'}
          </button>
        )}
      </div>

      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`mx-5 mt-3 px-3 py-2 rounded-xl border text-xs ${
            error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error ?? notice}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* 设置 */}
        <section aria-labelledby="settings-heading" className="border border-theme rounded-xl p-4">
          <h2 id="settings-heading" className="text-xs font-bold text-main flex items-center gap-1.5 mb-3">
            <Settings2 size={13} />
            {zh ? '测评设置' : 'Settings'}
            {!isDraft && (
              <span className="text-2xs font-normal text-muted">
                （{zh ? '已发布，只读' : 'published, read-only'}）
              </span>
            )}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <div>
              <label htmlFor="set-attempts" className="block text-2xs font-semibold text-muted mb-1">
                {zh ? '允许作答次数' : 'Max attempts'}
              </label>
              <input
                id="set-attempts"
                type="number"
                min={1}
                max={10}
                value={detail.settings.maxAttempts}
                disabled={!isDraft || detail.kind !== 'quiz'}
                onChange={(e) => void applySettings({ maxAttempts: Number(e.target.value) || 1 })}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="set-policy" className="block text-2xs font-semibold text-muted mb-1">
                {zh ? '多次作答取哪次' : 'Score policy'}
              </label>
              <select
                id="set-policy"
                value={detail.settings.scorePolicy}
                disabled={!isDraft || detail.kind !== 'quiz'}
                onChange={(e) => void applySettings({ scorePolicy: e.target.value })}
                className={INPUT}
              >
                <option value="last">{zh ? '最后一次' : 'Last'}</option>
                <option value="first">{zh ? '第一次' : 'First'}</option>
                <option value="highest">{zh ? '最高分' : 'Highest'}</option>
                <option value="average">{zh ? '平均分' : 'Average'}</option>
              </select>
            </div>
            <div>
              <label htmlFor="set-visibility" className="block text-2xs font-semibold text-muted mb-1">
                {zh ? '结果可见性' : 'Result visibility'}
              </label>
              <select
                id="set-visibility"
                value={detail.settings.resultVisibility}
                disabled={!isDraft || detail.kind === 'survey'}
                onChange={(e) => void applySettings({ resultVisibility: e.target.value })}
                className={INPUT}
              >
                <option value="immediate">{zh ? '交卷即显示' : 'Immediately'}</option>
                <option value="after_release">{zh ? '教师发布成绩后' : 'After release'}</option>
                <option value="score_only">{zh ? '只显示分数' : 'Score only'}</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {[
              {
                key: 'partialCredit',
                zh: '多选少选给部分分',
                en: 'Partial credit for multi-choice',
                disabled: !isDraft,
              },
              { key: 'caseSensitive', zh: '填空题区分大小写', en: 'Case-sensitive blanks', disabled: !isDraft },
              {
                key: 'showItemAnalysis',
                zh: '允许查看逐题解析',
                en: 'Show item analysis',
                disabled: !isDraft || detail.kind === 'survey',
              },
              {
                key: 'anonymous',
                zh: '匿名问卷',
                en: 'Anonymous survey',
                disabled: !isDraft || detail.kind !== 'survey',
              },
            ].map((option) => (
              <label key={option.key} className="inline-flex items-center gap-1.5 text-xs text-main">
                <input
                  type="checkbox"
                  checked={Boolean((detail.settings as any)[option.key])}
                  disabled={option.disabled || !isDraft}
                  onChange={(e) => void applySettings({ [option.key]: e.target.checked })}
                  className="accent-indigo-600"
                />
                {option[zh ? 'zh' : 'en']}
              </label>
            ))}
          </div>
        </section>

        {/* 题目 */}
        <section aria-labelledby="items-heading" className="border border-theme rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="items-heading" className="text-xs font-bold text-main">
              {zh ? '题目列表' : 'Items'}（{items.length}）
            </h2>
            {isDraft && (
              <div className="flex flex-wrap items-center gap-2">
                {questionTypes.map((type) => (
                  <button
                    key={type.type}
                    type="button"
                    onClick={() => addItem(type.type)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                  >
                    <Plus size={11} />
                    {type.label[zh ? 'zh' : 'en']}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void openBankPicker()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                >
                  <BookMarked size={11} />
                  {zh ? '从题库添加' : 'From bank'}
                </button>
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <p className="text-xs text-muted py-6 text-center">
              {zh ? '还没有题目。用上方按钮添加第一道题。' : 'No items yet — add your first question above.'}
            </p>
          ) : (
            <ol className="space-y-3">
              {items.map((item, index) => {
                const ui = assessmentQuestionTypeUiRegistry.get(item.type);
                const Editor = ui?.Editor;
                return (
                  <li
                    key={item.id}
                    data-testid={`item-row-${index}`}
                    className="border border-theme rounded-xl p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-2xs font-bold text-muted">#{index + 1}</span>
                      <span className="px-2 py-0.5 rounded-full bg-surface-secondary border border-theme text-2xs font-semibold text-main">
                        {ui?.label[zh ? 'zh' : 'en'] ?? item.type}
                      </span>
                      <label htmlFor={`item-score-${item.id}`} className="ml-auto text-2xs text-muted">
                        {zh ? '分值' : 'Score'}
                      </label>
                      <input
                        id={`item-score-${item.id}`}
                        type="number"
                        min={1}
                        value={item.maxScore}
                        disabled={!isDraft}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((it, i) => (i === index ? { ...it, maxScore: Number(e.target.value) || 1 } : it)),
                          )
                        }
                        className="w-16 px-2 py-1 border border-theme rounded-lg text-xs bg-surface text-main"
                      />
                      {isDraft && (
                        <>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() =>
                              setItems((prev) => {
                                const next = [...prev];
                                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                return next;
                              })
                            }
                            aria-label={zh ? `上移第 ${index + 1} 题` : `Move item ${index + 1} up`}
                            className="p-1 rounded-md text-muted hover:text-main hover:bg-surface-secondary disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            disabled={index === items.length - 1}
                            onClick={() =>
                              setItems((prev) => {
                                const next = [...prev];
                                [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                return next;
                              })
                            }
                            aria-label={zh ? `下移第 ${index + 1} 题` : `Move item ${index + 1} down`}
                            className="p-1 rounded-md text-muted hover:text-main hover:bg-surface-secondary disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                            aria-label={zh ? `删除第 ${index + 1} 题` : `Delete item ${index + 1}`}
                            className="p-1 rounded-md text-muted hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`item-stem-${item.id}`} className="block text-2xs font-semibold text-muted mb-1">
                        {zh ? '题干' : 'Stem'}
                      </label>
                      <textarea
                        id={`item-stem-${item.id}`}
                        rows={2}
                        value={item.stem}
                        disabled={!isDraft}
                        onChange={(e) =>
                          setItems((prev) => prev.map((it, i) => (i === index ? { ...it, stem: e.target.value } : it)))
                        }
                        className={`${INPUT} resize-none`}
                      />
                    </div>
                    {Editor ? (
                      <Editor
                        config={item.config}
                        answerKey={item.answerKey}
                        lang={lang}
                        disabled={!isDraft}
                        onChange={({ config, answerKey }) =>
                          setItems((prev) => prev.map((it, i) => (i === index ? { ...it, config, answerKey } : it)))
                        }
                      />
                    ) : (
                      <p className="text-2xs text-amber-700 dark:text-amber-300">
                        {zh
                          ? `题型「${item.type}」没有注册出题编辑器（可能来自未启用/已卸载的插件）。`
                          : `No editor registered for "${item.type}" (plugin missing or disabled).`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 发布 */}
        <PublishSection
          lang={lang}
          detail={detail}
          classes={classes}
          assignments={assignments}
          disabled={!isDraft}
          onPublished={async () => {
            await load();
          }}
          onGrading={setGradingAssignment}
          onStats={setStatsAssignment}
          onError={setError}
        />
      </div>

      {bankPicker && (
        <BankPickerDialog
          lang={lang}
          items={bankPicker}
          allowedTypes={questionTypes.map((t) => t.type)}
          onClose={() => setBankPicker(null)}
          onPick={(bankItem) => {
            setItems((prev) => [
              ...prev,
              {
                id: `new-${Date.now()}-${prev.length}`,
                type: bankItem.type,
                stem: bankItem.stem,
                config: (bankItem.config ?? {}) as Record<string, unknown>,
                answerKey: bankItem.answerKey ?? null,
                maxScore: 5,
              },
            ]);
            setBankPicker(null);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── 发布区 ─────────────────────────── */

function PublishSection({
  lang,
  detail,
  classes,
  assignments,
  disabled,
  onPublished,
  onGrading,
  onStats,
  onError,
}: {
  lang: 'zh' | 'en';
  detail: AssessmentDetail;
  classes: Array<{ id: string; name: string }>;
  assignments: AssignmentRow[];
  disabled: boolean;
  onPublished: () => Promise<void>;
  onGrading: (assignment: AssignmentRow) => void;
  onStats: (assignment: AssignmentRow) => void;
  onError: (message: string) => void;
}) {
  const zh = lang === 'zh';
  const [classId, setClassId] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [busy, setBusy] = useState(false);

  const publish = async () => {
    if (!classId) {
      onError(zh ? '请选择班级' : 'Pick a class first');
      return;
    }
    setBusy(true);
    try {
      await assessmentApi.publish(detail.id, {
        classId,
        durationSec: durationMin ? Number(durationMin) * 60 : null,
        closesAt: closesAt ? new Date(closesAt).getTime() : null,
      });
      await onPublished();
    } catch (e: any) {
      onError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="publish-heading" className="border border-theme rounded-xl p-4 space-y-3">
      <h2 id="publish-heading" className="text-xs font-bold text-main flex items-center gap-1.5">
        <Send size={13} />
        {zh ? '发布到班级' : 'Publish to a class'}
      </h2>
      {disabled ? (
        <p className="text-2xs text-muted">
          {zh
            ? '试卷已发布，内容只读。需要改题请新建一份试卷。'
            : 'Published papers are read-only. Create a new one to change items.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_auto] gap-2 items-end">
          <div>
            <label htmlFor="pub-class" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '班级' : 'Class'}
            </label>
            <select id="pub-class" value={classId} onChange={(e) => setClassId(e.target.value)} className={INPUT}>
              <option value="">{zh ? '请选择班级' : 'Select a class'}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pub-duration" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '限时（分钟，可选）' : 'Time limit (min)'}
            </label>
            <input
              id="pub-duration"
              type="number"
              min={1}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="pub-closes" className="block text-2xs font-semibold text-muted mb-1">
              {zh ? '截止时间（可选）' : 'Closes at'}
            </label>
            <input
              id="pub-closes"
              type="datetime-local"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {zh ? '发布' : 'Publish'}
          </button>
        </div>
      )}

      {assignments.length > 0 && (
        <ul data-testid="assignment-list" className="space-y-2 pt-1">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              data-testid={`assignment-row-${assignment.id}`}
              className="flex flex-wrap items-center gap-2 border border-theme rounded-xl px-3 py-2"
            >
              <Users size={13} className="text-muted" />
              <span className="text-xs font-semibold text-main">{assignment.className ?? assignment.classId}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-2xs font-semibold border ${
                  assignment.status === 'open'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-surface-secondary text-muted border-theme'
                }`}
              >
                {assignment.status === 'open' ? (zh ? '进行中' : 'Open') : zh ? '已关闭' : 'Closed'}
              </span>
              <span className="text-2xs text-muted">
                {zh ? '已交卷' : 'Submitted'} {assignment.submittedCount}/{assignment.attemptCount} ·{' '}
                {zh ? '待批改' : 'Pending'} {assignment.pendingReviewCount}
              </span>
              {assignment.scoreReleased && (
                <span className="text-2xs text-indigo-600">{zh ? '成绩已发布' : 'Scores released'}</span>
              )}
              <span className="ml-auto flex items-center gap-1.5">
                <a
                  href={assessmentApi.exportCsvUrl(assignment.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary"
                >
                  <ExternalLink size={11} />
                  CSV
                </a>
                <button
                  type="button"
                  onClick={() => onStats(assignment)}
                  className="px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                >
                  {zh ? '统计' : 'Stats'}
                </button>
                <button
                  type="button"
                  onClick={() => onGrading(assignment)}
                  className="px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                >
                  {zh ? '批改' : 'Grade'}
                </button>
                {!assignment.scoreReleased && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await assessmentApi.releaseScores(assignment.id);
                        await onPublished();
                      } catch (e: any) {
                        onError(e?.message ?? String(e));
                      }
                    }}
                    className="px-2 py-1 rounded-lg border border-theme text-2xs font-semibold text-main hover:bg-surface-secondary cursor-pointer"
                  >
                    {zh ? '发布成绩' : 'Release'}
                  </button>
                )}
                {assignment.status === 'open' && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await assessmentApi.closeAssignment(assignment.id);
                        await onPublished();
                      } catch (e: any) {
                        onError(e?.message ?? String(e));
                      }
                    }}
                    className="px-2 py-1 rounded-lg border border-amber-300 text-2xs font-semibold text-amber-700 hover:bg-amber-50 cursor-pointer"
                  >
                    {zh ? '关闭' : 'Close'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────────────────── 题库选择器 ─────────────────────────── */

function BankPickerDialog({
  lang,
  items,
  allowedTypes,
  onClose,
  onPick,
}: {
  lang: 'zh' | 'en';
  items: BankItem[];
  allowedTypes: string[];
  onClose: () => void;
  onPick: (item: BankItem) => void;
}) {
  const zh = lang === 'zh';
  const usable = items.filter((item) => allowedTypes.includes(item.type));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bank-picker-title"
        className="w-full max-w-lg max-h-[80vh] flex flex-col bg-surface border border-theme rounded-2xl shadow-2xl"
      >
        <div className="px-4 py-3 border-b border-theme flex items-center justify-between">
          <h2 id="bank-picker-title" className="text-sm font-bold text-main">
            {zh ? '从题库添加' : 'Add from question bank'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold text-muted hover:text-main cursor-pointer"
          >
            {zh ? '关闭' : 'Close'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {usable.length === 0 ? (
            <p className="text-xs text-muted py-6 text-center">
              {zh ? '题库里还没有可用于本测评类型的题目。' : 'No bank items usable for this assessment kind.'}
            </p>
          ) : (
            usable.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(item)}
                className="w-full text-left border border-theme rounded-xl px-3 py-2 hover:border-indigo-300 hover:bg-surface-secondary cursor-pointer"
              >
                <p className="text-xs font-semibold text-main line-clamp-2">{item.stem}</p>
                <p className="text-2xs text-muted mt-0.5">{item.type}</p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
