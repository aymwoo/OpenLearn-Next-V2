import React, { useState } from 'react';
import { Blocks, Check, Globe, Loader2, Plus, Puzzle, Settings2, X, ShieldCheck, User } from 'lucide-react';

export interface AIProvider {
  id: string;
  name: string;
  api_url: string;
  api_key?: string;
  model_name: string;
  owner_id?: string | null;
  is_shared?: boolean | number;
  created_at?: number;
  updated_at?: number;
}

interface AiProvidersPanelProps {
  lang: 'zh' | 'en';
  aiProviders: AIProvider[];
  onAIProvidersChanged: () => void;
  currentUserId?: string;
  currentUserRole?: string;
}

export function AiProvidersPanel({
  lang,
  aiProviders,
  onAIProvidersChanged,
  currentUserId,
  currentUserRole,
}: AiProvidersPanelProps) {
  const [isAIProviderModalOpen, setIsAIProviderModalOpen] = useState(false);
  const [editingAIProvider, setEditingAIProvider] = useState<AIProvider | null>(null);
  const [providerName, setProviderName] = useState('');
  const [providerApiUrl, setProviderApiUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModelName, setProviderModelName] = useState('');
  const [providerIsShared, setProviderIsShared] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);

  const handleAddProvider = () => {
    setEditingAIProvider(null);
    setProviderName('');
    setProviderApiUrl('');
    setProviderApiKey('');
    setProviderModelName('');
    setProviderIsShared(false);
    setIsAIProviderModalOpen(true);
  };

  const handleEditProvider = (provider: AIProvider) => {
    setEditingAIProvider(provider);
    setProviderName(provider.name);
    setProviderApiUrl(provider.api_url);
    setProviderApiKey(provider.api_key || '');
    setProviderModelName(provider.model_name);
    setProviderIsShared(Boolean(provider.is_shared));
    setIsAIProviderModalOpen(true);
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerName.trim() || !providerApiUrl.trim() || !providerModelName.trim()) {
      alert(lang === 'zh' ? '名称、API URL 和模型名称不可为空' : 'Name, API URL and Model Name are required.');
      return;
    }
    try {
      setProviderSaving(true);
      const isEditing = !!editingAIProvider;
      const url = isEditing ? `/api/ai-providers/${editingAIProvider!.id}` : '/api/ai-providers';
      const method = isEditing ? 'PUT' : 'POST';
      const bodyPayload: any = {
        name: providerName.trim(),
        api_url: providerApiUrl.trim(),
        api_key: providerApiKey,
        model_name: providerModelName.trim(),
      };
      if (currentUserRole === 'administrator') {
        bodyPayload.is_shared = providerIsShared ? 1 : 0;
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      if (res.ok) {
        setIsAIProviderModalOpen(false);
        setEditingAIProvider(null);
        onAIProvidersChanged();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Server error');
      }
    } catch (err: any) {
      alert(err.message || 'Error');
    } finally {
      setProviderSaving(false);
    }
  };

  const handleDeleteProvider = async (id: string, name: string) => {
    if (!confirm(lang === 'zh' ? `确认要删除 AI 提供商 [${name}] 吗？` : `Confirm deleting AI Provider [${name}]?`))
      return;
    try {
      const res = await fetch(`/api/ai-providers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        onAIProvidersChanged();
      } else {
        alert('Delete failed');
      }
    } catch (err: any) {
      alert(err.message || 'Error');
    }
  };

  const handleTestProvider = async (provider: AIProvider) => {
    try {
      const res = await fetch('/api/ai-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: provider.id,
          api_url: provider.api_url,
          api_key: provider.api_key,
          model_name: provider.model_name,
        }),
      });
      if (res.ok) {
        alert(lang === 'zh' ? `[${provider.name}] 连接测试成功！` : `[${provider.name}] Connection test successful!`);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(
          lang === 'zh'
            ? `测试失败: ${errData.error || '未知错误'}`
            : `Test failed: ${errData.error || 'Unknown error'}`,
        );
      }
    } catch (err: any) {
      alert(lang === 'zh' ? `网络异常: ${err.message}` : `Network error: ${err.message}`);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-fade-in text-gray-800">
        {/* AI Provider List Card */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-3xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
            <div>
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-sm sm:text-base">
                <Blocks className="text-indigo-600" size={18} />
                {lang === 'zh' ? 'OpenAI 兼容 / 自定义模型 AI 提供商列表' : 'AI Providers List (OpenAI-Compatible)'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {lang === 'zh'
                  ? '支持 OpenAI 兼容 API。私有模型仅您个人可用，平台共享模型供全校教师共用。'
                  : 'OpenAI-compatible APIs. Private models are exclusive to your account; shared models are available to all teachers.'}
              </p>
            </div>
            <button
              onClick={handleAddProvider}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-sm transition-all text-xs cursor-pointer"
            >
              <Plus size={14} />
              {lang === 'zh' ? '添加 AI 提供商' : 'Add AI Provider'}
            </button>
          </div>

          <div className="p-4 sm:p-5">
            {aiProviders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 text-center">
                <Puzzle size={40} className="mb-3 opacity-30 text-indigo-500" />
                <span className="font-semibold text-sm">
                  {lang === 'zh' ? '暂未配置任何 AI 提供商' : 'No AI Providers Registered'}
                </span>
                <p className="text-xs text-gray-400 mt-1 max-w-xs">
                  {lang === 'zh' ? '点击右上角按钮新建。' : 'Click the button above to add one.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                      <th className="py-3.5 px-4">{lang === 'zh' ? '名称' : 'Name'}</th>
                      <th className="py-3.5 px-4">{lang === 'zh' ? '类型 / 范围' : 'Scope'}</th>
                      <th className="py-3.5 px-4">{lang === 'zh' ? 'API 端点 URL' : 'API Endpoint URL'}</th>
                      <th className="py-3.5 px-4">{lang === 'zh' ? '模型代号' : 'Model Identifier'}</th>
                      <th className="py-3.5 px-4">{lang === 'zh' ? '密钥状态' : 'API Key'}</th>
                      <th className="py-3.5 px-4 text-center">{lang === 'zh' ? '操作' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                    {aiProviders.map((provider) => {
                      const isShared = Boolean(provider.is_shared);
                      const canManage = Boolean(
                        isShared
                          ? currentUserRole === 'administrator'
                          : (!provider.owner_id || !currentUserId || provider.owner_id === currentUserId)
                      );

                      return (
                        <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${isShared ? 'bg-purple-500' : 'bg-indigo-500'}`} />
                              <span className="font-extrabold text-gray-800 text-sm">{provider.name}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4 whitespace-nowrap">
                            {isShared ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                <ShieldCheck size={12} />
                                {lang === 'zh' ? '平台共享' : 'Platform Shared'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <User size={12} />
                                {lang === 'zh' ? '个人私有' : 'Private'}
                              </span>
                            )}
                          </td>
                          <td className="py-4 px-4 font-mono text-gray-550 truncate max-w-[220px]">{provider.api_url}</td>
                          <td className="py-4 px-4">
                            <span className="bg-slate-100 text-slate-800 font-bold px-2 py-1 rounded font-mono text-xs border border-slate-200">
                              {provider.model_name}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            {provider.api_key ? (
                              <span className="text-emerald-600 font-bold flex items-center gap-1 font-mono">
                                <Check size={12} /> Key Saved
                              </span>
                            ) : (
                              <span className="text-amber-500/90 font-mono italic">Not Set</span>
                            )}
                          </td>
                          <td className="py-4 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleTestProvider(provider)}
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                title={lang === 'zh' ? '测试连通性' : 'Test Connection'}
                              >
                                <Globe size={11} />
                                <span>{lang === 'zh' ? '测试' : 'Test'}</span>
                              </button>
                              <button
                                onClick={() => handleEditProvider(provider)}
                                disabled={!canManage}
                                className={`px-2.5 py-1 rounded-lg border font-semibold transition-all shadow-3xs ${
                                  canManage
                                    ? 'text-indigo-700 hover:bg-indigo-100 border-indigo-200 bg-indigo-50 cursor-pointer'
                                    : 'text-gray-400 border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                                }`}
                                title={
                                  !canManage
                                    ? lang === 'zh'
                                      ? '平台共享配置仅管理员可修改'
                                      : 'Shared provider can only be modified by administrator'
                                    : lang === 'zh'
                                      ? '编辑配置'
                                      : 'Edit'
                                }
                              >
                                {lang === 'zh' ? '编辑' : 'Edit'}
                              </button>
                              <button
                                onClick={() => handleDeleteProvider(provider.id, provider.name)}
                                disabled={!canManage}
                                className={`px-2.5 py-1 rounded-lg border font-semibold transition-all shadow-3xs ${
                                  canManage
                                    ? 'text-rose-600 hover:bg-rose-100 border-rose-200 bg-rose-50 cursor-pointer'
                                    : 'text-gray-400 border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                                }`}
                                title={
                                  !canManage
                                    ? lang === 'zh'
                                      ? '平台共享配置仅管理员可修改'
                                      : 'Shared provider can only be modified by administrator'
                                    : lang === 'zh'
                                      ? '删除'
                                      : 'Delete'
                                }
                              >
                                {lang === 'zh' ? '删除' : 'Delete'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {isAIProviderModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[60] overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200/60 w-full max-w-md overflow-hidden text-gray-800 text-left">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-slate-50/70">
              <h3 className="font-extrabold text-sm sm:text-base text-gray-800 flex items-center gap-2">
                <Settings2 className="text-indigo-600" size={18} />
                {editingAIProvider
                  ? lang === 'zh'
                    ? '编辑 AI 提供商配置'
                    : 'Edit AI Provider'
                  : lang === 'zh'
                    ? '添加全新 AI 提供商'
                    : 'Add New AI Provider'}
              </h3>
              <button
                onClick={() => {
                  setIsAIProviderModalOpen(false);
                  setEditingAIProvider(null);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveProvider} className="p-5 space-y-4 text-left">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? '服务商名称 *' : 'Provider Name *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Deepseek, Minimax"
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-semibold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? 'API 端点 URL *' : 'API Endpoint URL *'}
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://api.deepseek.com/v1"
                  value={providerApiUrl}
                  onChange={(e) => setProviderApiUrl(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
                <span className="text-xs text-gray-400 mt-1 block">
                  {lang === 'zh'
                    ? '符合 OpenAI 规范的标准 API 统一基准 URL。'
                    : 'OpenAI-compatible base URL (e.g. /v1).'}
                </span>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? '模型代号 *' : 'Model Identifier *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. deepseek-chat"
                  value={providerModelName}
                  onChange={(e) => setProviderModelName(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left">
                  {lang === 'zh' ? 'API Key (可选)' : 'API Key (Optional)'}
                </label>
                <input
                  type="password"
                  placeholder={lang === 'zh' ? '不修改请留空' : 'Leave empty to keep existing'}
                  value={providerApiKey}
                  onChange={(e) => setProviderApiKey(e.target.value)}
                  className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
                />
              </div>

              {currentUserRole === 'administrator' && (
                <div className="pt-2 border-t border-gray-100">
                  <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={providerIsShared}
                      onChange={(e) => setProviderIsShared(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 cursor-pointer"
                    />
                    <div>
                      <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                        <ShieldCheck size={14} className="text-purple-600" />
                        {lang === 'zh' ? '设为平台共享模型 (全校教师可用)' : 'Set as Platform Shared (All teachers)'}
                      </span>
                      <span className="text-xs text-gray-400 mt-0.5 block leading-relaxed">
                        {lang === 'zh'
                          ? '勾选后，所有教师可直接在侧栏与课表中使用该模型，但无法查看或篡改您的 API Key。不勾选则仅为您个人私有。'
                          : 'If enabled, all teachers can use this model without seeing your API key. Otherwise it remains private.'}
                      </span>
                    </div>
                  </label>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAIProviderModalOpen(false);
                    setEditingAIProvider(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-gray-500 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={providerSaving}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {providerSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                  <span>
                    {providerSaving
                      ? lang === 'zh'
                        ? '保存中...'
                        : 'Saving...'
                      : lang === 'zh'
                        ? '保存至数据库'
                        : 'Save Connection'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
