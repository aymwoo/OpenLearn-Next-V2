import React from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  CLASSROOM_TOOLBAR_FEATURES,
  CLASSROOM_TOOLBAR_GROUPS,
  useClassroomToolbarVisibility,
} from './classroomToolbarVisibility';

/**
 * 白板课「控制」tab：用开关决定顶栏「课堂工具」与「更多」里哪些按钮显示。
 * 开关即时生效并持久化，关闭的按钮不会再被渲染。
 */
export function ClassroomToolbarControlPage({ lang = 'zh' }: { lang?: 'zh' | 'en' }) {
  const { isEnabled, setFeatureEnabled, resetAll } = useClassroomToolbarVisibility();

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

      <div className="flex flex-col gap-4 pt-3">
        {CLASSROOM_TOOLBAR_GROUPS.map((group) => {
          const features = CLASSROOM_TOOLBAR_FEATURES.filter((feature) => feature.group === group.id);
          if (features.length === 0) return null;
          return (
            <section key={group.id} className="flex flex-col gap-1.5">
              <h4 className="text-xs font-extrabold tracking-wide uppercase text-muted">
                {lang === 'zh' ? group.zh : group.en}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {features.map((feature) => {
                  const label = lang === 'zh' ? feature.zh : feature.en;
                  const enabled = isEnabled(feature.id);
                  return (
                    <label
                      key={feature.id}
                      data-testid={`classroom-toolbar-feature-${feature.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-theme bg-surface-secondary/40 cursor-pointer"
                    >
                      <span className="text-xs font-medium text-main truncate">{label}</span>
                      <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
                        {/* 原生 checkbox + role="switch"：键盘、焦点与读屏语义都由浏览器保证，
                            不依赖仅 Safari 支持的 switch 属性。 */}
                        <input
                          type="checkbox"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={label}
                          checked={enabled}
                          onChange={(event) => setFeatureEnabled(feature.id, event.target.checked)}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className="h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-primary-solid peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-theme dark:bg-slate-600"
                        />
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-4' : ''
                          }`}
                        />
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
