import React from 'react';
import {
  CLASSROOM_TOOLBAR_FEATURES,
  CLASSROOM_TOOLBAR_GROUPS,
  useClassroomToolbarVisibility,
} from './classroomToolbarVisibility';

/**
 * 课堂工具开关列表（控制页与开课前设置弹窗共用）。
 */
export function ClassroomToolbarFeatureSettings({ lang = 'zh' }: { lang?: 'zh' | 'en' }) {
  const { isEnabled, setFeatureEnabled } = useClassroomToolbarVisibility();

  return (
    <div className="flex flex-col gap-4">
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
  );
}
