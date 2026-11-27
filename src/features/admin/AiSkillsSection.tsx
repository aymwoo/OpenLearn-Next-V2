/**
 * AiSkillsSection —— 管理后台「技能管理」。
 *
 * 覆盖：
 * - 技能启停与场景覆盖（PATCH /api/admin/skills/:id）；
 * - 细粒度绑定：全局 / 班级 / 课节（lesson > class > global）；
 * - 运行「运行时设置体检」技能，预览受控配置 diff 后应用；
 * - 最近运行记录与配置回滚。
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';

interface AdminSkill {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  surfaces: string[];
  outputKind?: string;
  source: string;
  enabled: boolean;
  toolCount: number;
}

interface AdminSkillRun {
  id: string;
  skillId: string;
  surface: string;
  status: string;
  artifactKind?: string | null;
  createdAt: number;
  error?: string | null;
}

interface AdminBinding {
  id: string;
  skillId: string;
  surface: string;
  scopeType: 'global' | 'class' | 'lesson';
  scopeId: string;
  enabled: boolean;
}

interface Option {
  id: string;
  name: string;
}

interface ConfigRunResult {
  runId: string;
  skillId: string;
  changes: Record<string, unknown>;
}

type ScopeType = 'global' | 'class' | 'lesson';

const CONFIG_SKILL_ID = 'admin.settings.review';

const SURFACE_LABELS: Record<string, { zh: string; en: string }> = {
  lesson_prep: { zh: '备课', en: 'Prep' },
  admin_settings: { zh: '设置', en: 'Settings' },
  classroom_live: { zh: '课堂', en: 'Classroom' },
};

const SCOPE_LABELS: Record<ScopeType, { zh: string; en: string }> = {
  global: { zh: '全局', en: 'Global' },
  class: { zh: '班级', en: 'Class' },
  lesson: { zh: '课节', en: 'Lesson' },
};

interface AiSkillsSectionProps {
  lang: 'zh' | 'en';
}

export function AiSkillsSection({ lang }: AiSkillsSectionProps) {
  const zh = lang === 'zh';
  const [skills, setSkills] = useState<AdminSkill[]>([]);
  const [runs, setRuns] = useState<AdminSkillRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [configResult, setConfigResult] = useState<ConfigRunResult | null>(null);
  const [error, setError] = useState('');

  const [expandedId, setExpandedId] = useState('');
  const [bindingsBySkill, setBindingsBySkill] = useState<Record<string, AdminBinding[]>>({});
  const [classes, setClasses] = useState<Option[]>([]);
  const [lessons, setLessons] = useState<Option[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [formSurface, setFormSurface] = useState('lesson_prep');
  const [formScopeType, setFormScopeType] = useState<ScopeType>('global');
  const [formScopeId, setFormScopeId] = useState('');
  const [bindingBusy, setBindingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [skillsRes, runsRes] = await Promise.all([
        fetch('/api/admin/skills'),
        fetch('/api/admin/skill-runs?limit=10'),
      ]);
      const skillsData = await skillsRes.json().catch(() => null);
      const runsData = await runsRes.json().catch(() => null);
      if (!skillsRes.ok || !skillsData?.success) {
        setError(zh ? '技能列表加载失败' : 'Failed to load skills');
      } else {
        setSkills(Array.isArray(skillsData.skills) ? skillsData.skills : []);
      }
      setRuns(Array.isArray(runsData?.runs) ? runsData.runs : []);
    } catch {
      setError(zh ? '技能列表加载失败' : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  }, [zh]);

  const loadOptions = useCallback(async () => {
    if (optionsLoaded) return;
    setOptionsLoaded(true);
    try {
      const [classesRes, lessonsRes] = await Promise.all([
        fetch('/api/classes?pageSize=all'),
        fetch('/api/lessons?pageSize=all'),
      ]);
      const classesData = await classesRes.json().catch(() => null);
      const lessonsData = await lessonsRes.json().catch(() => null);
      const classRows = Array.isArray(classesData?.data) ? classesData.data : [];
      const lessonRows = Array.isArray(lessonsData?.data) ? lessonsData.data : [];
      setClasses(
        classRows
          .map((row: Record<string, unknown>) => ({
            id: String(row?.id ?? ''),
            name: String(row?.name ?? row?.id ?? ''),
          }))
          .filter((row: Option) => row.id),
      );
      setLessons(
        lessonRows
          .map((row: Record<string, unknown>) => ({
            id: String(row?.id ?? ''),
            name: String(row?.title ?? row?.id ?? ''),
          }))
          .filter((row: Option) => row.id),
      );
    } catch {
      /* options are best-effort */
    }
  }, [optionsLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadBindings = async (skill: AdminSkill) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(skill.id)}/bindings`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '绑定加载失败' : 'Failed to load bindings'));
        return;
      }
      setBindingsBySkill((prev) => ({ ...prev, [skill.id]: Array.isArray(data.bindings) ? data.bindings : [] }));
    } catch {
      setError(zh ? '绑定加载失败' : 'Failed to load bindings');
    }
  };

  const toggleSkill = async (skill: AdminSkill) => {
    if (savingId) return;
    setSavingId(skill.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(skill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !skill.enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '保存失败' : 'Failed to save'));
        return;
      }
      setSkills((prev) => prev.map((item) => (item.id === skill.id ? { ...item, enabled: !skill.enabled } : item)));
    } catch {
      setError(zh ? '保存失败' : 'Failed to save');
    } finally {
      setSavingId('');
    }
  };

  const expandSkill = async (skill: AdminSkill) => {
    if (expandedId === skill.id) {
      setExpandedId('');
      return;
    }
    setExpandedId(skill.id);
    setFormSurface(skill.surfaces[0] ?? 'lesson_prep');
    setFormScopeType('global');
    setFormScopeId('');
    void loadOptions();
    await loadBindings(skill);
  };

  const addBinding = async (skill: AdminSkill) => {
    if (bindingBusy) return;
    if (formScopeType !== 'global' && !formScopeId) {
      setError(zh ? '请选择绑定对象' : 'Pick a target');
      return;
    }
    setBindingBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(skill.id)}/bindings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: formSurface,
          scopeType: formScopeType,
          scopeId: formScopeType === 'global' ? '' : formScopeId,
          enabled: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '绑定失败' : 'Binding failed'));
        return;
      }
      await loadBindings(skill);
    } catch {
      setError(zh ? '绑定失败' : 'Binding failed');
    } finally {
      setBindingBusy(false);
    }
  };

  const removeBinding = async (skill: AdminSkill, binding: AdminBinding) => {
    if (bindingBusy) return;
    setBindingBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        surface: binding.surface,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      });
      const res = await fetch(`/api/admin/skills/${encodeURIComponent(skill.id)}/bindings?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '解除绑定失败' : 'Failed to remove binding'));
        return;
      }
      await loadBindings(skill);
    } catch {
      setError(zh ? '解除绑定失败' : 'Failed to remove binding');
    } finally {
      setBindingBusy(false);
    }
  };

  const runConfigReview = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    setConfigResult(null);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(CONFIG_SKILL_ID)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface: 'admin_settings', lang }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.message || data?.error || (zh ? '运行失败' : 'Run failed'));
        return;
      }
      if (data.artifact?.kind !== 'config_patch') {
        setError(zh ? '未返回可应用的配置建议' : 'No applicable config patch returned');
        return;
      }
      setConfigResult({
        runId: data.runId,
        skillId: data.skill?.id ?? CONFIG_SKILL_ID,
        changes: data.artifact.changes,
      });
    } catch {
      setError(zh ? '运行失败' : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  const applyConfig = async () => {
    if (!configResult || applying) return;
    if (Object.keys(configResult.changes).length === 0) {
      setError(zh ? '本次没有需要应用的变更' : 'No changes to apply');
      return;
    }
    setApplying(true);
    setError('');
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(configResult.skillId)}/apply-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: configResult.runId, changes: configResult.changes }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '应用失败' : 'Apply failed'));
        return;
      }
      setConfigResult(null);
      await load();
    } catch {
      setError(zh ? '应用失败' : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const rollback = async (runId: string) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/skill-runs/${encodeURIComponent(runId)}/rollback`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        setError(data?.error || (zh ? '回滚失败' : 'Rollback failed'));
        return;
      }
      await load();
    } catch {
      setError(zh ? '回滚失败' : 'Rollback failed');
    }
  };

  const scopeOptions = formScopeType === 'class' ? classes : formScopeType === 'lesson' ? lessons : [];
  const scopeLabel = (binding: AdminBinding) => {
    if (binding.scopeType === 'global') return SCOPE_LABELS.global[zh ? 'zh' : 'en'];
    const pool = binding.scopeType === 'class' ? classes : lessons;
    const found = pool.find((item) => item.id === binding.scopeId);
    const label = SCOPE_LABELS[binding.scopeType][zh ? 'zh' : 'en'];
    return `${label}: ${found?.name ?? binding.scopeId}`;
  };

  return (
    <section className="mt-6 border border-border rounded-2xl bg-app overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-600" />
          <h3 className="text-sm font-extrabold text-main">{zh ? '技能管理' : 'Skill Management'}</h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs font-semibold text-secondary hover:text-main cursor-pointer"
          disabled={loading}
        >
          {loading ? (zh ? '刷新中…' : 'Refreshing…') : zh ? '刷新' : 'Refresh'}
        </button>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <p role="alert" className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="space-y-2">
          {skills.map((skill) => {
            const expanded = expandedId === skill.id;
            const bindings = bindingsBySkill[skill.id] ?? [];
            return (
              <div key={skill.id} className="border border-border rounded-xl">
                <div className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-main">{skill.name}</p>
                    <p className="text-xs text-secondary mt-0.5">{skill.whenToUse || skill.description}</p>
                    <p className="text-[11px] text-secondary mt-1">
                      {skill.source} ·{' '}
                      {skill.surfaces.map((s) => SURFACE_LABELS[s]?.[zh ? 'zh' : 'en'] ?? s).join(' / ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void expandSkill(skill)}
                      aria-expanded={expanded}
                      className="flex items-center gap-1 text-xs font-semibold text-secondary hover:text-main cursor-pointer"
                    >
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {zh ? '绑定' : 'Bindings'}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={skill.enabled}
                      aria-label={`${skill.name} ${zh ? '启用' : 'enabled'}`}
                      disabled={savingId === skill.id}
                      onClick={() => void toggleSkill(skill)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        skill.enabled ? 'bg-indigo-600' : 'bg-gray-300'
                      } ${savingId === skill.id ? 'opacity-60' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          skill.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border px-3 py-3 space-y-3">
                    {bindings.length === 0 ? (
                      <p className="text-xs text-secondary">
                        {zh
                          ? '未设置细粒度绑定，沿用全局启停与技能声明的场景。'
                          : 'No bindings; global enablement and declared surfaces apply.'}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {bindings.map((binding) => (
                          <li
                            key={binding.id}
                            className="flex items-center justify-between gap-3 text-xs border border-border rounded-lg px-2.5 py-1.5"
                          >
                            <span className="min-w-0 truncate">
                              <span className="font-semibold">
                                {SURFACE_LABELS[binding.surface]?.[zh ? 'zh' : 'en']}
                              </span>
                              <span className="text-secondary ml-2">{scopeLabel(binding)}</span>
                              <span className={`ml-2 ${binding.enabled ? 'text-emerald-600' : 'text-red-500'}`}>
                                {binding.enabled ? (zh ? '启用' : 'on') : zh ? '停用' : 'off'}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void removeBinding(skill, binding)}
                              disabled={bindingBusy}
                              aria-label={zh ? '解除绑定' : 'Remove binding'}
                              className="shrink-0 text-secondary hover:text-red-500 cursor-pointer disabled:opacity-50"
                            >
                              <X size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={formSurface}
                        onChange={(event) => setFormSurface(event.target.value)}
                        aria-label={zh ? '场景' : 'Surface'}
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-app text-main"
                      >
                        {skill.surfaces.map((surface) => (
                          <option key={surface} value={surface}>
                            {SURFACE_LABELS[surface]?.[zh ? 'zh' : 'en'] ?? surface}
                          </option>
                        ))}
                      </select>
                      <select
                        value={formScopeType}
                        onChange={(event) => {
                          setFormScopeType(event.target.value as ScopeType);
                          setFormScopeId('');
                        }}
                        aria-label={zh ? '范围' : 'Scope'}
                        className="text-xs border border-border rounded-lg px-2 py-1.5 bg-app text-main"
                      >
                        {(['global', 'class', 'lesson'] as ScopeType[]).map((scope) => (
                          <option key={scope} value={scope}>
                            {SCOPE_LABELS[scope][zh ? 'zh' : 'en']}
                          </option>
                        ))}
                      </select>
                      {formScopeType !== 'global' && (
                        <select
                          value={formScopeId}
                          onChange={(event) => setFormScopeId(event.target.value)}
                          aria-label={zh ? '绑定对象' : 'Target'}
                          className="text-xs border border-border rounded-lg px-2 py-1.5 bg-app text-main max-w-[240px]"
                        >
                          <option value="">{zh ? '选择…' : 'Select…'}</option>
                          {scopeOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => void addBinding(skill)}
                        disabled={bindingBusy}
                        className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg disabled:opacity-60 cursor-pointer"
                      >
                        {bindingBusy ? (zh ? '保存中' : 'Saving') : zh ? '添加绑定' : 'Add binding'}
                      </button>
                    </div>
                    <p className="text-[11px] text-secondary">
                      {zh
                        ? '优先级：课节 > 班级 > 全局；绑定会覆盖全局启停。'
                        : 'Priority: lesson > class > global; bindings override global enablement.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {!loading && skills.length === 0 && (
            <p className="text-xs text-secondary">{zh ? '暂无可用技能。' : 'No skills available.'}</p>
          )}
        </div>

        <div className="border border-border rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-main">{zh ? '运行时设置体检' : 'Runtime settings review'}</p>
              <p className="text-xs text-secondary">
                {zh
                  ? '生成受控的配置变更建议，确认后才会写入运行时策略。'
                  : 'Generates a controlled config patch; nothing is written until you confirm.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runConfigReview()}
              disabled={running}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : null}
              {running ? (zh ? '分析中' : 'Analyzing') : zh ? '生成建议' : 'Run review'}
            </button>
          </div>

          {configResult && (
            <div className="space-y-2">
              {Object.keys(configResult.changes).length === 0 ? (
                <p className="text-xs text-secondary">{zh ? '当前配置无需调整。' : 'No changes suggested.'}</p>
              ) : (
                <ul className="text-xs text-main space-y-1">
                  {Object.entries(configResult.changes).map(([key, value]) => (
                    <li
                      key={key}
                      className="flex items-center justify-between gap-3 border border-border rounded-lg px-2.5 py-1.5"
                    >
                      <span className="font-mono">{key}</span>
                      <span className="text-secondary">{String(value)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyConfig()}
                  disabled={applying || Object.keys(configResult.changes).length === 0}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-60 cursor-pointer"
                >
                  {applying ? (zh ? '应用中' : 'Applying') : zh ? '应用变更' : 'Apply changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfigResult(null)}
                  disabled={applying}
                  className="px-3 py-1.5 text-xs font-semibold text-secondary hover:text-main cursor-pointer"
                >
                  {zh ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-secondary">{zh ? '最近运行' : 'Recent runs'}</p>
          {runs.length === 0 ? (
            <p className="text-xs text-secondary">{zh ? '暂无运行记录。' : 'No runs yet.'}</p>
          ) : (
            <ul className="space-y-1">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between gap-3 text-xs border border-border rounded-lg px-2.5 py-1.5"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-mono">{run.skillId}</span>
                    <span className="text-secondary ml-2">{run.surface}</span>
                    <span className="text-secondary ml-2">{run.status}</span>
                  </span>
                  {run.artifactKind === 'config_patch' && (
                    <button
                      type="button"
                      onClick={() => void rollback(run.id)}
                      className="shrink-0 flex items-center gap-1 text-secondary hover:text-main cursor-pointer"
                    >
                      <RotateCcw size={12} />
                      {zh ? '回滚' : 'Rollback'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default AiSkillsSection;
