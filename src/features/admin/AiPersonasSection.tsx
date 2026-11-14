import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import AccessibleDialog from '../../components/AccessibleDialog';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';

export type PersonaRole = 'administrator' | 'teacher' | 'student';

export interface AdminPersonaRecord {
  id: string;
  nameZh: string;
  nameEn: string;
  instructionZh: string;
  instructionEn: string;
  icon?: string;
  source: 'builtin' | 'plugin' | 'admin';
  registeredBy?: string;
  mode?: 'overlay' | 'replace';
  basePolicy?: 'inherit' | 'drop';
  visibility?: PersonaRole[];
  defaultForRole?: PersonaRole[];
  toolPolicy?: { allow?: string[]; deny?: string[] };
  maxTurns?: number;
}

interface AiPersonasSectionProps {
  lang: 'zh' | 'en';
}

const ALL_ROLES: PersonaRole[] = ['administrator', 'teacher', 'student'];

function parsePatternList(raw: string): string[] | undefined {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function roleLabel(role: PersonaRole, lang: 'zh' | 'en'): string {
  if (role === 'administrator') return lang === 'zh' ? '管理员' : 'Admin';
  if (role === 'teacher') return lang === 'zh' ? '教师' : 'Teacher';
  return lang === 'zh' ? '学生' : 'Student';
}

export function AiPersonasSection({ lang }: AiPersonasSectionProps) {
  const [personas, setPersonas] = useState<AdminPersonaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AdminPersonaRecord | null>(null);

  const [formId, setFormId] = useState('');
  const [formNameZh, setFormNameZh] = useState('');
  const [formNameEn, setFormNameEn] = useState('');
  const [formIcon, setFormIcon] = useState('🤖');
  const [formMode, setFormMode] = useState<'overlay' | 'replace'>('overlay');
  const [formBasePolicy, setFormBasePolicy] = useState<'inherit' | 'drop'>('inherit');
  const [formVisibility, setFormVisibility] = useState<PersonaRole[]>([]);
  const [formDefaultForRole, setFormDefaultForRole] = useState<PersonaRole[]>([]);
  const [formInstructionZh, setFormInstructionZh] = useState('');
  const [formInstructionEn, setFormInstructionEn] = useState('');
  const [formAllowTools, setFormAllowTools] = useState('');
  const [formDenyTools, setFormDenyTools] = useState('');
  const [formMaxTurns, setFormMaxTurns] = useState('5');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchPersonas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/agent/personas?scope=all');
      const data = await res.json();
      if (res.ok && data?.success && Array.isArray(data.personas)) {
        setPersonas(data.personas);
      }
    } catch {
      setErrorMessage(lang === 'zh' ? '加载 AI 角色模板失败' : 'Failed to load AI persona templates.');
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    void fetchPersonas();
  }, [fetchPersonas]);

  const openCreateModal = () => {
    setEditingPersona(null);
    setFormId('');
    setFormNameZh('');
    setFormNameEn('');
    setFormIcon('🎯');
    setFormMode('overlay');
    setFormBasePolicy('inherit');
    setFormVisibility([]);
    setFormDefaultForRole([]);
    setFormInstructionZh('');
    setFormInstructionEn('');
    setFormAllowTools('');
    setFormDenyTools('');
    setFormMaxTurns('5');
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (persona: AdminPersonaRecord) => {
    setEditingPersona(persona);
    setFormId(persona.id);
    setFormNameZh(persona.nameZh);
    setFormNameEn(persona.nameEn);
    setFormIcon(persona.icon || '🤖');
    setFormMode(persona.mode ?? 'overlay');
    setFormBasePolicy(persona.basePolicy ?? (persona.mode === 'replace' ? 'drop' : 'inherit'));
    setFormVisibility(Array.isArray(persona.visibility) ? persona.visibility : []);
    setFormDefaultForRole(Array.isArray(persona.defaultForRole) ? persona.defaultForRole : []);
    setFormInstructionZh(persona.instructionZh || '');
    setFormInstructionEn(persona.instructionEn || '');
    setFormAllowTools(Array.isArray(persona.toolPolicy?.allow) ? persona.toolPolicy!.allow.join(', ') : '');
    setFormDenyTools(Array.isArray(persona.toolPolicy?.deny) ? persona.toolPolicy!.deny.join(', ') : '');
    setFormMaxTurns(String(persona.maxTurns ?? 5));
    setFormError('');
    setIsModalOpen(true);
  };

  const toggleRoleIn = (role: PersonaRole, list: PersonaRole[], setter: (next: PersonaRole[]) => void) => {
    if (list.includes(role)) {
      setter(list.filter((r) => r !== role));
    } else {
      setter([...list, role]);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setErrorMessage('');

    const parsedMaxTurns = Number(formMaxTurns);
    if (!Number.isFinite(parsedMaxTurns) || parsedMaxTurns < 1 || parsedMaxTurns > 20) {
      setFormError(lang === 'zh' ? '最大推理轮次需在 1 到 20 之间。' : 'Max turns must be between 1 and 20.');
      return;
    }

    const allow = parsePatternList(formAllowTools);
    const deny = parsePatternList(formDenyTools);
    const toolPolicy = allow || deny ? { ...(allow ? { allow } : {}), ...(deny ? { deny } : {}) } : undefined;

    const payload = {
      id: formId.trim(),
      nameZh: formNameZh.trim(),
      nameEn: formNameEn.trim(),
      icon: formIcon.trim() || undefined,
      mode: formMode,
      basePolicy: formBasePolicy,
      visibility: formVisibility.length > 0 && formVisibility.length < ALL_ROLES.length ? formVisibility : undefined,
      defaultForRole: formDefaultForRole.length > 0 ? formDefaultForRole : undefined,
      instructionZh: formInstructionZh,
      instructionEn: formInstructionEn,
      toolPolicy,
      maxTurns: Math.trunc(parsedMaxTurns),
    };

    setSaving(true);
    try {
      const url = editingPersona
        ? `/api/agent/personas/${encodeURIComponent(editingPersona.id)}`
        : '/api/agent/personas';
      const method = editingPersona ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setFormError(data?.message || data?.error || (lang === 'zh' ? '保存失败' : 'Failed to save persona'));
        return;
      }

      setIsModalOpen(false);
      setEditingPersona(null);
      setStatusMessage(
        editingPersona
          ? lang === 'zh'
            ? `已更新角色模板「${payload.nameZh}」`
            : `Updated persona "${payload.nameEn}"`
          : lang === 'zh'
            ? `已创建角色模板「${payload.nameZh}」`
            : `Created persona "${payload.nameEn}"`,
      );
      await fetchPersonas();
      window.dispatchEvent(new CustomEvent('openlearn:personas-updated'));
    } catch {
      setFormError(lang === 'zh' ? '网络请求失败，请重试' : 'Network request failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (persona: AdminPersonaRecord) => {
    setErrorMessage('');
    try {
      const res = await fetch(`/api/agent/personas/${encodeURIComponent(persona.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        setErrorMessage(data?.message || data?.error || (lang === 'zh' ? '删除失败' : 'Delete failed'));
        return;
      }
      setStatusMessage(lang === 'zh' ? `已删除角色模板「${persona.nameZh}」` : `Deleted persona "${persona.nameEn}"`);
      await fetchPersonas();
      window.dispatchEvent(new CustomEvent('openlearn:personas-updated'));
    } catch {
      setErrorMessage(lang === 'zh' ? '删除请求失败' : 'Delete request failed');
    }
  };

  return (
    <section
      aria-labelledby="ai-personas-section-heading"
      className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden text-left"
    >
      <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70">
        <div>
          <h3 id="ai-personas-section-heading" className="font-bold text-gray-800 flex items-center gap-2 text-base">
            <Bot className="text-indigo-600" size={18} />
            {lang === 'zh' ? 'AI Agent 角色模板 (Persona)' : 'AI Agent Personas'}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {lang === 'zh'
              ? '管理内置与自定义 AI 助教角色（支持 overlay/replace 模式、角色可见性、默认角色与工具权限收敛）。'
              : 'Manage built-in and custom AI personas (overlay/replace mode, role visibility, defaults, and tool policies).'}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-indigo-700 transition-colors cursor-pointer shrink-0 shadow-xs"
        >
          <Plus size={14} />
          <span>{lang === 'zh' ? '新建角色模板' : 'New Persona'}</span>
        </button>
      </div>

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 mt-4 p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl font-medium"
        >
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mx-5 mt-4 p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium"
        >
          {errorMessage}
        </div>
      )}

      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500 gap-2">
            <Loader2 size={14} className="animate-spin" />
            <span>{lang === 'zh' ? '正在加载角色模板...' : 'Loading personas...'}</span>
          </div>
        ) : (
          <AccessibleTableRegion labelledBy="ai-personas-table-caption">
            <table className="w-full text-left text-xs border-collapse">
              <caption id="ai-personas-table-caption" className="sr-only">
                {lang === 'zh' ? 'AI Agent 角色模板配置列表' : 'AI Agent Persona Templates List'}
              </caption>
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 bg-gray-50/60">
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '角色 / ID' : 'Persona / ID'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '来源' : 'Source'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '模式 / 基础指令' : 'Mode / Base'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '可见角色' : 'Visibility'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '默认角色' : 'Default For'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '轮次上限' : 'Max Turns'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold text-right">
                    {lang === 'zh' ? '操作' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {personas.map((persona) => {
                  const displayName = lang === 'zh' ? persona.nameZh : persona.nameEn;
                  const modeText = persona.mode === 'replace' ? 'replace' : 'overlay';
                  const baseText = persona.basePolicy ?? (modeText === 'replace' ? 'drop' : 'inherit');
                  const visibilityText =
                    persona.visibility && persona.visibility.length > 0
                      ? persona.visibility.map((r) => roleLabel(r, lang)).join(', ')
                      : lang === 'zh'
                        ? '全角色'
                        : 'All roles';
                  const defaultText =
                    persona.defaultForRole && persona.defaultForRole.length > 0
                      ? persona.defaultForRole.map((r) => roleLabel(r, lang)).join(', ')
                      : '—';
                  const isPlugin = persona.source === 'plugin';
                  const isAdmin = persona.source === 'admin';

                  return (
                    <tr key={persona.id} className="hover:bg-slate-50/80 transition-colors">
                      <th scope="row" className="py-2.5 px-3 font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true">{persona.icon || '🤖'}</span>
                          <div>
                            <div className="font-semibold text-gray-800">{displayName}</div>
                            <div className="text-[11px] text-gray-400 font-mono">{persona.id}</div>
                          </div>
                        </div>
                      </th>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            persona.source === 'builtin'
                              ? 'bg-slate-100 text-slate-700'
                              : isAdmin
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'bg-purple-50 text-purple-700'
                          }`}
                        >
                          {persona.source}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-gray-600">
                        {modeText} / {baseText}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{visibilityText}</td>
                      <td className="py-2.5 px-3 text-gray-600">{defaultText}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-600">{persona.maxTurns ?? 5}</td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {!isPlugin ? (
                            <button
                              type="button"
                              onClick={() => openEditModal(persona)}
                              aria-label={
                                lang === 'zh'
                                  ? `编辑角色模板 ${displayName} (${persona.id})`
                                  : `Edit persona ${displayName} (${persona.id})`
                              }
                              className="px-2 py-1 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                            >
                              <Pencil size={12} />
                              <span>{lang === 'zh' ? '编辑' : 'Edit'}</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400">
                              {lang === 'zh' ? '插件托管' : 'Plugin managed'}
                            </span>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(persona)}
                              aria-label={
                                lang === 'zh'
                                  ? `删除角色模板 ${displayName} (${persona.id})`
                                  : `Delete persona ${displayName} (${persona.id})`
                              }
                              className="px-2 py-1 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                            >
                              <Trash2 size={12} />
                              <span>{lang === 'zh' ? '删除' : 'Delete'}</span>
                            </button>
                          )}
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

      <AccessibleDialog
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingPersona(null);
        }}
        ariaLabelledBy="ai-persona-modal-title"
        className="rounded-2xl shadow-xl border border-gray-200/60 w-full max-w-xl p-0 bg-white text-gray-800 backdrop:bg-gray-900/40"
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-slate-50/70">
          <h4
            id="ai-persona-modal-title"
            className="font-extrabold text-sm sm:text-base text-gray-800 flex items-center gap-2"
          >
            <Bot className="text-indigo-600" size={18} />
            {editingPersona
              ? lang === 'zh'
                ? '编辑 AI 角色模板'
                : 'Edit AI Persona'
              : lang === 'zh'
                ? '新建 AI 角色模板'
                : 'Create AI Persona'}
          </h4>
          <button
            type="button"
            onClick={() => {
              setIsModalOpen(false);
              setEditingPersona(null);
            }}
            aria-label={lang === 'zh' ? '关闭角色配置对话框' : 'Close persona dialog'}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4 text-left max-h-[75vh] overflow-y-auto">
          {formError && (
            <div role="alert" className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="persona-form-id" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '唯一 ID *' : 'Persona ID *'}
              </label>
              <input
                id="persona-form-id"
                name="id"
                type="text"
                required
                disabled={Boolean(editingPersona)}
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                placeholder="e.g. chemistry_lab_tutor"
                className="w-full text-xs bg-gray-50 disabled:bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="persona-form-icon" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '图标' : 'Icon'}
              </label>
              <input
                id="persona-form-icon"
                name="icon"
                type="text"
                value={formIcon}
                onChange={(e) => setFormIcon(e.target.value)}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="persona-form-name-zh" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '中文名称 *' : 'Chinese Name *'}
              </label>
              <input
                id="persona-form-name-zh"
                name="nameZh"
                type="text"
                required
                value={formNameZh}
                onChange={(e) => setFormNameZh(e.target.value)}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="persona-form-name-en" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '英文名称 *' : 'English Name *'}
              </label>
              <input
                id="persona-form-name-en"
                name="nameEn"
                type="text"
                required
                value={formNameEn}
                onChange={(e) => setFormNameEn(e.target.value)}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="persona-form-mode" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '提示词模式' : 'Mode'}
              </label>
              <select
                id="persona-form-mode"
                name="mode"
                value={formMode}
                onChange={(e) => {
                  const nextMode = e.target.value === 'replace' ? 'replace' : 'overlay';
                  setFormMode(nextMode);
                  setFormBasePolicy(nextMode === 'replace' ? 'drop' : 'inherit');
                }}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="overlay">overlay ({lang === 'zh' ? '叠加' : 'Overlay'})</option>
                <option value="replace">replace ({lang === 'zh' ? '替换' : 'Replace'})</option>
              </select>
            </div>
            <div>
              <label htmlFor="persona-form-base-policy" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '基础指令策略' : 'Base Policy'}
              </label>
              <select
                id="persona-form-base-policy"
                name="basePolicy"
                value={formBasePolicy}
                onChange={(e) => setFormBasePolicy(e.target.value === 'drop' ? 'drop' : 'inherit')}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="inherit">inherit ({lang === 'zh' ? '保留内置' : 'Inherit'})</option>
                <option value="drop">drop ({lang === 'zh' ? '丢弃内置' : 'Drop'})</option>
              </select>
            </div>
            <div>
              <label htmlFor="persona-form-max-turns" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '最大轮次 (1-20)' : 'Max Turns (1-20)'}
              </label>
              <input
                id="persona-form-max-turns"
                name="maxTurns"
                type="number"
                min={1}
                max={20}
                value={formMaxTurns}
                onChange={(e) => setFormMaxTurns(e.target.value)}
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <fieldset className="border border-gray-200 rounded-lg p-3">
              <legend className="text-xs font-bold text-gray-600 px-1">
                {lang === 'zh' ? '可见角色（空选 = 全角色）' : 'Visibility (empty = all)'}
              </legend>
              <div className="flex flex-wrap gap-3 mt-1">
                {ALL_ROLES.map((role) => (
                  <label
                    key={`vis-${role}`}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name={`visibility_${role}`}
                      checked={formVisibility.includes(role)}
                      onChange={() => toggleRoleIn(role, formVisibility, setFormVisibility)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{roleLabel(role, lang)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="border border-gray-200 rounded-lg p-3">
              <legend className="text-xs font-bold text-gray-600 px-1">
                {lang === 'zh' ? '设为默认角色' : 'Default For Roles'}
              </legend>
              <div className="flex flex-wrap gap-3 mt-1">
                {ALL_ROLES.map((role) => (
                  <label
                    key={`def-${role}`}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name={`default_for_${role}`}
                      checked={formDefaultForRole.includes(role)}
                      onChange={() => toggleRoleIn(role, formDefaultForRole, setFormDefaultForRole)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{roleLabel(role, lang)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="persona-form-allow-tools" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '工具白名单（逗号分隔）' : 'Allow Tools (comma-separated)'}
              </label>
              <input
                id="persona-form-allow-tools"
                name="toolAllow"
                type="text"
                value={formAllowTools}
                onChange={(e) => setFormAllowTools(e.target.value)}
                placeholder="e.g. vfs.*, lesson.*"
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="persona-form-deny-tools" className="block text-xs font-bold text-gray-600 mb-1">
                {lang === 'zh' ? '工具黑名单（逗号分隔）' : 'Deny Tools (comma-separated)'}
              </label>
              <input
                id="persona-form-deny-tools"
                name="toolDeny"
                type="text"
                value={formDenyTools}
                onChange={(e) => setFormDenyTools(e.target.value)}
                placeholder="e.g. process.*, class_create"
                className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="persona-form-inst-zh" className="block text-xs font-bold text-gray-600 mb-1">
              {lang === 'zh' ? '中文系统指令' : 'Chinese System Instruction'}
            </label>
            <textarea
              id="persona-form-inst-zh"
              name="instructionZh"
              rows={3}
              required={formId.trim() !== 'plain_assistant'}
              value={formInstructionZh}
              onChange={(e) => setFormInstructionZh(e.target.value)}
              className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="persona-form-inst-en" className="block text-xs font-bold text-gray-600 mb-1">
              {lang === 'zh' ? '英文系统指令' : 'English System Instruction'}
            </label>
            <textarea
              id="persona-form-inst-en"
              name="instructionEn"
              rows={3}
              required={formId.trim() !== 'plain_assistant'}
              value={formInstructionEn}
              onChange={(e) => setFormInstructionEn(e.target.value)}
              className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
                setEditingPersona(null);
              }}
              className="px-4 py-2 text-xs font-bold text-gray-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
            >
              {lang === 'zh' ? '取消' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-sm transition-all cursor-pointer inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
              <span>{lang === 'zh' ? '保存角色模板' : 'Save Persona'}</span>
            </button>
          </div>
        </form>
      </AccessibleDialog>
    </section>
  );
}
