import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, ClipboardCheck, FileUp, Globe, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  BLOCK_TYPE_LABELS,
  BLOCK_TYPES,
  createActivity,
  deleteActivity,
  extractNamedList,
  fetchActivityPack,
  fetchActivityProgress,
  fetchAssessmentList,
  fetchAssignmentList,
  fetchCoursewareList,
  gradeActivityProgress,
  reorderActivities,
  saveActivityBlocks,
  updateActivity,
  verifyActivityProgress,
  awardStudentPoints,
  type ActivityBlockType,
  type ActivityProgress,
  type ActivityType,
  type LessonActivity,
  type LessonActivityBlock,
  type TeacherActivityPack,
} from './api';

const TYPE_ICONS: Record<ActivityType, typeof BookOpen> = {
  reading: BookOpen,
  courseware: Globe,
  quiz: ClipboardCheck,
  submission: FileUp,
};

function labelOf(lang: 'zh' | 'en', pair: { zh: string; en: string }) {
  return lang === 'zh' ? pair.zh : pair.en;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface ActivityPackEditorProps {
  lessonId: string;
  lang: 'zh' | 'en';
  readOnly?: boolean;
}

export function ActivityPackEditor({ lessonId, lang, readOnly = false }: ActivityPackEditorProps) {
  const [pack, setPack] = useState<TeacherActivityPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, LessonActivity>>({});
  const [blockDrafts, setBlockDrafts] = useState<LessonActivityBlock[]>([]);
  const [options, setOptions] = useState<{
    courseware: Array<{ id: string; name?: string; title?: string }>;
    assessments: Array<{ id: string; name?: string; title?: string }>;
    assignments: Array<{ id: string; name?: string; title?: string }>;
  }>({ courseware: [], assessments: [], assignments: [] });
  const [progressRows, setProgressRows] = useState<ActivityProgress[]>([]);
  const [gradeForm, setGradeForm] = useState({
    studentId: '',
    score: '',
    feedback: '',
    points: '',
    classId: '',
    dimensionId: '',
    reason: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchActivityPack(lessonId);
      const teacherPack = result.pack as TeacherActivityPack;
      setPack(teacherPack);
      setBlockDrafts(teacherPack.blocks);
      setDrafts(Object.fromEntries(teacherPack.activities.map((item) => [item.id, item])));
      if (teacherPack.activities.length > 0) {
        setSelectedId((current) => current ?? teacherPack.activities[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      const [courseware, assessments, assignments] = await Promise.allSettled([
        fetchCoursewareList(),
        fetchAssessmentList(),
        fetchAssignmentList(lessonId),
      ]);
      if (cancelled) return;
      setOptions({
        courseware: courseware.status === 'fulfilled' ? extractNamedList(courseware.value) : [],
        assessments: assessments.status === 'fulfilled' ? extractNamedList(assessments.value) : [],
        assignments: assignments.status === 'fulfilled' ? extractNamedList(assignments.value) : [],
      });
    };
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const selected = selectedId ? drafts[selectedId] : null;

  useEffect(() => {
    if (!selectedId || readOnly) return;
    let cancelled = false;
    fetchActivityProgress(lessonId, selectedId)
      .then((result) => {
        if (!cancelled) setProgressRows(result.progress);
      })
      .catch(() => {
        if (!cancelled) setProgressRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId, selectedId, readOnly, pack]);

  const activities = useMemo(
    () => (pack?.activities ?? []).map((item) => drafts[item.id] ?? item).sort((a, b) => a.orderIndex - b.orderIndex),
    [pack, drafts],
  );

  const patchDraft = (id: string, patch: Partial<LessonActivity> & { config?: Record<string, unknown> }) => {
    setDrafts((current) => {
      const base = current[id];
      if (!base) return current;
      return {
        ...current,
        [id]: {
          ...base,
          ...patch,
          config: patch.config ? { ...base.config, ...patch.config } : base.config,
        },
      };
    });
  };

  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !pack) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted gap-2">
        <Loader2 size={18} className="animate-spin" />
        <span>{lang === 'zh' ? '正在加载学案活动…' : 'Loading activity pack…'}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 bg-surface" data-testid="activity-pack-editor">
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-main">{lang === 'zh' ? '学案活动编排' : 'Lesson activity pack'}</h2>
          <p className="text-xs text-muted mt-1">
            {lang === 'zh'
              ? '活动与课堂环节并列，完成活动不会自动推进课堂门禁。发布前请先关联已有课件、测验或作业，不另建提交系统。'
              : 'Activities sit beside the classroom timeline and never advance segment gates. Link existing courseware, quizzes, or assignments before publishing.'}
          </p>
        </div>

        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
            {error}
          </div>
        )}

        <section className="border border-theme rounded-xl p-4 bg-surface-secondary/40">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm text-main">
              {lang === 'zh' ? '学案首页（可选区块）' : 'Homepage blocks'}
            </h3>
            {!readOnly && (
              <select
                aria-label={lang === 'zh' ? '添加首页区块' : 'Add homepage block'}
                className="text-xs border border-theme rounded-lg px-2 py-1 bg-surface"
                defaultValue=""
                onChange={(event) => {
                  const blockType = event.target.value as ActivityBlockType;
                  if (!blockType) return;
                  setBlockDrafts((current) => [
                    ...current,
                    {
                      id: `draft_${Date.now()}`,
                      lessonId,
                      blockType,
                      orderIndex: current.length,
                      content: { text: '' },
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    },
                  ]);
                  event.target.value = '';
                }}
              >
                <option value="">{lang === 'zh' ? '添加区块…' : 'Add block…'}</option>
                {BLOCK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {labelOf(lang, BLOCK_TYPE_LABELS[type])}
                  </option>
                ))}
              </select>
            )}
          </div>
          {blockDrafts.length === 0 ? (
            <p className="text-xs text-muted">
              {lang === 'zh'
                ? '未添加区块，学生学案页将只显示活动序列。'
                : 'No blocks yet. Students will only see the activity list.'}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {blockDrafts.map((block, index) => (
                <div key={block.id} className="border border-theme rounded-lg p-3 bg-surface">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold">{labelOf(lang, BLOCK_TYPE_LABELS[block.blockType])}</span>
                    {!readOnly && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="p-1 text-muted hover:text-main"
                          onClick={() => setBlockDrafts((rows) => moveItem(rows, index, -1))}
                          aria-label="Move block up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-muted hover:text-main"
                          onClick={() => setBlockDrafts((rows) => moveItem(rows, index, 1))}
                          aria-label="Move block down"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-rose-600"
                          onClick={() => setBlockDrafts((rows) => rows.filter((item) => item.id !== block.id))}
                          aria-label="Delete block"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  <textarea
                    className="w-full text-sm border border-theme rounded-lg p-2 bg-surface min-h-[72px]"
                    disabled={readOnly}
                    value={asText(block.content.text)}
                    onChange={(event) =>
                      setBlockDrafts((rows) =>
                        rows.map((item) =>
                          item.id === block.id
                            ? { ...item, content: { ...item.content, text: event.target.value } }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {!readOnly && (
            <button
              type="button"
              className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white disabled:opacity-60"
              disabled={saving}
              onClick={() =>
                void run(async () => {
                  await saveActivityBlocks(
                    lessonId,
                    blockDrafts.map((block) => ({
                      id: block.id.startsWith('draft_') ? undefined : block.id,
                      blockType: block.blockType,
                      content: block.content,
                    })),
                  );
                })
              }
            >
              {lang === 'zh' ? '保存首页区块' : 'Save homepage blocks'}
            </button>
          )}
        </section>

        <section className="border border-theme rounded-xl p-4 bg-surface-secondary/40">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-semibold text-sm text-main">{lang === 'zh' ? '活动序列' : 'Activities'}</h3>
            {!readOnly && (
              <div className="flex flex-wrap gap-1">
                {ACTIVITY_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-theme bg-surface hover:bg-surface-secondary"
                      onClick={() =>
                        void run(async () => {
                          const created = await createActivity(lessonId, {
                            type,
                            title: labelOf(lang, ACTIVITY_TYPE_LABELS[type]),
                            visible: false,
                            required: type !== 'reading' ? true : false,
                          });
                          setSelectedId(created.activity.id);
                        })
                      }
                    >
                      <Plus size={12} />
                      <Icon size={12} />
                      {labelOf(lang, ACTIVITY_TYPE_LABELS[type])}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {activities.length === 0 ? (
            <p className="text-xs text-muted">
              {lang === 'zh'
                ? '还没有活动。先添加阅读、课件、测验或作品提交。'
                : 'No activities yet. Add a reading, courseware, quiz, or submission task.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {activities.map((activity, index) => {
                const Icon = TYPE_ICONS[activity.type];
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      data-testid={`activity-item-${activity.id}`}
                      onClick={() => setSelectedId(activity.id)}
                      className={`w-full text-left border rounded-lg px-3 py-2 flex items-center justify-between gap-2 ${
                        selectedId === activity.id ? 'border-indigo-400 bg-indigo-50/70' : 'border-theme bg-surface'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Icon size={14} />
                        {activity.title}
                      </span>
                      <span className="text-[11px] text-muted">
                        {labelOf(lang, ACTIVITY_TYPE_LABELS[activity.type])}
                        {activity.visible
                          ? lang === 'zh'
                            ? ' · 已发布'
                            : ' · Published'
                          : lang === 'zh'
                            ? ' · 草稿'
                            : ' · Draft'}
                        {activity.required ? (lang === 'zh' ? ' · 必做' : ' · Required') : ''}
                      </span>
                    </button>
                    {!readOnly && (
                      <div className="flex justify-end gap-1 mt-1">
                        <button
                          type="button"
                          className="p-1 text-muted"
                          onClick={() =>
                            void run(async () => {
                              await reorderActivities(
                                lessonId,
                                moveIds(
                                  activities.map((item) => item.id),
                                  index,
                                  -1,
                                ),
                              );
                            })
                          }
                          aria-label="Move activity up"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-muted"
                          onClick={() =>
                            void run(async () => {
                              await reorderActivities(
                                lessonId,
                                moveIds(
                                  activities.map((item) => item.id),
                                  index,
                                  1,
                                ),
                              );
                            })
                          }
                          aria-label="Move activity down"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-rose-600"
                          onClick={() =>
                            void run(async () => {
                              await deleteActivity(lessonId, activity.id);
                              setSelectedId(null);
                            })
                          }
                          aria-label="Delete activity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {selected && (
          <section className="border border-theme rounded-xl p-4 bg-surface">
            <h3 className="font-semibold text-sm text-main mb-3">{lang === 'zh' ? '活动设置' : 'Activity settings'}</h3>
            <div className="grid gap-3">
              <label className="text-xs font-semibold text-muted">
                {lang === 'zh' ? '标题' : 'Title'}
                <input
                  className="mt-1 w-full border border-theme rounded-lg px-2 py-1.5 text-sm bg-surface text-main font-normal"
                  disabled={readOnly}
                  value={selected.title}
                  onChange={(event) => patchDraft(selected.id, { title: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected.required}
                    onChange={(event) => patchDraft(selected.id, { required: event.target.checked })}
                  />
                  {lang === 'zh' ? '必做（计入课节完成）' : 'Required'}
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={selected.visible}
                    onChange={(event) => patchDraft(selected.id, { visible: event.target.checked })}
                  />
                  {lang === 'zh' ? '发布给学生' : 'Published'}
                </label>
              </div>
              {selected.type === 'reading' && (
                <label className="text-xs font-semibold text-muted">
                  {lang === 'zh' ? '阅读内容' : 'Reading body'}
                  <textarea
                    className="mt-1 w-full border border-theme rounded-lg px-2 py-1.5 text-sm bg-surface min-h-[140px] font-normal"
                    disabled={readOnly}
                    value={asText(selected.config.body)}
                    onChange={(event) => patchDraft(selected.id, { config: { body: event.target.value } })}
                  />
                </label>
              )}
              {selected.type === 'courseware' && (
                <AssetSelect
                  lang={lang}
                  label={lang === 'zh' ? '关联网页课件' : 'Linked courseware'}
                  value={asText(selected.config.coursewareId)}
                  options={options.courseware}
                  disabled={readOnly}
                  onChange={(value) => patchDraft(selected.id, { config: { coursewareId: value } })}
                />
              )}
              {selected.type === 'quiz' && (
                <AssetSelect
                  lang={lang}
                  label={lang === 'zh' ? '关联测验（测评中心）' : 'Linked assessment'}
                  value={asText(selected.config.assessmentId)}
                  options={options.assessments}
                  disabled={readOnly}
                  onChange={(value) => patchDraft(selected.id, { config: { assessmentId: value } })}
                />
              )}
              {selected.type === 'submission' && (
                <AssetSelect
                  lang={lang}
                  label={lang === 'zh' ? '关联作业（作业中心）' : 'Linked assignment'}
                  value={asText(selected.config.assignmentId)}
                  options={options.assignments}
                  disabled={readOnly}
                  onChange={(value) => patchDraft(selected.id, { config: { assignmentId: value } })}
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  className="self-start px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white disabled:opacity-60"
                  disabled={saving}
                  onClick={() =>
                    void run(async () => {
                      await updateActivity(lessonId, selected.id, {
                        title: selected.title,
                        required: selected.required,
                        visible: selected.visible,
                        config: selected.config,
                      });
                    })
                  }
                >
                  {lang === 'zh' ? '保存活动' : 'Save activity'}
                </button>
              )}
            </div>

            {!readOnly && (
              <div className="mt-6 border-t border-theme pt-4">
                <h4 className="font-semibold text-sm mb-2">
                  {lang === 'zh' ? '批阅与确认（不重复记分）' : 'Review and verify (no double scoring)'}
                </h4>
                <p className="text-xs text-muted mb-3">
                  {lang === 'zh'
                    ? '课件、测验、作品的分数仍以原系统为准。这里只更新活动进度与 verified；积分走既有加分接口。'
                    : 'Quiz, courseware, and assignment scores stay in their original systems. This panel only updates activity progress and verification.'}
                </p>
                {progressRows.length === 0 ? (
                  <p className="text-xs text-muted">
                    {lang === 'zh' ? '还没有学生进度。' : 'No student progress yet.'}
                  </p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1">{lang === 'zh' ? '学生' : 'Student'}</th>
                        <th>{lang === 'zh' ? '状态' : 'Status'}</th>
                        <th>verified</th>
                        <th>{lang === 'zh' ? '分数' : 'Score'}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {progressRows.map((row) => (
                        <tr key={row.studentId} className="border-t border-theme">
                          <td className="py-1 font-mono">{row.studentId}</td>
                          <td>{row.status}</td>
                          <td>{row.verified ? 'yes' : 'no'}</td>
                          <td>{row.score ?? '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="text-indigo-600 font-semibold"
                              onClick={() =>
                                void run(async () => {
                                  await verifyActivityProgress(lessonId, selected.id, row.studentId);
                                })
                              }
                            >
                              {lang === 'zh' ? '确认完成' : 'Verify'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="mt-3 grid gap-2 @md:grid-cols-2">
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder={lang === 'zh' ? '学生 ID' : 'Student ID'}
                    value={gradeForm.studentId}
                    onChange={(event) => setGradeForm((f) => ({ ...f, studentId: event.target.value }))}
                  />
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder={lang === 'zh' ? '分数（可选）' : 'Score (optional)'}
                    value={gradeForm.score}
                    onChange={(event) => setGradeForm((f) => ({ ...f, score: event.target.value }))}
                  />
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs @md:col-span-2"
                    placeholder={lang === 'zh' ? '评语' : 'Feedback'}
                    value={gradeForm.feedback}
                    onChange={(event) => setGradeForm((f) => ({ ...f, feedback: event.target.value }))}
                  />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-theme"
                    disabled={!gradeForm.studentId || saving}
                    onClick={() =>
                      void run(async () => {
                        if (gradeForm.score.trim()) {
                          await gradeActivityProgress(lessonId, selected.id, gradeForm.studentId, {
                            score: Number(gradeForm.score),
                            feedback: gradeForm.feedback || null,
                          });
                        } else {
                          await verifyActivityProgress(lessonId, selected.id, gradeForm.studentId, {
                            feedback: gradeForm.feedback || null,
                          });
                        }
                      })
                    }
                  >
                    {lang === 'zh' ? '确认 / 给分' : 'Verify / grade'}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 @md:grid-cols-2">
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder="classId"
                    value={gradeForm.classId}
                    onChange={(event) => setGradeForm((f) => ({ ...f, classId: event.target.value }))}
                  />
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder="dimensionId"
                    value={gradeForm.dimensionId}
                    onChange={(event) => setGradeForm((f) => ({ ...f, dimensionId: event.target.value }))}
                  />
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder={lang === 'zh' ? '积分变动' : 'Points delta'}
                    value={gradeForm.points}
                    onChange={(event) => setGradeForm((f) => ({ ...f, points: event.target.value }))}
                  />
                  <input
                    className="border border-theme rounded-lg px-2 py-1 text-xs"
                    placeholder={lang === 'zh' ? '加分原因' : 'Reason'}
                    value={gradeForm.reason}
                    onChange={(event) => setGradeForm((f) => ({ ...f, reason: event.target.value }))}
                  />
                </div>
                <button
                  type="button"
                  className="mt-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-theme"
                  disabled={
                    !gradeForm.studentId ||
                    !gradeForm.classId ||
                    !gradeForm.dimensionId ||
                    !gradeForm.points ||
                    !gradeForm.reason ||
                    saving
                  }
                  onClick={() =>
                    void run(async () => {
                      await awardStudentPoints(gradeForm.studentId, {
                        classId: gradeForm.classId,
                        dimensionId: gradeForm.dimensionId,
                        deltaPoints: Number(gradeForm.points),
                        reason: gradeForm.reason,
                      });
                    })
                  }
                >
                  {lang === 'zh' ? '发放积分（既有接口）' : 'Award points (existing API)'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function AssetSelect({
  lang,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  lang: 'zh' | 'en';
  label: string;
  value: string;
  options: Array<{ id: string; name?: string; title?: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <select
        className="mt-1 w-full border border-theme rounded-lg px-2 py-1.5 text-sm bg-surface font-normal"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{lang === 'zh' ? '请选择…' : 'Select…'}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title || item.name || item.id}
          </option>
        ))}
      </select>
    </label>
  );
}

function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const next = index + delta;
  if (next < 0 || next >= items.length) return items;
  const copy = items.slice();
  const [row] = copy.splice(index, 1);
  copy.splice(next, 0, row);
  return copy;
}

function moveIds(ids: string[], index: number, delta: number): string[] {
  return moveItem(ids, index, delta);
}
