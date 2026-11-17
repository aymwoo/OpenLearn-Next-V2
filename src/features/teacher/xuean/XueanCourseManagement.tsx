/**
 * 学案课程管理（教师端独立入口，teacherTab === 'xuean_courses'）。
 *
 * 两级管理：学案课程（courses）→ 课时（lessons.course_id）。
 * 点课时「编辑学案」跳到现有 XueanEditor；全程不依赖互动白板。
 * 弹窗统一复用 AccessibleDialog（原生 <dialog> + showModal）。
 */
import { useId, useRef, useState, useEffect, useCallback } from 'react';
import { BookOpenCheck, Plus, Search, Edit3, Trash2, ArrowLeft, Loader2, Users, Layers, Eye } from 'lucide-react';
import { useAppData } from '../../../context/AppDataContext';
import AccessibleDialog from '../../../components/AccessibleDialog';
import { deleteLesson } from '../../../services/lessonService';
import {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  createCourseLesson,
  type CoursePayload,
} from '../../../services/courseService';
import type { Course, CourseDetail, Lesson } from '../../../types/app';

type FormMode = 'create' | 'edit';

const EMPTY_DRAFT: CoursePayload = { title: '', description: '', term: '', visibility: 'private' };

function formatDate(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString();
}

export function XueanCourseManagement() {
  const { fetchLessons, setSelectedLesson, setTeacherTab } = useAppData();

  const [courses, setCourses] = useState<Course[]>([]);
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>('create');
  const [formCourseId, setFormCourseId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CoursePayload>(EMPTY_DRAFT);
  const [formError, setFormError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const [deleteCourseTarget, setDeleteCourseTarget] = useState<Course | null>(null);
  const [deleteLessonTarget, setDeleteLessonTarget] = useState<Lesson | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [actionError, setActionError] = useState('');

  const uid = useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const termId = `${uid}-term`;
  const visId = `${uid}-vis`;
  const formTitleId = `${uid}-form-title`;
  const formErrorId = `${uid}-form-error`;
  const delCourseTitleId = `${uid}-del-course-title`;
  const delLessonTitleId = `${uid}-del-lesson-title`;

  const refreshList = useCallback(async () => {
    setLoading(true);
    const res = await getCourses();
    setLoading(false);
    if (res.ok) {
      setCourses(res.data ?? []);
      setListError('');
    } else {
      setListError(res.error?.error ?? '加载学案课程失败');
    }
  }, []);

  const refreshDetail = useCallback(async (courseId: string) => {
    setBusy(true);
    const res = await getCourse(courseId);
    setBusy(false);
    if (res.ok && res.data) {
      setDetail(res.data);
      setActionError('');
    } else {
      setActionError(res.error?.error ?? '加载课时失败');
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const openCreate = () => {
    setFormMode('create');
    setFormCourseId(null);
    setDraft(EMPTY_DRAFT);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (course: Course) => {
    setFormMode('edit');
    setFormCourseId(course.id);
    setDraft({
      title: course.title,
      description: course.description ?? '',
      term: course.term ?? '',
      visibility: course.visibility === 'school' ? 'school' : 'private',
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft.title?.trim()) {
      setFormError('请填写课程名称');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setFormError('');
    const payload: CoursePayload = {
      title: draft.title.trim(),
      description: draft.description ?? '',
      term: draft.term ?? '',
      visibility: draft.visibility === 'school' ? 'school' : 'private',
    };
    const res =
      formMode === 'create' || !formCourseId ? await createCourse(payload) : await updateCourse(formCourseId, payload);
    setBusy(false);
    if (!res.ok) {
      setFormError(res.error?.error ?? '保存失败');
      return;
    }
    setFormOpen(false);
    await refreshList();
    if (formMode === 'edit' && formCourseId) {
      if (detail?.id === formCourseId) await refreshDetail(formCourseId);
    }
  };

  const handleDeleteCourse = async () => {
    if (!deleteCourseTarget) return;
    setBusy(true);
    const res = await deleteCourse(deleteCourseTarget.id);
    setBusy(false);
    setDeleteCourseTarget(null);
    if (res.ok) {
      if (detail?.id === deleteCourseTarget.id) setDetail(null);
      await refreshList();
    } else {
      setActionError(res.error?.error ?? '删除课程失败');
    }
  };

  const handleAddLesson = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!detail || !lessonTitle.trim()) return;
    setBusy(true);
    const res = await createCourseLesson(detail.id, lessonTitle.trim());
    setBusy(false);
    if (res.ok) {
      setLessonTitle('');
      await refreshDetail(detail.id);
      await refreshList();
    } else {
      setActionError(res.error?.error ?? '新增课时失败');
    }
  };

  const handleEditLesson = async (lesson: Lesson) => {
    await fetchLessons();
    setSelectedLesson(lesson.id);
    setTeacherTab('xuean_editor');
  };

  const handleDeleteLesson = async () => {
    if (!deleteLessonTarget || !detail) return;
    setBusy(true);
    const res = await deleteLesson(deleteLessonTarget.id);
    setBusy(false);
    setDeleteLessonTarget(null);
    if (res.ok) {
      await refreshDetail(detail.id);
      await refreshList();
    } else {
      setActionError(res.data?.error ?? '删除课时失败');
    }
  };

  const visibleCourses = courses.filter((c) => {
    const q = search.trim().toLowerCase();
    return !q || c.title.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q);
  });

  // ── 课程详情（课时管理）──────────────────────────────────────────────
  if (detail) {
    return (
      <div className="flex-1 flex flex-col min-h-0 gap-4 overflow-y-auto">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main"
            >
              <ArrowLeft size={13} /> 返回列表
            </button>
            <h1 className="text-lg font-black text-main truncate">{detail.title}</h1>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-theme text-muted">
              {detail.visibility === 'school' ? '校内' : '私有'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => openEdit(detail)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main"
          >
            <Edit3 size={13} /> 编辑课程
          </button>
        </div>

        {detail.description && <p className="text-sm text-muted whitespace-pre-wrap">{detail.description}</p>}

        <div className="flex items-center gap-2 text-xs text-muted">
          <span>学期：{detail.term || '未设置'}</span>
          <span>·</span>
          <span>共 {detail.lessons.length} 个课时</span>
          <span>·</span>
          <span>更新于 {formatDate(detail.updated_at)}</span>
        </div>

        {actionError && (
          <p role="alert" className="text-xs text-red-500 border border-red-500/40 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}

        {/* 新增课时 */}
        <form
          onSubmit={handleAddLesson}
          className="flex items-center gap-2 p-3 rounded-xl border border-theme bg-surface"
        >
          <label htmlFor={`${uid}-new-lesson`} className="text-xs font-bold text-muted shrink-0">
            新增课时
          </label>
          <input
            id={`${uid}-new-lesson`}
            name="lessonTitle"
            type="text"
            value={lessonTitle}
            onChange={(e) => setLessonTitle(e.target.value)}
            placeholder="输入课时名称，如：第 1 课时 认识图形"
            maxLength={120}
            className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-lg border border-theme bg-surface-secondary text-main"
          />
          <button
            type="submit"
            disabled={busy || !lessonTitle.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 添加
          </button>
        </form>

        {/* 课时列表 */}
        <div className="rounded-xl border border-theme bg-surface divide-y divide-theme overflow-hidden">
          {busy && detail.lessons.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted text-sm">
              <Loader2 size={16} className="animate-spin" /> 加载中…
            </div>
          ) : detail.lessons.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">还没有课时，先在上方新增一个吧</div>
          ) : (
            detail.lessons.map((lesson) => (
              <div key={lesson.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers size={14} className="text-primary-theme shrink-0" />
                  <span className="text-sm font-semibold text-main truncate">{lesson.title}</span>
                  <span className="text-[10px] text-muted shrink-0">{formatDate(lesson.created_at)}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleEditLesson(lesson)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary text-main"
                    title="进入学案编辑器，编辑该课时的学案"
                  >
                    <Eye size={13} /> 编辑学案
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteLessonTarget(lesson)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10"
                    title="删除课时（会一并清理该课时的学案活动与进度）"
                  >
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 删除课时确认 */}
        <AccessibleDialog
          open={!!deleteLessonTarget}
          onClose={() => setDeleteLessonTarget(null)}
          ariaLabelledBy={delLessonTitleId}
          closedBy="any"
          className="w-full max-w-sm p-5 rounded-2xl border border-theme bg-surface shadow-2xl text-main"
        >
          <h2 id={delLessonTitleId} className="text-base font-black mb-2">
            删除课时
          </h2>
          <p className="text-sm text-muted mb-1">
            确定删除「{deleteLessonTarget?.title}」？该课时的学案活动、首页块与学习进度会一并清除，且不可恢复。
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              autoFocus
              onClick={() => setDeleteLessonTarget(null)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface-secondary"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeleteLesson()}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500 text-white disabled:opacity-40"
            >
              确认删除
            </button>
          </div>
        </AccessibleDialog>
      </div>
    );
  }

  // ── 课程列表 ────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 gap-4 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpenCheck size={20} className="text-primary-theme" />
          <h1 className="text-lg font-black text-main">学案课程管理</h1>
          <span className="text-xs text-muted">管理学案课程与课时，不依赖互动白板</span>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white hover:opacity-90"
        >
          <Plus size={14} /> 新建学案课程
        </button>
      </div>

      <search className="flex items-center gap-2 px-3 py-2 rounded-xl border border-theme bg-surface">
        <Search size={15} className="text-muted shrink-0" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索课程名称或描述"
          aria-label="搜索学案课程"
          className="flex-1 min-w-0 bg-transparent text-sm text-main outline-none"
        />
      </search>

      {listError && (
        <p role="alert" className="text-xs text-red-500 border border-red-500/40 rounded-lg px-3 py-2">
          {listError}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted text-sm">
          <Loader2 size={18} className="animate-spin" /> 加载中…
        </div>
      ) : visibleCourses.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">
          {search ? '没有匹配的学案课程' : '还没有学案课程，点击右上角「新建学案课程」开始'}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {visibleCourses.map((course) => (
            <div
              key={course.id}
              className="flex flex-col gap-2 p-4 rounded-2xl border border-theme bg-surface hover:border-primary-theme transition"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-black text-main truncate">{course.title}</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-theme text-muted shrink-0">
                  {course.visibility === 'school' ? '校内' : '私有'}
                </span>
              </div>
              <p className="text-xs text-muted line-clamp-2 min-h-[2rem]">{course.description || '暂无描述'}</p>
              <div className="flex items-center gap-3 text-[10px] text-muted">
                <span className="flex items-center gap-1">
                  <Layers size={11} /> {course.lesson_count ?? 0} 课时
                </span>
                <span className="flex items-center gap-1">
                  <Users size={11} /> {course.enrollment_count ?? 0} 人
                </span>
                <span>更新于 {formatDate(course.updated_at)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => void refreshDetail(course.id)}
                  className="flex-1 px-2.5 py-1.5 text-xs font-bold rounded-lg bg-surface-secondary text-main hover:bg-primary-theme hover:text-white"
                >
                  查看课时
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(course)}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface-secondary"
                  title="编辑课程"
                >
                  <Edit3 size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteCourseTarget(course)}
                  className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10"
                  title="删除课程"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建 / 编辑课程 */}
      <AccessibleDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        ariaLabelledBy={formTitleId}
        closedBy="closerequest"
        className="w-full max-w-md p-5 rounded-2xl border border-theme bg-surface shadow-2xl text-main"
      >
        <h2 id={formTitleId} className="text-base font-black mb-4">
          {formMode === 'create' ? '新建学案课程' : '编辑学案课程'}
        </h2>
        <form onSubmit={submitForm} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={titleId} className="text-xs font-bold text-main">
              课程名称 <span aria-hidden="true">*</span>
            </label>
            <input
              id={titleId}
              name="title"
              ref={titleRef}
              type="text"
              autoFocus
              required
              maxLength={120}
              value={draft.title ?? ''}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                if (formError) setFormError('');
              }}
              aria-invalid={!!formError}
              aria-describedby={formError ? formErrorId : undefined}
              className="px-3 py-2 text-sm rounded-lg border border-theme bg-surface-secondary text-main"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={descId} className="text-xs font-bold text-main">
              课程描述
            </label>
            <textarea
              id={descId}
              name="description"
              rows={3}
              maxLength={2000}
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-theme bg-surface-secondary text-main resize-y"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={termId} className="text-xs font-bold text-main">
              学期
            </label>
            <input
              id={termId}
              name="term"
              type="text"
              maxLength={60}
              placeholder="如：2026 秋季"
              value={draft.term ?? ''}
              onChange={(e) => setDraft({ ...draft, term: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-theme bg-surface-secondary text-main"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={visId} className="text-xs font-bold text-main">
              可见范围
            </label>
            <select
              id={visId}
              name="visibility"
              value={draft.visibility ?? 'private'}
              onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}
              className="px-3 py-2 text-sm rounded-lg border border-theme bg-surface-secondary text-main"
            >
              <option value="private">私有（仅课程教师）</option>
              <option value="school">校内（本校教师可见）</option>
            </select>
          </div>
          {formError && (
            <p id={formErrorId} role="alert" className="text-xs text-red-500">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface-secondary"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 text-xs font-bold rounded-lg bg-primary-theme text-white disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin inline" /> : null} 保存
            </button>
          </div>
        </form>
      </AccessibleDialog>

      {/* 删除课程确认 */}
      <AccessibleDialog
        open={!!deleteCourseTarget}
        onClose={() => setDeleteCourseTarget(null)}
        ariaLabelledBy={delCourseTitleId}
        closedBy="any"
        className="w-full max-w-sm p-5 rounded-2xl border border-theme bg-surface shadow-2xl text-main"
      >
        <h2 id={delCourseTitleId} className="text-base font-black mb-2">
          删除学案课程
        </h2>
        <p className="text-sm text-muted">
          确定删除「{deleteCourseTarget?.title}」？课程下的课时会被保留，但不再归属该课程。
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            autoFocus
            onClick={() => setDeleteCourseTarget(null)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-theme text-main hover:bg-surface-secondary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDeleteCourse()}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-500 text-white disabled:opacity-40"
          >
            确认删除
          </button>
        </div>
      </AccessibleDialog>
    </div>
  );
}

export default XueanCourseManagement;
