import { useEffect, useState } from 'react';
import {
  attachCourseLessons,
  createCourse,
  enrollCourseClass,
  fetchCourse,
  fetchCourses,
  startCourseLessonSession,
  type CourseLessonRef,
  type CourseRecord,
} from './p1-api';
import { CourseDiscussionBoard } from './CourseDiscussionBoard';

export function CourseLayerBoard({
  lang,
  lessons,
  classes,
}: {
  lang: 'zh' | 'en';
  lessons: Array<{ id: string; title: string }>;
  classes: Array<{ id: string; name: string }>;
}) {
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLessons, setDetailLessons] = useState<CourseLessonRef[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () => fetchCourses().then((result) => setCourses(result.courses));

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const openCourse = (courseId: string) => {
    setSelectedId(courseId);
    void fetchCourse(courseId)
      .then((result) => setDetailLessons(result.lessons))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  return (
    <section className="p-4 flex flex-col gap-4" data-testid="course-layer-board">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-gray-700">{lang === 'zh' ? '课程层（长周期课程）' : 'Course layer'}</h3>
        <input
          className="border border-gray-200 rounded px-2 py-1 text-sm"
          placeholder={lang === 'zh' ? '新课程标题' : 'New course title'}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button
          type="button"
          className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg"
          onClick={() => {
            if (!title.trim()) return;
            void createCourse({ title })
              .then((result) => {
                setTitle('');
                return load().then(() => openCourse(result.course.id));
              })
              .catch((err) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          {lang === 'zh' ? '新建课程' : 'Create course'}
        </button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      <div className="grid gap-4 @lg:grid-cols-[240px_minmax(0,1fr)]">
        <ul className="flex flex-col gap-1">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedId === course.id ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50'}`}
                onClick={() => openCourse(course.id)}
              >
                {course.title}
                <span className="block text-[11px] text-gray-500">
                  {course.lessonCount ?? 0} {lang === 'zh' ? '个章节' : 'chapters'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selectedId && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <select
                id="course-attach-lesson"
                className="border border-gray-200 rounded px-2 py-1 text-xs"
                defaultValue=""
                onChange={(event) => {
                  const lessonId = event.target.value;
                  event.target.value = '';
                  if (!lessonId) return;
                  void attachCourseLessons(selectedId, [lessonId]).then((result) => setDetailLessons(result.lessons));
                }}
              >
                <option value="">{lang === 'zh' ? '挂接课节…' : 'Attach lesson…'}</option>
                {lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </option>
                ))}
              </select>
              <select
                className="border border-gray-200 rounded px-2 py-1 text-xs"
                defaultValue=""
                onChange={(event) => {
                  const classId = event.target.value;
                  event.target.value = '';
                  if (!classId) return;
                  void enrollCourseClass(selectedId, classId);
                }}
              >
                <option value="">{lang === 'zh' ? '选课班级…' : 'Enroll class…'}</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <ul className="flex flex-col gap-2">
              {detailLessons.map((lesson) => (
                <li
                  key={lesson.id}
                  className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-sm"
                >
                  <span>{lesson.title}</span>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs bg-emerald-600 text-white rounded"
                    onClick={() => {
                      const classId = classes[0]?.id;
                      void startCourseLessonSession(selectedId, lesson.id, classId)
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
                    }}
                  >
                    {lang === 'zh' ? '一键开课次' : 'Start session'}
                  </button>
                </li>
              ))}
            </ul>
            <CourseDiscussionBoard courseId={selectedId} lang={lang} />
          </div>
        )}
      </div>
    </section>
  );
}
