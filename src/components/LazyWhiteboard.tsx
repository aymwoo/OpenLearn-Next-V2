import { Suspense, lazy } from 'react';

const Whiteboard = lazy(() =>
  import('../features/whiteboard/InteractiveWhiteboard').then((m) => ({
    default: m.InteractiveWhiteboard,
  })),
);

export function LazyWhiteboard(props: any) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full bg-gray-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
        </div>
      }
    >
      <Whiteboard {...props} />
    </Suspense>
  );
}
