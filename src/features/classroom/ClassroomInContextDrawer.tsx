import React, { lazy, Suspense } from 'react';
import { X, Maximize2, Puzzle, Users, LayoutTemplate, HelpCircle, Loader2 } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useAppStore } from '../../store/appStore';

const PluginView = lazy(() => import('../teacher/PluginView').then((m) => ({ default: m.PluginView })));
const ClassesView = lazy(() => import('../teacher/classes/ClassesView').then((m) => ({ default: m.ClassesView })));
const ComputerLabView = lazy(() => import('../teacher/ComputerLabView').then((m) => ({ default: m.ComputerLabView })));
const HelpView = lazy(() => import('../teacher/HelpView').then((m) => ({ default: m.HelpView })));

export interface ClassroomInContextDrawerProps {
  className?: string;
}

export function ClassroomInContextDrawer({ className = '' }: ClassroomInContextDrawerProps) {
  const lang = useAppStore((s) => s.lang);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);

  const classroomDrawerTab = useUIStore((s) => s.classroomDrawerTab);
  const setClassroomDrawerTab = useUIStore((s) => s.setClassroomDrawerTab);

  if (!classroomDrawerTab) {
    return null;
  }

  const handleOpenFullScreen = () => {
    const targetTab = classroomDrawerTab;
    setClassroomDrawerTab(null);
    setTeacherTab(targetTab);
  };

  const tabs: Array<{
    id: 'plugins' | 'classes' | 'computer_labs' | 'help';
    labelZh: string;
    labelEn: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }> = [
    { id: 'plugins', labelZh: '插件设置', labelEn: 'Plugins', icon: Puzzle },
    { id: 'classes', labelZh: '班级与学生', labelEn: 'Classes', icon: Users },
    { id: 'computer_labs', labelZh: '机房排座', labelEn: 'Labs', icon: LayoutTemplate },
    { id: 'help', labelZh: '系统命令与帮助', labelEn: 'Help', icon: HelpCircle },
  ];

  return (
    <div
      id="classroom-in-context-drawer-overlay"
      data-testid="classroom-in-context-drawer-overlay"
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-2xs transition-all duration-300 animate-in fade-in"
      onClick={() => setClassroomDrawerTab(null)}
    >
      <div
        id="classroom-in-context-drawer"
        data-testid="classroom-in-context-drawer"
        className={`w-full max-w-2xl bg-surface border-l border-theme shadow-2xl flex flex-col h-full overflow-hidden text-main animate-in slide-in-from-right duration-200 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="bg-surface-secondary px-4 py-3 border-b border-theme flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = classroomDrawerTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setClassroomDrawerTab(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-primary-solid text-white shadow-xs ring-1 ring-primary-theme/30'
                      : 'text-muted hover:text-main hover:bg-surface'
                  }`}
                >
                  <Icon size={14} />
                  <span>{lang === 'zh' ? tab.labelZh : tab.labelEn}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleOpenFullScreen}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface border border-theme/60 transition-colors cursor-pointer"
              title={
                lang === 'zh' ? '全屏打开此模块（白板将在后台保活）' : 'Open Fullscreen (Live Class will keep alive)'
              }
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setClassroomDrawerTab(null)}
              className="p-1.5 rounded-lg text-muted hover:text-main hover:bg-surface border border-theme/60 transition-colors cursor-pointer"
              title={lang === 'zh' ? '关闭抽屉并继续上课' : 'Close Drawer'}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0 bg-surface/50">
          <Suspense
            fallback={
              <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] text-muted gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-primary-theme" />
                <span className="text-xs font-semibold">
                  {lang === 'zh' ? '正在加载设置...' : 'Loading Settings...'}
                </span>
              </div>
            }
          >
            {classroomDrawerTab === 'plugins' ? (
              <PluginView />
            ) : classroomDrawerTab === 'classes' ? (
              <ClassesView />
            ) : classroomDrawerTab === 'computer_labs' ? (
              <ComputerLabView />
            ) : classroomDrawerTab === 'help' ? (
              <HelpView />
            ) : null}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
