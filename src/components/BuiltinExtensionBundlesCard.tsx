import React, { useState } from 'react';
import { Package, ToggleLeft, ToggleRight } from 'lucide-react';
import { usePluginHostStore } from '../plugin-host/plugin-host-store';
import { BUILTIN_BUNDLE_IDS } from '../plugin-host/builtin-bundles';
import { registerSmartEduExtensions } from '../features/smart-edu/smart-edu-plugin';

/**
 * 内置扩展包管理卡（Plugin Center「商店」页顶部）。
 *
 * 内置扩展包不经过安装链路、没有 DB 插件行，此前在管理台不可见也不可停用
 * （v0.6.0 审计：smart-edu 开机直注册、绕过插件生命周期）。本卡片以
 * localStorage 持久的开关给它与已安装插件同等的启停能力：
 * 停用即注销其全部扩展点（重渲染消失），启用即重新注册。
 *
 * 包清单单一事实源：src/plugin-host/builtin-bundles.ts（熔断降级同样
 * 写该停用表，卡片如实反映「已停用」—— v0.6.1 审计 R-6）。
 */

const BUILTIN_BUNDLE_INFO: Record<string, { name: string; description: string }> = {
  'ext-national-smart-edu': {
    name: '国家智慧教育公共服务平台连接器',
    description: '精品课导入 / 课程认证徽标 / 学情上报 / 网关状态胶囊等 9 个扩展槽位',
  },
};

export function BuiltinExtensionBundlesCard({ lang = 'zh' }: { lang?: string }) {
  const disabledBundles = usePluginHostStore((s) => s.builtinBundlesDisabled);
  const isBuiltinBundleEnabled = usePluginHostStore((s) => s.isBuiltinBundleEnabled);
  const setBuiltinBundleEnabled = usePluginHostStore((s) => s.setBuiltinBundleEnabled);
  const unregisterPluginExtensionPoints = usePluginHostStore((s) => s.unregisterPluginExtensionPoints);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const zh = lang === 'zh';

  const bundles = BUILTIN_BUNDLE_IDS.filter((id) => BUILTIN_BUNDLE_INFO[id]);
  if (bundles.length === 0) return null;

  const handleToggle = async (bundleId: string) => {
    setTogglingId(bundleId);
    try {
      const enable = !isBuiltinBundleEnabled(bundleId);
      setBuiltinBundleEnabled(bundleId, enable);
      if (enable) {
        // 重新注册（幂等：store 对同 slot 同 id 覆盖；内部会复位熔断）
        registerSmartEduExtensions();
      } else {
        unregisterPluginExtensionPoints(bundleId);
      }
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Package size={16} className="text-indigo-600" />
        <h3 className="text-sm font-bold text-gray-800">{zh ? '内置扩展包' : 'Builtin Extension Bundles'}</h3>
        <span className="text-[11px] text-gray-400">
          {zh ? '随宿主发布、无需安装的平台级扩展' : 'Platform-level extensions shipped with the host'}
        </span>
      </div>

      <div className="space-y-2">
        {bundles.map((bundleId) => {
          const info = BUILTIN_BUNDLE_INFO[bundleId];
          const enabled = isBuiltinBundleEnabled(bundleId);
          return (
            <div
              key={bundleId}
              className="flex items-center justify-between gap-3 px-3 py-2.5 bg-gray-50/70 border border-gray-100 rounded-lg"
            >
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-800 flex items-center gap-2">
                  {info.name}
                  {!enabled && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 rounded">
                      {zh ? '已停用' : 'Disabled'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 truncate">{info.description}</div>
              </div>

              <button
                onClick={() => void handleToggle(bundleId)}
                disabled={togglingId === bundleId}
                className={`flex items-center gap-1 text-xs font-semibold shrink-0 transition-colors cursor-pointer ${
                  enabled ? 'text-emerald-600' : 'text-gray-400'
                }`}
                title={enabled ? (zh ? '点击停用' : 'Click to disable') : zh ? '点击启用' : 'Click to enable'}
              >
                {enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                <span>{enabled ? (zh ? '启用中' : 'On') : zh ? '已停用' : 'Off'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
