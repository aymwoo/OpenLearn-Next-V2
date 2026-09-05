import React, { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';

export function PluginCardRenderer({ pluginId, slot, widgetId, elementId, lessonId }: { 
  pluginId: string; 
  slot: string; 
  widgetId: string; 
  elementId: string;
  lessonId: string;
}) {
  const extensionPoints = usePluginHostStore(state => state.extensionPoints);
  const extensions = extensionPoints.get(slot as any) || [];
  
  // Find the specific extension by widgetId only.
  // NOTE: pluginId in whiteboard data is the manifest ID (e.g. "ext-homework-hub"),
  // but registerExtensionPoint stores the DB UUID. We match by widgetId (globally unique per slot)
  // and fall back to pluginId match only if ambiguous.
  const ext = extensions.find(e => e.id === widgetId) 
    ?? extensions.find(e => e.pluginId === pluginId && e.id === widgetId);
  
  // Create container ref and use useEffect to call render
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!ext) return;
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      if (!ext.component && (ext as any).render) {
        // If it is a DOM render function, pass elementId and lessonId context
        Promise.resolve((ext as any).render(containerRef.current, { elementId, lessonId })).catch(console.error);
      }
    }
  }, [ext, pluginId, widgetId, elementId, lessonId]);

  if (!ext) {
    return (
      <div className="text-center py-6 text-xs text-gray-400 italic flex flex-col justify-center items-center h-full">
        <Loader2 size={16} className="animate-spin mb-1" />
        <span>组件 [{widgetId}] 正在加载或未启用...</span>
      </div>
    );
  }

  if (ext.component) {
    return React.createElement(
      ext.component,
      { elementId, lessonId }
    );
  }

  return <div ref={containerRef} className="w-full h-full min-h-0" />;
}
