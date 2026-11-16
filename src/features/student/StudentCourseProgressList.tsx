import { useEffect, useState } from 'react';
import { BookOpen, PlayCircle } from 'lucide-react';
import { fetchMyActivityPacks } from '../lesson-activity-pack';

export interface StudentCourseProgressListProps {
  progress: any[];
  setSelectedLesson: (lessonId: string) => void;
  setStudentViewStatus: (status: 'dashboard' | 'lesson' | 'assignment') => void;
  onOpenActivityPack?: (lessonId: string) => void;
  lang?: 'zh' | 'en';
}

export function StudentCourseProgressList(props: StudentCourseProgressListProps) {
  const { progress, setSelectedLesson, setStudentViewStatus, onOpenActivityPack, lang = 'zh' } = props;
  const [packIds, setPackIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!onOpenActivityPack || !progress?.length) return;
    const lessonIds = progress.map((item: { lesson_id?: string }) => item.lesson_id).filter(Boolean) as string[];
    if (lessonIds.length === 0) return;
    let cancelled = false;
    fetchMyActivityPacks(lessonIds)
      .then((result) => {
        if (cancelled) return;
        setPackIds(new Set(result.packs.filter((pack) => pack.activityCount > 0).map((pack) => pack.lessonId)));
      })
      .catch(() => {
        if (!cancelled) setPackIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [progress, onOpenActivityPack]);

  return (
    <div className="flex flex-col">
      <div>
        {progress && progress.length === 0 ? (
          <div className="text-center p-8 text-gray-400 italic text-sm">No courses assigned yet.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            {progress?.map((p: any) => (
              <div
                key={p.lesson_id}
                className="flex flex-col p-4 rounded-xl border border-gray-100 bg-gray-50 hover:border-teal-200 hover:shadow-sm transition-all focus:outline-none"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="font-semibold text-gray-800 text-lg">{p.lesson_title}</div>
                  {p.completed === 1 && (
                    <span className="bg-green-100 text-green-800 text-xs px-1.5 py-0.5 rounded uppercase font-bold">
                      Completed
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden shrink-0">
                    <div
                      className={`h-full ${p.progress_percent === 100 ? 'bg-green-500' : 'bg-teal-500'}`}
                      style={{ width: `${p.progress_percent}%` }}
                    ></div>
                  </div>
                  <span className="text-xs text-gray-500 font-medium shrink-0">{p.progress_percent}%</span>
                </div>
                <div className="flex flex-col gap-2 mt-auto">
                  <button
                    onClick={() => {
                      setSelectedLesson(p.lesson_id);
                      setStudentViewStatus('lesson');
                    }}
                    className="w-full flex justify-center items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors"
                  >
                    {p.progress_percent === 0 ? (
                      <>
                        <PlayCircle size={16} /> Start Learning
                      </>
                    ) : (
                      <>
                        <PlayCircle size={16} /> Continue
                      </>
                    )}
                  </button>
                  {onOpenActivityPack && packIds.has(p.lesson_id) && (
                    <button
                      type="button"
                      onClick={() => onOpenActivityPack(p.lesson_id)}
                      className="w-full flex justify-center items-center gap-2 border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
                    >
                      <BookOpen size={16} />
                      {lang === 'zh' ? '打开学案' : 'Open lesson pack'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
