import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ClassroomToolbarFeatureSettings } from './ClassroomToolbarFeatureSettings';
import { useClassroomToolbarVisibility } from './classroomToolbarVisibility';

/**
 * 白板课「控制」tab：用开关决定顶栏「课堂工具」与「更多」里哪些按钮显示。
 * 开关即时生效并持久化，关闭的按钮不会再被渲染。
 */
export function ClassroomToolbarControlPage({ lang = 'zh' }: { lang?: 'zh' | 'en' }) {
  const { resetAll } = useClassroomToolbarVisibility();

  return (
    <div
      data-testid="classroom-toolbar-control-page"
      className="flex-grow flex-1 min-h-0 w-full relative rounded-xl overflow-y-auto border border-theme shadow-md bg-surface flex flex-col p-4"
    >
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-theme shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-main flex items-center gap-1.5">
            <SlidersHorizontal size={15} className="text-primary-theme" />
            {lang === 'zh' ? '课堂工具控制' : 'Classroom Tools Control'}
          </h3>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            {lang === 'zh'
              ? '关闭后，对应按钮会从顶栏「课堂工具」和课堂面板中隐藏；设置立即生效，并在此浏览器记住。'
              : 'Disabled buttons disappear from the classroom tools panel. Changes apply instantly and are remembered in this browser.'}
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-main cursor-pointer shrink-0"
        >
          <RotateCcw size={12} />
          <span>{lang === 'zh' ? '全部恢复显示' : 'Show all'}</span>
        </button>
      </div>

      <div className="pt-3">
        <ClassroomToolbarFeatureSettings lang={lang} />
      </div>
    </div>
  );
}
