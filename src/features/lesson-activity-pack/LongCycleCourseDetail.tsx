import { useEffect, useState } from 'react';
import {
  attachCourseLessons,
  fetchCourse,
  startCourseLessonSession,
  updateCourse,
  type CourseLessonRef,
  type CourseRecord,
} from './p1-api';
import { CourseDiscussionBoard } from './CourseDiscussionBoard';

const MIN_HOURS = 3;
const MAX_HOURS = 30 * 24;

export function LongCycleCourseDetail({
  lang,
  courseId,
  lessons,
  classes,
  onClose,
  onChanged,
}: {
  lang: 'zh' | 'en';
  courseId: string;
  lessons: Array<{ id: string; title: string }>;
  classes: Array<{ id: string; name: string }>;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [course, setCourse] = useState<CourseRecord | null>(null);
  const [detailLessons, setDetailLessons] = useState<CourseLessonRef[]>([]);
  const [sessionClassId, setSessionClassId] = useState('');
  const [archiveHours, setArchiveHours] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingArchive, setSavingArchive] = useState(false);

  const load = () =>
    fetchCourse(courseId)
      .then((courseResult) => {
        setCourse(courseResult.course);
        setDetailLessons(courseResult.lessons);
        setArchiveHours(
          courseResult.course.autoArchiveAfterMs == null
            ? ''
            : String(Math.round(Number(courseResult.course.autoArchiveAfterMs) / (60 * 60 * 1000))),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    void load();
    // 仅在打开的课程变化时重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const attachedIds = new Set(detailLessons.map((item) => item.id));
  const attachableLessons = lessons.filter((item) => !attachedIds.has(item.id));

  const saveArchiveThreshold = () => {
    setSavingArchive(true);
    const raw = archiveHours.trim();
    const autoArchiveAfterMs = raw ? Math.round(Number(raw) * 60 * 60 * 1000) : null;
    void updateCourse(courseId, { autoArchiveAfterMs })
      .then((result) => {
        setCourse(result.course);
        onChanged?.();
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingArchive(false));
  };

  const startSession = (lessonId: string) => {
    if (!sessionClassId) {
      setError(lang === 'zh' ? '请先选择要开课的班级' : 'Please select a class before starting a session');
      return;
    }
    void startCourseLessonSession(courseId, lessonId, sessionClassId)
      .then((result) => {
        window.alert(
          lang === 'zh'
            ? result.created
              ? '已为该章节开启新课次'
              : '已回到进行中的课次'
            : result.created
              ? 'Started a new session for this chapter'
              : 'Resumed the in-progress session',
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[9999] p-4"
      data-testid="long-cycle-course-detail"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full border border-gray-100 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 bg-amber-50 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-amber-900 text-sm flex items-center gap-2">
              <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                {lang === 'zh' ? '长周期' : 'Long-cycle'}
              </span>
              <span>{course?.title || (lang === 'zh' ? '课程详情' : 'Course details')}</span>
            </h3>
            <p className="text-xs text-amber-800/80 mt-0.5">
              {lang === 'zh'
                ? '讲完只结束本次课次，课程保持进行中。可继续添加章节；开课次时再选择并绑定班级。'
                : 'Ending a session keeps the course in progress. Manage chapters here, and bind a class when you start a session.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-xl leading-none px-1"
            aria-label={lang === 'zh' ? '关闭' : 'Close'}
          >
            &times;
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex flex-wrap gap-2 items-end">
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              <span className="font-bold uppercase tracking-wider">
                {lang === 'zh' ? '开课班级' : 'Class for this session'}
              </span>
              <select
                data-testid="long-cycle-session-class"
                className="border border-gray-200 rounded px-2 py-1 text-xs min-w-[160px]"
                value={sessionClassId}
                onChange={(event) => {
                  setSessionClassId(event.target.value);
                  setError(null);
                }}
              >
                <option value="">{lang === 'zh' ? '请选择班级…' : 'Select a class…'}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <select
              className="border border-gray-200 rounded px-2 py-1 text-xs"
              defaultValue=""
              onChange={(event) => {
                const lessonId = event.target.value;
                event.target.value = '';
                if (!lessonId) return;
                void attachCourseLessons(courseId, [lessonId])
                  .then((result) => {
                    setDetailLessons(result.lessons);
                    onChanged?.();
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)));
              }}
            >
              <option value="">{lang === 'zh' ? '引用常规课为章节…' : 'Reference a regular course…'}</option>
              {attachableLessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">
            {lang === 'zh'
              ? '同一门常规课可以被多门长周期课程同时引用。请先选择要开课的班级，再点「一键开课次」，系统会在开课时绑定该班级。'
              : 'The same regular course can be referenced by multiple long-cycle courses. Select a class first, then start the session; the class is bound when the session starts.'}
          </p>
          <div className="flex flex-wrap items-end gap-2 text-xs text-gray-600">
            <label className="flex flex-col gap-1">
              <span className="font-bold uppercase tracking-wider">
                {lang === 'zh' ? '课次自动归档阈值' : 'Auto-archive threshold'}
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={MIN_HOURS}
                  max={MAX_HOURS}
                  placeholder={lang === 'zh' ? '跟站点默认' : 'Site default'}
                  value={archiveHours}
                  onChange={(event) => setArchiveHours(event.target.value)}
                  className="w-28 border border-gray-200 rounded px-2 py-1 text-xs"
                />
                <span>
                  {lang === 'zh' ? '小时（3 小时–30 天，留空跟站点默认）' : 'hours (3h–30d, blank = site default)'}
                </span>
              </span>
            </label>
            <button
              type="button"
              className="px-2 py-1 text-xs bg-white border border-gray-200 rounded disabled:opacity-50"
              disabled={savingArchive}
              onClick={saveArchiveThreshold}
            >
              {lang === 'zh' ? '保存阈值' : 'Save threshold'}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {detailLessons.map((lesson, index) => (
              <li
                key={lesson.id}
                className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <span>
                  <span className="text-xs text-gray-400 mr-2">
                    {lang === 'zh' ? `第 ${index + 1} 章` : `Ch. ${index + 1}`}
                  </span>
                  {lesson.title}
                </span>
                <button
                  type="button"
                  className="px-2 py-1 text-xs bg-emerald-600 text-white rounded"
                  onClick={() => startSession(lesson.id)}
                >
                  {lang === 'zh' ? '一键开课次' : 'Start session'}
                </button>
              </li>
            ))}
            {detailLessons.length === 0 && (
              <li className="text-xs text-gray-500">
                {lang === 'zh' ? '还没有章节，请挂接课节。' : 'No chapters yet. Attach a lesson.'}
              </li>
            )}
          </ul>
          <CourseDiscussionBoard courseId={courseId} lang={lang} />
        </div>
      </div>
    </div>
  );
}
