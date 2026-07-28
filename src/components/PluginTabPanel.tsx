import type { ComponentType } from 'react';
import { Puzzle } from 'lucide-react';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { useAppStore } from '../store/appStore';
import { DOMExtensionWrapper } from '../plugin-host/extension-point-renderer';

function ActiveTabComponent({ component }: { component: unknown }) {
  const Comp = component as ComponentType<{ renderType: string }>;
  return <Comp renderType="panel" />;
}

function PluginTabPanel({ activeNavPlugin }: { activeNavPlugin: string | null }) {
  const extensionPoints = usePluginHostStore(state => state.extensionPoints);
  const lang = useAppStore(state => state.lang);
  const tabs = extensionPoints.get('teacher.tab' as any) || [];

  // Auto-select first tab if none active
  const effectiveActive = activeNavPlugin || (tabs.length > 0 ? tabs[0].pluginId : null);

  const activeTab = tabs.find(t => t.pluginId === effectiveActive);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Active panel */}
      <div className="flex-1 overflow-auto">
        {activeTab?.component ? (
          <ActiveTabComponent component={activeTab.component} />
        ) : activeTab && typeof (activeTab as any).render === 'function' ? (
          <DOMExtensionWrapper ext={activeTab} slot="teacher.tab" slotProps={{ renderType: 'panel' }} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Puzzle size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-400 font-medium">
                {lang === 'zh' ? '此插件未提供页面组件' : 'This plugin has no page component'}
              </p>
              <p className="text-xs text-gray-300 mt-1">
                {lang === 'zh' ? '插件已注册导航条目，但未提供对应的界面渲染逻辑。' : 'The plugin registered a navigation entry but did not provide a render component.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { PluginTabPanel };
