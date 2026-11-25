import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Check, Loader2, Pencil, Power, Plus, Trash2 } from 'lucide-react';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import { AccessibleTableRegion } from '../../components/AccessibleTableRegion';

export type PersonaRole = 'administrator' | 'teacher' | 'student';

export interface AdminPersonaRecord {
  id: string;
  nameZh: string;
  nameEn: string;
  descriptionZh?: string;
  descriptionEn?: string;
  enabled?: boolean;
  preferredProviderId?: string;
  preferredProviderName?: string;
  preferredProviderModel?: string;
  preferredProviderMissing?: boolean;
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
  references?: {
    defaultForRoles?: PersonaRole[];
    preferredProviderId?: string;
    isFallback?: boolean;
  };
}

interface AiProviderOption {
  id: string;
  name: string;
  model_name: string;
  is_shared?: boolean | number;
}

interface AiPersonasSectionProps {
  lang: 'zh' | 'en';
  aiProviders?: AiProviderOption[];
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

export function AiPersonasSection({ lang, aiProviders = [] }: AiPersonasSectionProps) {
  const sharedProviders = aiProviders.filter((p) => Boolean(p.is_shared));
  const [personas, setPersonas] = useState<AdminPersonaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<AdminPersonaRecord | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    action: 'deactivate' | 'delete';
    persona: AdminPersonaRecord;
    referencedRoles: PersonaRole[];
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [formId, setFormId] = useState('');
  const [formNameZh, setFormNameZh] = useState('');
  const [formNameEn, setFormNameEn] = useState('');
  const [formDescriptionZh, setFormDescriptionZh] = useState('');
  const [formDescriptionEn, setFormDescriptionEn] = useState('');
  const [formIcon, setFormIcon] = useState('🤖');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formPreferredProviderId, setFormPreferredProviderId] = useState('');
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
    setFormDescriptionZh('');
    setFormDescriptionEn('');
    setFormIcon('🎯');
    setFormEnabled(true);
    setFormPreferredProviderId('');
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
    setFormDescriptionZh(persona.descriptionZh || '');
    setFormDescriptionEn(persona.descriptionEn || '');
    setFormIcon(persona.icon || '🤖');
    setFormEnabled(persona.enabled !== false);
    setFormPreferredProviderId(persona.preferredProviderId || '');
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
      descriptionZh: formDescriptionZh.trim(),
      descriptionEn: formDescriptionEn.trim(),
      enabled: editingPersona?.id === 'plain_assistant' ? true : formEnabled,
      preferredProviderId: formPreferredProviderId.trim() || undefined,
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
            ? `已更新角色「${payload.nameZh}」，新会话与侧栏刷新立即生效。`
            : `Updated persona "${payload.nameEn}". Effective immediately for new requests.`
          : lang === 'zh'
            ? `已创建角色「${payload.nameZh}」，新会话与侧栏刷新立即生效。`
            : `Created persona "${payload.nameEn}". Effective immediately for new requests.`,
      );
      await fetchPersonas();
      window.dispatchEvent(new CustomEvent('openlearn:personas-updated'));
    } catch {
      setFormError(lang === 'zh' ? '网络请求失败，请重试' : 'Network request failed');
    } finally {
      setSaving(false);
    }
  };

  const executeToggleEnabled = async (persona: AdminPersonaRecord, nextEnabled: boolean, force = false) => {
    setErrorMessage('');
    try {
      const query = force ? '?force=true' : '';
      const res = await fetch(`/api/agent/personas/${encodeURIComponent(persona.id)}${query}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, ...(force ? { force: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.error === 'PERSONA_IN_USE' && !force) {
        const refs = Array.isArray(data?.references?.defaultForRoles)
          ? (data.references.defaultForRoles as PersonaRole[])
          : (persona.defaultForRole ?? []);
        setPendingConfirm({ action: 'deactivate', persona, referencedRoles: refs });
        return;
      }
      if (!res.ok || data?.success === false) {
        setErrorMessage(data?.message || data?.error || (lang === 'zh' ? '状态切换失败' : 'Status update failed'));
        return;
      }
      setStatusMessage(
        nextEnabled
          ? lang === 'zh'
            ? `已启用角色「${persona.nameZh}」`
            : `Enabled persona "${persona.nameEn}"`
          : lang === 'zh'
            ? `已停用角色「${persona.nameZh}」，引用已自动回退至可用默认角色。`
            : `Deactivated persona "${persona.nameEn}". Active references automatically fall back cleanly.`,
      );
      await fetchPersonas();
      window.dispatchEvent(new CustomEvent('openlearn:personas-updated'));
    } catch {
      setErrorMessage(lang === 'zh' ? '状态切换请求失败' : 'Failed to update persona status');
    }
  };

  const handleToggleEnabled = (persona: AdminPersonaRecord) => {
    const nextEnabled = persona.enabled === false;
    const refs = persona.references?.defaultForRoles ?? persona.defaultForRole ?? [];
    if (!nextEnabled && refs.length > 0) {
      setPendingConfirm({ action: 'deactivate', persona, referencedRoles: refs });
      return;
    }
    void executeToggleEnabled(persona, nextEnabled, false);
  };

  const executeDelete = async (persona: AdminPersonaRecord, force = false) => {
    setErrorMessage('');
    try {
      const query = force ? '?force=true' : '';
      const res = await fetch(`/api/agent/personas/${encodeURIComponent(persona.id)}${query}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.error === 'PERSONA_IN_USE' && !force) {
        const refs = Array.isArray(data?.references?.defaultForRoles)
          ? (data.references.defaultForRoles as PersonaRole[])
          : (persona.defaultForRole ?? []);
        setPendingConfirm({ action: 'delete', persona, referencedRoles: refs });
        return;
      }
      if (!res.ok || data?.success === false) {
        setErrorMessage(data?.message || data?.error || (lang === 'zh' ? '删除失败' : 'Delete failed'));
        return;
      }
      setStatusMessage(
        lang === 'zh'
          ? `已删除角色模板「${persona.nameZh}」，正在使用的默认引用已自动回退。`
          : `Deleted persona "${persona.nameEn}" cleanly.`,
      );
      await fetchPersonas();
      window.dispatchEvent(new CustomEvent('openlearn:personas-updated'));
    } catch {
      setErrorMessage(lang === 'zh' ? '删除请求失败' : 'Delete request failed');
    }
  };

  const handleDelete = (persona: AdminPersonaRecord) => {
    const refs = persona.references?.defaultForRoles ?? persona.defaultForRole ?? [];
    if (refs.length > 0) {
      setPendingConfirm({ action: 'delete', persona, referencedRoles: refs });
      return;
    }
    void executeDelete(persona, false);
  };

  const handleConfirmReferencedAction = async () => {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    try {
      if (pendingConfirm.action === 'deactivate') {
        await executeToggleEnabled(pendingConfirm.persona, false, true);
      } else {
        await executeDelete(pendingConfirm.persona, true);
      }
      setPendingConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="ai-personas-section-heading"
      className="bg-surface rounded-2xl border border-theme shadow-xs overflow-hidden text-left"
    >
      <div className="p-5 border-b border-theme flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-secondary">
        <div>
          <h3 id="ai-personas-section-heading" className="font-bold text-main flex items-center gap-2 text-base">
            <Bot className="text-primary-ink" size={18} />
            {lang === 'zh' ? '内核 AI 助教角色配置' : 'Kernel AI Assistant Personas'}
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {lang === 'zh'
              ? '管理内置与自定义 AI 助教角色（支持用途说明、启停状态、平台共享模型绑定、作用范围与默认角色）。保存后立即对新对话与侧栏生效。'
              : 'Manage built-in and custom AI assistant personas (purpose, enable/disable, shared provider binding, role scope & defaults). Changes take effect immediately for new requests.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-3.5 py-2 bg-primary-solid text-white rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-primary-solid-hover transition-colors cursor-pointer shrink-0 shadow-xs"
        >
          <Plus size={14} />
          <span>{lang === 'zh' ? '新建角色模板' : 'New Persona'}</span>
        </button>
      </div>

      <div className="mx-5 mt-4 p-3 rounded-xl bg-surface-secondary border border-theme text-[11px] text-muted leading-relaxed">
        <strong className="text-main">{lang === 'zh' ? '配置说明与生效规则：' : 'Scope & Lifecycle Guide: '}</strong>
        {lang === 'zh'
          ? '「可见角色」限定哪些身份可在 AI 侧栏选取；「默认角色」决定未切换时的初始角色；「绑定共享模型」仅允许绑定平台共享 AI 提供商（个人私有配置不会被暴露）；停用或删除被设为默认的角色时会自动解除绑定并回退至「普通助教（默认）」，保障助手始终可用。'
          : 'Visibility limits which user roles see each persona; Default For sets initial selection; Shared Provider Binding accepts only platform-shared providers; deactivating or deleting a referenced default cleanly clears bindings and falls back to Plain Assistant.'}
      </div>

      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className="mx-5 mt-4 p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs rounded-xl font-medium"
        >
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="mx-5 mt-4 p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 text-xs rounded-xl font-medium"
        >
          {errorMessage}
        </div>
      )}

      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted gap-2">
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
                <tr className="border-b border-theme text-muted bg-surface-secondary">
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '角色 / ID' : 'Persona / ID'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '用途说明' : 'Purpose'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '来源 / 绑定模型' : 'Source / Provider'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '可见范围 / 默认' : 'Scope / Default'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">
                    {lang === 'zh' ? '状态' : 'Status'}
                  </th>
                  <th scope="col" className="py-2.5 px-3 font-semibold text-right">
                    {lang === 'zh' ? '操作' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme">
                {personas.map((persona) => {
                  const displayName = lang === 'zh' ? persona.nameZh : persona.nameEn;
                  const purposeSummary =
                    lang === 'zh'
                      ? persona.descriptionZh || persona.instructionZh || '系统默认全能助教'
                      : persona.descriptionEn || persona.instructionEn || 'Default assistant';
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
                  const boundShared = persona.preferredProviderId
                    ? sharedProviders.find((p) => p.id === persona.preferredProviderId)
                    : undefined;
                  const providerText =
                    persona.preferredProviderName ||
                    boundShared?.name ||
                    (persona.preferredProviderId
                      ? lang === 'zh'
                        ? '绑定提供商已失效（自动回退）'
                        : 'Bound provider missing (fallback)'
                      : lang === 'zh'
                        ? '跟随默认'
                        : 'Follow default');
                  const isPlugin = persona.source === 'plugin';
                  const isAdmin = persona.source === 'admin';
                  const isEnabled = persona.enabled !== false;
                  const isFallback = persona.id === 'plain_assistant';

                  return (
                    <tr
                      key={persona.id}
                      className={`hover:bg-surface-secondary transition-colors ${!isEnabled ? 'opacity-65 bg-surface-secondary' : ''}`}
                    >
                      <th scope="row" className="py-2.5 px-3 font-medium text-main">
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true">{persona.icon || '🤖'}</span>
                          <div>
                            <div className="font-semibold text-main flex items-center gap-1.5">
                              <span>{displayName}</span>
                              {isFallback && (
                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-700 border border-amber-500/20 font-medium dark:text-amber-400">
                                  {lang === 'zh' ? '兜底' : 'Fallback'}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-subtle font-mono">
                              {persona.id} · {modeText}/{baseText} · {persona.maxTurns ?? 5}t
                            </div>
                          </div>
                        </div>
                      </th>
                      <td className="py-2.5 px-3 text-muted max-w-[240px]">
                        <p className="line-clamp-2 leading-snug" title={purposeSummary}>
                          {purposeSummary}
                        </p>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              persona.source === 'builtin'
                                ? 'bg-surface-secondary text-main'
                                : isAdmin
                                  ? 'bg-primary-theme-light text-primary-ink'
                                  : 'bg-purple-50 text-purple-700'
                            }`}
                          >
                            {persona.source}
                          </span>
                          <span className="text-[11px] text-muted">{providerText}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-muted">
                        <div>{visibilityText}</div>
                        {defaultText !== '—' && (
                          <div className="text-[11px] text-primary-ink font-medium mt-0.5">
                            {lang === 'zh' ? `默认: ${defaultText}` : `Default: ${defaultText}`}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                            isEnabled
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-surface-secondary text-muted'
                          }`}
                        >
                          {isEnabled ? (lang === 'zh' ? '已启用' : 'Active') : lang === 'zh' ? '已停用' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                          {!isPlugin ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(persona)}
                                aria-label={
                                  lang === 'zh'
                                    ? `编辑角色模板 ${displayName} (${persona.id})`
                                    : `Edit persona ${displayName} (${persona.id})`
                                }
                                className="px-2 py-1 text-primary-ink bg-primary-theme-light hover:bg-primary-theme/10 rounded-md font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <Pencil size={12} />
                                <span>{lang === 'zh' ? '编辑' : 'Edit'}</span>
                              </button>
                              {!isFallback && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleEnabled(persona)}
                                  aria-label={
                                    isEnabled
                                      ? lang === 'zh'
                                        ? `停用角色模板 ${displayName} (${persona.id})`
                                        : `Deactivate persona ${displayName} (${persona.id})`
                                      : lang === 'zh'
                                        ? `启用角色模板 ${displayName} (${persona.id})`
                                        : `Activate persona ${displayName} (${persona.id})`
                                  }
                                  className={`px-2 py-1 rounded-md font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                                    isEnabled
                                      ? 'text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 dark:text-amber-400'
                                      : 'text-emerald-700 bg-emerald-500/10 hover:bg-emerald-500/20 dark:text-emerald-400'
                                  }`}
                                >
                                  <Power size={12} />
                                  <span>
                                    {isEnabled
                                      ? lang === 'zh'
                                        ? '停用'
                                        : 'Disable'
                                      : lang === 'zh'
                                        ? '启用'
                                        : 'Enable'}
                                  </span>
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-subtle">
                              {lang === 'zh' ? '插件托管' : 'Plugin managed'}
                            </span>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDelete(persona)}
                              aria-label={
                                lang === 'zh'
                                  ? `删除角色模板 ${displayName} (${persona.id})`
                                  : `Delete persona ${displayName} (${persona.id})`
                              }
                              className="px-2 py-1 text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 rounded-md font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 dark:text-rose-400"
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
        className="w-full max-w-xl"
      >
        <DialogHeader>
          <DialogTitle id="ai-persona-modal-title" icon={<Bot size={18} />}>
            {editingPersona
              ? lang === 'zh'
                ? '编辑 AI 角色模板'
                : 'Edit AI Persona'
              : lang === 'zh'
                ? '新建 AI 角色模板'
                : 'Create AI Persona'}
          </DialogTitle>
          <DialogCloseButton
            label={lang === 'zh' ? '关闭角色配置对话框' : 'Close persona dialog'}
            onClick={() => {
              setIsModalOpen(false);
              setEditingPersona(null);
            }}
          />
        </DialogHeader>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col text-left">
          <DialogBody className="space-y-4">
            {formError && (
              <div
                role="alert"
                className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-700 text-xs rounded-lg dark:text-rose-400"
              >
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label htmlFor="persona-form-id" className="block text-xs font-bold text-muted mb-1">
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
                  className="w-full text-xs bg-surface-secondary disabled:bg-surface border border-theme rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
              <div>
                <label htmlFor="persona-form-icon" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '图标' : 'Icon'}
                </label>
                <input
                  id="persona-form-icon"
                  name="icon"
                  type="text"
                  value={formIcon}
                  onChange={(e) => setFormIcon(e.target.value)}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="persona-form-name-zh" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '中文名称 *' : 'Chinese Name *'}
                </label>
                <input
                  id="persona-form-name-zh"
                  name="nameZh"
                  type="text"
                  required
                  value={formNameZh}
                  onChange={(e) => setFormNameZh(e.target.value)}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
              <div>
                <label htmlFor="persona-form-name-en" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '英文名称 *' : 'English Name *'}
                </label>
                <input
                  id="persona-form-name-en"
                  name="nameEn"
                  type="text"
                  required
                  value={formNameEn}
                  onChange={(e) => setFormNameEn(e.target.value)}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="persona-form-desc-zh" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '用途说明（中文）' : 'Purpose Description (ZH)'}
                </label>
                <input
                  id="persona-form-desc-zh"
                  name="descriptionZh"
                  type="text"
                  value={formDescriptionZh}
                  onChange={(e) => setFormDescriptionZh(e.target.value)}
                  placeholder={lang === 'zh' ? '简述该助教适用教学场景' : 'Briefly describe purpose in Chinese'}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
              <div>
                <label htmlFor="persona-form-desc-en" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '用途说明（英文）' : 'Purpose Description (EN)'}
                </label>
                <input
                  id="persona-form-desc-en"
                  name="descriptionEn"
                  type="text"
                  value={formDescriptionEn}
                  onChange={(e) => setFormDescriptionEn(e.target.value)}
                  placeholder="Brief purpose summary"
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <div>
                <label htmlFor="persona-form-provider" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '绑定平台共享 AI 提供商（可选）' : 'Bind Shared AI Provider (Optional)'}
                </label>
                <select
                  id="persona-form-provider"
                  name="preferredProviderId"
                  value={formPreferredProviderId}
                  onChange={(e) => setFormPreferredProviderId(e.target.value)}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                >
                  <option value="">
                    {lang === 'zh'
                      ? '不绑定（跟随当前用户选择 / 平台默认）'
                      : 'None (follow active user/default provider)'}
                  </option>
                  {sharedProviders.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} ({provider.model_name})
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-main border border-theme rounded-lg px-3 py-2 bg-surface-secondary cursor-pointer">
                <input
                  type="checkbox"
                  name="enabled"
                  disabled={editingPersona?.id === 'plain_assistant'}
                  checked={editingPersona?.id === 'plain_assistant' ? true : formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="rounded border-theme text-primary-solid focus:ring-primary-theme"
                />
                <span>
                  {editingPersona?.id === 'plain_assistant'
                    ? lang === 'zh'
                      ? '启用中（系统兜底角色常驻）'
                      : 'Active (System fallback)'
                    : lang === 'zh'
                      ? '启用该角色模板'
                      : 'Enable this persona'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="persona-form-mode" className="block text-xs font-bold text-muted mb-1">
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
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                >
                  <option value="overlay">overlay ({lang === 'zh' ? '叠加' : 'Overlay'})</option>
                  <option value="replace">replace ({lang === 'zh' ? '替换' : 'Replace'})</option>
                </select>
              </div>
              <div>
                <label htmlFor="persona-form-base-policy" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '基础指令策略' : 'Base Policy'}
                </label>
                <select
                  id="persona-form-base-policy"
                  name="basePolicy"
                  value={formBasePolicy}
                  onChange={(e) => setFormBasePolicy(e.target.value === 'drop' ? 'drop' : 'inherit')}
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
                >
                  <option value="inherit">inherit ({lang === 'zh' ? '保留内置' : 'Inherit'})</option>
                  <option value="drop">drop ({lang === 'zh' ? '丢弃内置' : 'Drop'})</option>
                </select>
              </div>
              <div>
                <label htmlFor="persona-form-max-turns" className="block text-xs font-bold text-muted mb-1">
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
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <fieldset className="border border-theme rounded-lg p-3">
                <legend className="text-xs font-bold text-muted px-1">
                  {lang === 'zh' ? '可见角色（空选 = 全角色）' : 'Visibility (empty = all)'}
                </legend>
                <div className="flex flex-wrap gap-3 mt-1">
                  {ALL_ROLES.map((role) => (
                    <label
                      key={`vis-${role}`}
                      className="inline-flex items-center gap-1.5 text-xs text-main cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name={`visibility_${role}`}
                        checked={formVisibility.includes(role)}
                        onChange={() => toggleRoleIn(role, formVisibility, setFormVisibility)}
                        className="rounded border-theme text-primary-solid focus:ring-primary-theme"
                      />
                      <span>{roleLabel(role, lang)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="border border-theme rounded-lg p-3">
                <legend className="text-xs font-bold text-muted px-1">
                  {lang === 'zh' ? '设为默认角色' : 'Default For Roles'}
                </legend>
                <div className="flex flex-wrap gap-3 mt-1">
                  {ALL_ROLES.map((role) => (
                    <label
                      key={`def-${role}`}
                      className="inline-flex items-center gap-1.5 text-xs text-main cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name={`default_for_${role}`}
                        checked={formDefaultForRole.includes(role)}
                        onChange={() => toggleRoleIn(role, formDefaultForRole, setFormDefaultForRole)}
                        className="rounded border-theme text-primary-solid focus:ring-primary-theme"
                      />
                      <span>{roleLabel(role, lang)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="persona-form-allow-tools" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '工具白名单（逗号分隔）' : 'Allow Tools (comma-separated)'}
                </label>
                <input
                  id="persona-form-allow-tools"
                  name="toolAllow"
                  type="text"
                  value={formAllowTools}
                  onChange={(e) => setFormAllowTools(e.target.value)}
                  placeholder="e.g. vfs.*, lesson.*"
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
              <div>
                <label htmlFor="persona-form-deny-tools" className="block text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '工具黑名单（逗号分隔）' : 'Deny Tools (comma-separated)'}
                </label>
                <input
                  id="persona-form-deny-tools"
                  name="toolDeny"
                  type="text"
                  value={formDenyTools}
                  onChange={(e) => setFormDenyTools(e.target.value)}
                  placeholder="e.g. process.*, class_create"
                  className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary-theme"
                />
              </div>
            </div>

            <div>
              <label htmlFor="persona-form-inst-zh" className="block text-xs font-bold text-muted mb-1">
                {lang === 'zh' ? '中文系统指令' : 'Chinese System Instruction'}
              </label>
              <textarea
                id="persona-form-inst-zh"
                name="instructionZh"
                rows={3}
                required={formId.trim() !== 'plain_assistant'}
                value={formInstructionZh}
                onChange={(e) => setFormInstructionZh(e.target.value)}
                className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
              />
            </div>

            <div>
              <label htmlFor="persona-form-inst-en" className="block text-xs font-bold text-muted mb-1">
                {lang === 'zh' ? '英文系统指令' : 'English System Instruction'}
              </label>
              <textarea
                id="persona-form-inst-en"
                name="instructionEn"
                rows={3}
                required={formId.trim() !== 'plain_assistant'}
                value={formInstructionEn}
                onChange={(e) => setFormInstructionEn(e.target.value)}
                className="w-full text-xs bg-surface-secondary border border-theme rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-theme"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogButton
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setEditingPersona(null);
              }}
            >
              {lang === 'zh' ? '取消' : 'Cancel'}
            </DialogButton>
            <DialogButton variant="primary" type="submit" disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
              <span>{lang === 'zh' ? '保存角色模板' : 'Save Persona'}</span>
            </DialogButton>
          </DialogFooter>
        </form>
      </AccessibleDialog>

      <AccessibleDialog
        open={Boolean(pendingConfirm)}
        onClose={() => {
          if (!confirmBusy) setPendingConfirm(null);
        }}
        ariaLabelledBy="persona-confirm-dialog-title"
        variant="warning"
        className="w-full max-w-md"
      >
        {pendingConfirm && (
          <>
            <DialogHeader>
              <DialogTitle id="persona-confirm-dialog-title" icon={<AlertTriangle size={18} />} iconVariant="warning">
                {pendingConfirm.action === 'deactivate'
                  ? lang === 'zh'
                    ? '确认停用正在引用的助教角色'
                    : 'Confirm Deactivating Referenced Persona'
                  : lang === 'zh'
                    ? '确认删除正在引用的助教角色'
                    : 'Confirm Deleting Referenced Persona'}
              </DialogTitle>
              <DialogCloseButton
                label={lang === 'zh' ? '关闭对话框' : 'Close dialog'}
                disabled={confirmBusy}
                onClick={() => setPendingConfirm(null)}
              />
            </DialogHeader>
            <DialogBody>
              <p className="text-xs text-muted leading-relaxed">
                {lang === 'zh'
                  ? `角色「${pendingConfirm.persona.nameZh}」（${pendingConfirm.persona.id}）当前被设为「${pendingConfirm.referencedRoles.map((r) => roleLabel(r, 'zh')).join('、')}」的默认助教。继续${pendingConfirm.action === 'deactivate' ? '停用' : '删除'}后，系统将自动清除这些默认绑定并回退至「普通助教（默认）」，已打开侧栏的会话将在下次刷新或发送消息时自动平滑切换，不会影响助手正常使用。`
                  : `Persona "${pendingConfirm.persona.nameEn}" (${pendingConfirm.persona.id}) is currently set as default for: ${pendingConfirm.referencedRoles.map((r) => roleLabel(r, 'en')).join(', ')}. Proceeding will automatically clear those default bindings and fall back to "Plain Assistant" so assistant service stays available.`}
              </p>
            </DialogBody>
            <DialogFooter>
              <DialogButton
                variant="secondary"
                autoFocus
                disabled={confirmBusy}
                onClick={() => setPendingConfirm(null)}
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </DialogButton>
              <DialogButton
                variant="warning"
                disabled={confirmBusy}
                onClick={() => void handleConfirmReferencedAction()}
              >
                {pendingConfirm.action === 'deactivate'
                  ? lang === 'zh'
                    ? '确认停用并自动回退'
                    : 'Deactivate & Fall Back'
                  : lang === 'zh'
                    ? '确认删除并自动回退'
                    : 'Delete & Fall Back'}
              </DialogButton>
            </DialogFooter>
          </>
        )}
      </AccessibleDialog>
    </section>
  );
}
