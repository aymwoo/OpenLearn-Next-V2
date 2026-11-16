/**
 * 学案编辑器（教师端主入口，IKVO15 · P0）。
 * teacherTab === 'xuean_editor' 时渲染。
 * 内部两个 sub-tab：活动编排 / 学案首页块；支持教师预览（模拟学生视角）。
 */
import { Suspense, lazy, useState } from 'react';
import { useOptionalAppData } from '../../../context/AppDataContext.js';
import { Loader2, Eye } from 'lucide-react';

const XueanActivitiesPanel = lazy(() =>
  import('./XueanActivitiesPanel').then((m) => ({ default: m.XueanActivitiesPanel })),
);
const XueanBlocksEditor = lazy(() => import('./XueanBlocksEditor').then((m) => ({ default: m.XueanBlocksEditor })));
const StudentXueanView = lazy(() =>
  import('../../student/xuean/StudentXueanView').then((m) => ({ default: m.StudentXueanView })),
);

type SubTab = 'activities' | 'blocks';

export function XueanEditor() {
  const appData = useOptionalAppData();
  const selectedLesson = appData?.selectedLesson ?? '';
  const lessons: any[] = (appData?.lessons as any[]) ?? [];
  const lessonTitle = lessons.find((l) => l.id === selectedLesson)?.title ?? '未选择课时';

  const [subTab, setSubTab] = useState<SubTab>('activities');
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0 bg-surface rounded-2xl border border-theme overflow-hidden">
        {/* 顶部：标题 + sub-tab + 预览按钮 */}
        <div className="px-4 py-2.5 border-b border-theme bg-surface/85 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">学案编辑器</span>
              <span className="text-xs text-muted truncate">· {lessonTitle}</span>
            </div>

            <div className="flex items-center gap-2">
              {/* sub-tab 切换（selection follows focus，aria-selected 指示选中态） */}
              <div
                role="tablist"
                aria-label="学案编辑器子面板"
                className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5"
              >
                <TabButton role="tab" selected={subTab === 'activities'} onClick={() => setSubTab('activities')}>
                  活动编排
                </TabButton>
                <TabButton role="tab" selected={subTab === 'blocks'} onClick={() => setSubTab('blocks')}>
                  学案首页
                </TabButton>
              </div>

              {/* 教师预览（模拟学生视角，Issue 里 P1 能力先让它能跑） */}
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                disabled={!selectedLesson}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-theme hover:bg-surface-secondary disabled:opacity-40 text-main"
                title="以学生视角预览学案"
              >
                <Eye size={12} />
                预览学案
              </button>
            </div>
          </div>
        </div>

        {/* 面板主体 */}
        <div className="flex-1 min-h-0 relative">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中…
              </div>
            }
          >
            {subTab === 'activities' && (
              <div role="tabpanel" aria-label="活动编排" className="absolute inset-0">
                <XueanActivitiesPanel />
              </div>
            )}
            {subTab === 'blocks' && (
              <div role="tabpanel" aria-label="学案首页" className="absolute inset-0">
                <XueanBlocksEditor />
              </div>
            )}
          </Suspense>
        </div>
      </div>

      {previewOpen && selectedLesson && (
        <TeacherPreviewModal
          lessonId={selectedLesson}
          lessonTitle={lessonTitle}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

function TabButton({
  role,
  selected,
  onClick,
  children,
}: {
  role: 'tab';
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role={role}
      type="button"
      aria-selected={selected}
      onClick={onClick}
      className={
        'px-3 py-1.5 text-xs font-bold rounded-md transition relative ' +
        (selected ? 'bg-surface text-main shadow-sm' : 'text-muted hover:text-main hover:bg-surface/50')
      }
    >
      {children}
    </button>
  );
}

function TeacherPreviewModal({
  lessonId,
  lessonTitle,
  onClose,
}: {
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-[85vh] bg-surface rounded-2xl border border-theme shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-theme bg-surface/90">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-primary-theme">学生视角预览</span>
            <span className="text-xs text-muted">· {lessonTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded hover:bg-surface-secondary text-muted hover:text-main"
            aria-label="关闭预览"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-muted text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载学案…
              </div>
            }
          >
            <StudentXueanView lessonId={lessonId} lessonTitle={lessonTitle} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
