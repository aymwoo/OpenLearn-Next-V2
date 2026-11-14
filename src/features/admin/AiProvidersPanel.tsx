import React, { useRef, useState } from 'react';
import {
  Blocks,
  Check,
  Globe,
  Loader2,
  Plus,
  Puzzle,
  Settings2,
  X,
  ShieldCheck,
  User,
  AlertCircle,
} from 'lucide-react';
import { PasswordInput } from '../../components/PasswordInput';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';
import { AiPersonasSection } from './AiPersonasSection';
import { formatAiProviderUrlError, validateAiProviderUrl } from '../../../packages/core/ai/utils/redirect-guard.js';

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
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  const clearValidationErrors = () => {
    setNameError(null);
    setUrlError(null);
    setModelError(null);
    setFormError(null);
  };

  const handleAddProvider = () => {
    setEditingAIProvider(null);
    setProviderName('');
    setProviderApiUrl('');
    setProviderApiKey('');
    setProviderModelName('');
    setProviderIsShared(false);
    clearValidationErrors();
    setIsAIProviderModalOpen(true);
  };

  const handleEditProvider = (provider: AIProvider) => {
    setEditingAIProvider(provider);
    setProviderName(provider.name);
    setProviderApiUrl(provider.api_url);
    setProviderApiKey(provider.api_key || '');
    setProviderModelName(provider.model_name);
    setProviderIsShared(Boolean(provider.is_shared));
    clearValidationErrors();
    setIsAIProviderModalOpen(true);
  };

  const validateUrlField = (value: string): string | null => {
    const result = validateAiProviderUrl(value);
    if (result.valid) return null;
    return formatAiProviderUrlError(result, lang);
  };

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const nextNameErr = !providerName.trim()
      ? lang === 'zh'
        ? '服务商名称不可为空。'
        : 'Provider name is required.'
      : null;
    const nextUrlErr = validateUrlField(providerApiUrl);
    const nextModelErr = !providerModelName.trim()
      ? lang === 'zh'
        ? '模型代号不可为空。'
        : 'Model identifier is required.'
      : null;

    setNameError(nextNameErr);
    setUrlError(nextUrlErr);
    setModelError(nextModelErr);

    if (nextNameErr) {
      nameInputRef.current?.focus();
      return;
    }
    if (nextUrlErr) {
      urlInputRef.current?.focus();
      return;
    }
    if (nextModelErr) {
      modelInputRef.current?.focus();
      return;
    }

    try {
      setProviderSaving(true);
      const isEditing = !!editingAIProvider;
      const url = isEditing ? `/api/ai-providers/${editingAIProvider!.id}` : '/api/ai-providers';
      const method = isEditing ? 'PUT' : 'POST';
      const bodyPayload: Record<string, unknown> = {
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
        clearValidationErrors();
        onAIProvidersChanged();
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData.error || (lang === 'zh' ? '保存失败，请检查配置参数。' : 'Failed to save provider.');
        setFormError(msg);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setFormError(message || 'Error');
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(message || 'Error');
    }
  };

  const handleTestProvider = async (provider: AIProvider) => {
    if (testingProviderId) return;
    setTestingProviderId(provider.id);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      alert(lang === 'zh' ? `网络异常: ${message}` : `Network error: ${message}`);
    } finally {
      setTestingProviderId(null);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-fade-in text-gray-800">
        {currentUserRole === 'administrator' && (
          <div className="bg-indigo-50/70 border border-indigo-200/70 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-extrabold text-gray-900 text-base sm:text-lg tracking-tight">
                {lang === 'zh' ? 'AI 配置' : 'AI Configuration'}
              </h2>
              <p className="text-xs text-gray-600 mt-0.5">
                {lang === 'zh'
                  ? '统一管理 AI 模型服务与内核 AI 助教角色；个人私有提供商仍仅限所属账号可见与使用。'
                  : 'Unified management for OpenAI-compatible AI model providers and kernel AI assistant personas. Private providers remain strictly user-scoped.'}
              </p>
            </div>
          </div>
        )}
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
              <AccessibleTableRegion
                labelledBy="ai-providers-table-caption"
                className="border border-gray-100 rounded-xl"
              >
                <table className="responsive-data-table w-full text-left border-collapse" data-stack-mobile="true">
                  <caption id="ai-providers-table-caption" className="sr-only">
                    {lang === 'zh' ? 'AI 提供商配置列表' : 'AI Providers List'}
                  </caption>
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-gray-100 text-gray-500 font-bold text-xs uppercase tracking-wider">
                      <th scope="col" className="py-3.5 px-4">
                        {lang === 'zh' ? '名称' : 'Name'}
                      </th>
                      <th scope="col" className="py-3.5 px-4">
                        {lang === 'zh' ? '类型 / 范围' : 'Scope'}
                      </th>
                      <th scope="col" className="py-3.5 px-4">
                        {lang === 'zh' ? 'API 端点 URL' : 'API Endpoint URL'}
                      </th>
                      <th scope="col" className="py-3.5 px-4">
                        {lang === 'zh' ? '模型代号' : 'Model Identifier'}
                      </th>
                      <th scope="col" className="py-3.5 px-4">
                        {lang === 'zh' ? '密钥状态' : 'API Key'}
                      </th>
                      <th scope="col" className="py-3.5 px-4 text-center">
                        {lang === 'zh' ? '操作' : 'Actions'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                    {aiProviders.map((provider) => {
                      const isShared = Boolean(provider.is_shared);
                      const canManage = Boolean(
                        isShared
                          ? currentUserRole === 'administrator'
                          : !provider.owner_id || !currentUserId || provider.owner_id === currentUserId,
                      );

                      return (
                        <tr key={provider.id} className="hover:bg-slate-50/50 transition-colors">
                          <th scope="row" data-label={lang === 'zh' ? '名称' : 'Name'} className="py-4 px-4 text-left">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${isShared ? 'bg-purple-500' : 'bg-indigo-500'}`} />
                              <span className="font-extrabold text-gray-800 text-sm">{provider.name}</span>
                            </div>
                          </th>
                          <td
                            data-label={lang === 'zh' ? '类型 / 范围' : 'Scope'}
                            className="py-4 px-4 whitespace-nowrap"
                          >
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
                          <td
                            data-label={lang === 'zh' ? 'API 端点 URL' : 'API Endpoint URL'}
                            className="py-4 px-4 font-mono text-gray-550 truncate max-w-[220px]"
                          >
                            {provider.api_url}
                          </td>
                          <td data-label={lang === 'zh' ? '模型代号' : 'Model Identifier'} className="py-4 px-4">
                            <span className="bg-slate-100 text-slate-800 font-bold px-2 py-1 rounded font-mono text-xs border border-slate-200">
                              {provider.model_name}
                            </span>
                          </td>
                          <td data-label={lang === 'zh' ? '密钥状态' : 'API Key'} className="py-4 px-4">
                            {provider.api_key ? (
                              <span className="text-emerald-600 font-bold flex items-center gap-1 font-mono">
                                <Check size={12} /> Key Saved
                              </span>
                            ) : (
                              <span className="text-amber-500/90 font-mono italic">Not Set</span>
                            )}
                          </td>
                          <td data-label={lang === 'zh' ? '操作' : 'Actions'} className="py-4 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleTestProvider(provider)}
                                disabled={testingProviderId === provider.id}
                                className="px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                                title={lang === 'zh' ? '测试连通性' : 'Test Connection'}
                              >
                                {testingProviderId === provider.id ? (
                                  <Loader2 size={11} className="animate-spin" />
                                ) : (
                                  <Globe size={11} />
                                )}
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
              </AccessibleTableRegion>
            )}
          </div>
        </div>
        {currentUserRole === 'administrator' && <AiPersonasSection lang={lang} aiProviders={aiProviders} />}
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

            <form noValidate onSubmit={handleSaveProvider} className="p-5 space-y-4 text-left">
              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                >
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label
                  htmlFor="ai-provider-name"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 text-left"
                >
                  {lang === 'zh' ? '服务商名称 *' : 'Provider Name *'}
                </label>
                <input
                  ref={nameInputRef}
                  id="ai-provider-name"
                  name="provider_name"
                  type="text"
                  required
                  placeholder="e.g. Deepseek, Minimax"
                  value={providerName}
                  aria-invalid={nameError ? 'true' : 'false'}
                  aria-describedby={nameError ? 'ai-provider-name-error' : undefined}
                  onChange={(e) => {
                    setProviderName(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  className={`w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:border-transparent transition-all font-semibold ${
                    nameError
                      ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/40'
                      : 'border-gray-200 focus:ring-indigo-500'
                  }`}
                />
                {nameError && (
                  <p id="ai-provider-name-error" className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle size={12} className="shrink-0" />
                    <span>{nameError}</span>
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="ai-provider-url"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 text-left"
                >
                  {lang === 'zh' ? 'API 端点 URL *' : 'API Endpoint URL *'}
                </label>
                <span id="ai-provider-url-hint" className="text-xs text-gray-500 mb-1.5 block">
                  {lang === 'zh'
                    ? '支持公网域名、内网/本地 IP（如 http://192.168.1.10:11434/v1）、自定义端口与基础路径。'
                    : 'Supports domains, LAN/local IPs (e.g. http://192.168.1.10:11434/v1), custom ports, and base paths.'}
                </span>
                <input
                  ref={urlInputRef}
                  id="ai-provider-url"
                  name="provider_api_url"
                  type="url"
                  required
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="https://api.deepseek.com/v1"
                  value={providerApiUrl}
                  aria-invalid={urlError ? 'true' : 'false'}
                  aria-describedby={urlError ? 'ai-provider-url-hint ai-provider-url-error' : 'ai-provider-url-hint'}
                  onChange={(e) => {
                    setProviderApiUrl(e.target.value);
                    if (urlError) setUrlError(null);
                  }}
                  onBlur={() => {
                    if (providerApiUrl.trim()) {
                      setUrlError(validateUrlField(providerApiUrl));
                    }
                  }}
                  className={`w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:border-transparent transition-all font-mono ${
                    urlError
                      ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/40'
                      : 'border-gray-200 focus:ring-indigo-500'
                  }`}
                />
                {urlError && (
                  <p id="ai-provider-url-error" className="mt-1 text-xs text-rose-600 flex items-start gap-1">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" />
                    <span>{urlError}</span>
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="ai-provider-model"
                  className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 text-left"
                >
                  {lang === 'zh' ? '模型代号 *' : 'Model Identifier *'}
                </label>
                <input
                  ref={modelInputRef}
                  id="ai-provider-model"
                  name="provider_model_name"
                  type="text"
                  required
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="e.g. deepseek-chat"
                  value={providerModelName}
                  aria-invalid={modelError ? 'true' : 'false'}
                  aria-describedby={modelError ? 'ai-provider-model-error' : undefined}
                  onChange={(e) => {
                    setProviderModelName(e.target.value);
                    if (modelError) setModelError(null);
                  }}
                  className={`w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:border-transparent transition-all font-mono ${
                    modelError
                      ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/40'
                      : 'border-gray-200 focus:ring-indigo-500'
                  }`}
                />
                {modelError && (
                  <p id="ai-provider-model-error" className="mt-1 text-xs text-rose-600 flex items-center gap-1">
                    <AlertCircle size={12} className="shrink-0" />
                    <span>{modelError}</span>
                  </p>
                )}
              </div>
              <PasswordInput
                id="ai-provider-key"
                name="provider_api_key"
                label={lang === 'zh' ? 'API Key (可选)' : 'API Key (Optional)'}
                labelClassName="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5 text-left"
                placeholder={lang === 'zh' ? '不修改请留空' : 'Leave empty to keep existing'}
                value={providerApiKey}
                onChange={setProviderApiKey}
                autoComplete="off"
                lang={lang}
                className="w-full text-xs sm:text-sm bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 rounded-lg px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono"
              />

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
