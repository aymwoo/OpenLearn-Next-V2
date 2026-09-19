import { Suspense, lazy } from 'react';

const CoursewareViewer = lazy(() => import('../features/courseware/InteractiveCoursewareViewer'));

export interface LazyCoursewareProps {
  coursewareId: string | null;
  onClose?: () => void;
}

export function LazyCourseware(props: LazyCoursewareProps) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full bg-gray-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      }
    >
      <CoursewareViewer {...props} />
    </Suspense>
  );
}
