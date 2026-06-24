import { Suspense, lazy } from 'react';

const CoursewareViewer = lazy(() => import('../features/courseware/index').then((m) => ({ default: m.CoursewareViewer })));

export function LazyCourseware(props: any) {
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
