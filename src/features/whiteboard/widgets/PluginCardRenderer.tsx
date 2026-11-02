import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { NullExtensionComponent } from '../../../plugin-host/plugin-host';
import { PluginSandboxIframeView } from '../../../components/PluginSandboxIframeView';

export function PluginCardRenderer({
  pluginId,
  slot,
  widgetId,
  elementId,
  lessonId,
  classId,
  studentId,
  studentName,
}: {
  pluginId?: string;
  slot: string;
  widgetId?: string;
  elementId: string;
  lessonId: string;
  classId?: string | null;
  studentId?: string | null;
  studentName?: string | null;
}) {
  const extensionPoints = usePluginHostStore((state) => state.extensionPoints);
  const extensions = extensionPoints.get(slot as any) || [];

  // Find the specific extension by widgetId only.
  // NOTE: pluginId in whiteboard data is the manifest ID (e.g. "ext-homework-hub"),
  // but registerExtensionPoint stores the DB UUID. We match by widgetId (globally unique per slot)
  // and fall back to pluginId match only if ambiguous.
  const ext =
    extensions.find((e) => e.id === widgetId) ?? extensions.find((e) => e.pluginId === pluginId && e.id === widgetId);

  // NullExtensionComponent 是 manifest 数据型贡献的占位组件（() => null），
  // 不代表可渲染的 React UI。与 ExtensionPointRenderer 保持同一判定，
  // 否则 manifest 声明的 view（沙箱页面）永远走不到下面的分支。
  const hasReactComponent = !!ext && typeof ext.component === 'function' && ext.component !== NullExtensionComponent;

  // Create container ref and use useEffect to call render
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ext) return;
    if (containerRef.current && !hasReactComponent) {
      containerRef.current.innerHTML = '';
      if ((ext as any).render) {
        // If it is a DOM render function, pass elementId and lessonId context
        Promise.resolve((ext as any).render(containerRef.current, { elementId, lessonId })).catch(console.error);
      }
    }
  }, [ext, hasReactComponent, pluginId, widgetId, elementId, lessonId]);

  // 缺 id 是配置错误，不是「加载慢」：必须给出可见错误态，否则用户只能看到永久转圈（Issue #370）。
  // 放在 hooks 之后，避免条件返回破坏 hooks 顺序。
  if (!widgetId) {
    return (
      <div
        data-testid="plugin-widget-misconfigured"
        className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center text-xs text-amber-600"
      >
        <AlertTriangle size={16} />
        <p className="font-bold">挂件未正确配置</p>
        <p className="text-amber-700/80">
          缺少 {slot === 'teacher.dashboard.widget' ? 'teacherWidgetId' : 'studentWidgetId'}
          ，请检查插件写入的 payload。
        </p>
        {pluginId && <p className="font-mono text-[10px] text-gray-400">plugin: {pluginId}</p>}
      </div>
    );
  }

  if (!ext) {
    return (
      <div className="text-center py-6 text-xs text-gray-400 italic flex flex-col justify-center items-center h-full">
        <Loader2 size={16} className="animate-spin mb-1" />
        <span>组件 [{widgetId}] 正在加载或未启用...</span>
      </div>
    );
  }

  if (hasReactComponent) {
    return React.createElement(ext.component as any, { elementId, lessonId });
  }

  const viewPath = (ext as any).slotProps?.view || ext.view;
  if (viewPath) {
    return (
      <PluginSandboxIframeView
        pluginId={ext.pluginId}
        view={String(viewPath)}
        label={ext.label}
        slot={slot}
        lessonId={lessonId}
        classId={classId}
        studentId={studentId}
        studentName={studentName}
        variant="panel"
      />
    );
  }

  return <div ref={containerRef} className="w-full h-full min-h-0" />;
}
