import { useEffect, useState } from 'react';
import { fetchCourse, fetchCourses, type CourseLessonRef, type CourseRecord } from './p1-api';
import { CourseDiscussionBoard } from './CourseDiscussionBoard';

export function StudentCourseLayer({
  lang,
  onOpenActivityPack,
}: {
  lang: 'zh' | 'en';
  onOpenActivityPack?: (lessonId: string) => void;
}) {
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [lessons, setLessons] = useState<CourseLessonRef[]>([]);
  const [courseId, setCourseId] = useState<string | null>(null);

  useEffect(() => {
    void fetchCourses()
      .then((result) => setCourses(result.courses))
      .catch(() => setCourses([]));
  }, []);

  if (courses.length === 0) return null;

  return (
    <section
      className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3"
      data-testid="student-course-layer"
    >
      <h3 className="font-semibold text-slate-800">{lang === 'zh' ? '我的课程' : 'My courses'}</h3>
      <div className="flex flex-wrap gap-2">
        {courses.map((course) => (
          <button
            key={course.id}
            type="button"
            className={`px-3 py-1.5 text-sm rounded-lg border ${courseId === course.id ? 'bg-indigo-50 border-indigo-200' : 'border-slate-200'}`}
            onClick={() => {
              setCourseId(course.id);
              void fetchCourse(course.id).then((result) => setLessons(result.lessons));
            }}
          >
            {course.title}
          </button>
        ))}
      </div>
      {courseId && (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="flex items-center justify-between">
                <span>{lesson.title}</span>
                {onOpenActivityPack && (
                  <button
                    type="button"
                    className="text-indigo-700 text-xs underline"
                    onClick={() => onOpenActivityPack(lesson.id)}
                  >
                    {lang === 'zh' ? '打开学案' : 'Open pack'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <CourseDiscussionBoard courseId={courseId} lang={lang} />
        </>
      )}
    </section>
  );
}
