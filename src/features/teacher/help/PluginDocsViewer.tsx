import React from 'react';
import { FileText } from 'lucide-react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';

export const PluginDocsViewer: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">已安装插件的使用文档</h3>
              <p className="text-xs text-gray-500 mt-0.5">插件开发者可在 manifest.contributes 中声明 help.plugin_docs 贡献项，或通过扩展点注册文档组件。</p>
            </div>
          </div>
          <ExtensionPointRenderer slot="help.plugin_docs" />
        </div>
      </div>
    </div>
  );
};
