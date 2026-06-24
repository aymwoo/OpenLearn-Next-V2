import { lazy } from 'react';

export const CoursewareViewer = lazy(() =>
  import('./InteractiveCoursewareViewer').then((m) => ({ default: m.InteractiveCoursewareViewer })),
);
