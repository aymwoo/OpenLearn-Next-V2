import type { ComponentType } from 'react';
import { Puzzle } from 'lucide-react';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { useAppStore } from '../store/appStore';
import { DOMExtensionWrapper, PluginErrorState } from '../plugin-host/extension-point-renderer';
import { NullExtensionComponent } from '../plugin-host/plugin-host';

function ActiveTabComponent({
  component,
  lessonId,
  classId,
}: {
  component: unknown;
  lessonId: string | null;
  classId: string | null;
}) {
  const Comp = component as ComponentType<{ renderType: string; lessonId: string | null; classId: string | null }>;
  return <Comp renderType="panel" lessonId={lessonId} classId={classId} />;
}

function PluginTabPanel({ activeNavPlugin }: { activeNavPlugin: string | null }) {
  const extensionPoints = usePluginHostStore((state) => state.extensionPoints);
  const pluginErrors = usePluginHostStore((state) => state.pluginErrors);
  const lang = useAppStore((state) => state.lang);
  const lessonId = useAppStore((state) => state.selectedLesson);
  const classId = useAppStore((state) => state.liveClassSelectedClassId);
  const tabs = extensionPoints.get('teacher.tab' as any) || [];

  // Auto-select first tab if none active
  const effectiveActive = activeNavPlugin || (tabs.length > 0 ? tabs[0].pluginId : null);

  // 同一插件可能注册多条同槽位条目：manifest 声明式贡献（`component` 是占位空组件，
  // 见 registerManifestContributions）与运行时 `ctx.ui.registerExtensionPoint`（真实组件 /
  // render 函数）。manifest 先注册，直接 find 会拿到占位项 —— 面板白屏。
  // 优先级：真实组件 > render 渲染函数 > 占位项（至少保留 label 与错误态语义）。
  const pluginTabs = tabs.filter((t) => t.pluginId === effectiveActive);
  const activeTab =
    pluginTabs.find((t) => t.component && t.component !== NullExtensionComponent) ??
    pluginTabs.find((t) => typeof t.render === 'function') ??
    pluginTabs[0];
  // v0.7.0：插件前端失败时给出显式错误态（错误 + 重试），而不是渲染空白面板
  const pluginError = activeTab ? pluginErrors.get(activeTab.pluginId) : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Active panel */}
      <div className="flex-1 overflow-auto">
        {pluginError ? (
          <PluginErrorState pluginId={activeTab!.pluginId} message={pluginError} lang={lang === 'en' ? 'en' : 'zh'} />
        ) : activeTab?.component && activeTab.component !== NullExtensionComponent ? (
          <ActiveTabComponent component={activeTab.component} lessonId={lessonId} classId={classId} />
        ) : activeTab && typeof activeTab.render === 'function' ? (
          <DOMExtensionWrapper
            ext={activeTab}
            slot="teacher.tab"
            slotProps={{ renderType: 'panel', lessonId, classId }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Puzzle size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-subtle font-medium">
                {lang === 'zh' ? '此插件未提供页面组件' : 'This plugin has no page component'}
              </p>
              <p className="text-xs text-muted mt-1">
                {lang === 'zh'
                  ? '插件已注册导航条目，但未提供对应的界面渲染逻辑。'
                  : 'The plugin registered a navigation entry but did not provide a render component.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { PluginTabPanel };
