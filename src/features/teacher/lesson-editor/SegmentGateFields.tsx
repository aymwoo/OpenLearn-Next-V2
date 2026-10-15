import { Lock, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';

interface GateDraft {
  id?: string;
  type: string;
  params?: Record<string, unknown>;
}

const BUILTIN_GATES: { type: string; labelZh: string; labelEn: string }[] = [
  { type: 'quiz_completed', labelZh: '完成练习', labelEn: 'Quiz completed' },
  { type: 'quiz_accuracy', labelZh: '练习正确率', labelEn: 'Quiz accuracy' },
  { type: 'assignment_submitted', labelZh: '已提交作业', labelEn: 'Assignment submitted' },
  { type: 'dwell_seconds', labelZh: '停留时长', labelEn: 'Dwell time' },
  { type: 'checked_in', labelZh: '已签到', labelEn: 'Checked in' },
];

interface PluginGateType {
  id: string;
  labelZh?: string;
  labelEn?: string;
  commandType: string;
  paramsSchema?: { properties?: Record<string, { type?: string; description?: string }> };
}

function readPluginGateTypes(plugins: { status: string; manifest: string }[]): PluginGateType[] {
  const types: PluginGateType[] = [];
  for (const plugin of plugins) {
    if (plugin.status !== 'active') continue;
    let manifest: { contributes?: Record<string, unknown> } = {};
    try {
      manifest = JSON.parse(plugin.manifest);
    } catch {
      continue;
    }
    const entries = manifest.contributes?.['segment.gate_type'];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const id = (entry as PluginGateType).id;
      const commandType = (entry as PluginGateType).commandType;
      if (typeof id !== 'string' || typeof commandType !== 'string') continue;
      types.push(entry as PluginGateType);
    }
  }
  return types;
}

function asGates(raw: unknown): GateDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item) => item && typeof item === 'object' && typeof (item as GateDraft).type === 'string',
  ) as GateDraft[];
}

export function SegmentGateFields({
  lang,
  segment,
  readOnly = false,
  onPatch,
}: {
  lang: 'zh' | 'en';
  segment: { gates?: unknown };
  readOnly?: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const plugins = useAppStore((s) => s.plugins);
  const pluginTypes = readPluginGateTypes(plugins);
  const gates = asGates(segment.gates);
  const options = [
    ...BUILTIN_GATES.map((item) => ({
      type: item.type,
      label: lang === 'zh' ? item.labelZh : item.labelEn,
    })),
    ...pluginTypes.map((item) => ({
      type: item.id,
      label: (lang === 'zh' ? item.labelZh : item.labelEn) || item.id,
    })),
  ];

  const write = (next: GateDraft[]) => onPatch({ gates: next });

  const patchGate = (index: number, patch: Partial<GateDraft> & { params?: Record<string, unknown> }) => {
    const next = gates.map((gate, i) =>
      i === index ? { ...gate, ...patch, params: { ...(gate.params || {}), ...(patch.params || {}) } } : gate,
    );
    write(next);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl p-2.5 bg-indigo-500/5 border border-indigo-500/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
          <Lock size={12} />
          <span>{lang === 'zh' ? '进入条件' : 'Entry conditions'}</span>
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => write([...gates, { type: 'quiz_completed', params: {} }])}
            className="text-[11px] font-bold text-indigo-700 flex items-center gap-1 cursor-pointer"
          >
            <Plus size={12} />
            {lang === 'zh' ? '添加条件' : 'Add condition'}
          </button>
        )}
      </div>
      <p className="text-[10px] text-muted leading-snug">
        {lang === 'zh'
          ? '课级 progress_mode 已废弃。条件写在本环节上，全部满足后学生才能看到这一环节。全班仍跟随教师的当前环节。'
          : 'Lesson-level progress_mode is deprecated. Students see this segment only after every condition below is met. The class still shares one current segment.'}
      </p>
      {gates.length === 0 && (
        <p className="text-[11px] text-muted">
          {lang === 'zh' ? '未设置条件，跟随课堂即可进入。' : 'No conditions. Following the class is enough.'}
        </p>
      )}
      {gates.map((gate, index) => (
        <div key={`${gate.type}-${index}`} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[10px] font-bold text-muted">{lang === 'zh' ? '条件类型' : 'Type'}</span>
            <select
              aria-label={lang === 'zh' ? '条件类型' : 'Condition type'}
              value={gate.type}
              disabled={readOnly}
              onChange={(e) => {
                const next = gates.map((item, i) => (i === index ? { type: e.target.value, params: {} } : item));
                write(next);
              }}
              className="border border-theme/80 px-2 py-1.5 rounded-xl bg-surface text-xs"
            >
              {options.map((option) => (
                <option key={option.type} value={option.type}>
                  {option.label}
                </option>
              ))}
              {!options.some((option) => option.type === gate.type) && <option value={gate.type}>{gate.type}</option>}
            </select>
          </label>
          <GateParams lang={lang} gate={gate} readOnly={readOnly} onChange={(params) => patchGate(index, { params })} />
          {!readOnly && (
            <button
              type="button"
              onClick={() => write(gates.filter((_, i) => i !== index))}
              className="px-2 py-1.5 text-xs text-rose-600 border border-rose-200 rounded-xl cursor-pointer flex items-center justify-center gap-1"
            >
              <Trash2 size={12} />
              {lang === 'zh' ? '移除' : 'Remove'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function textParam(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function GateParams({
  lang,
  gate,
  readOnly,
  onChange,
}: {
  lang: 'zh' | 'en';
  gate: GateDraft;
  readOnly: boolean;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const params = gate.params || {};
  const field = (key: string, label: string, placeholder: string, numeric = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold text-muted">{label}</span>
      <input
        value={textParam(params, key)}
        disabled={readOnly}
        placeholder={placeholder}
        onChange={(e) => {
          if (!numeric) {
            onChange({ [key]: e.target.value });
            return;
          }
          const parsed = Number(e.target.value);
          onChange({ [key]: e.target.value.trim() === '' || !Number.isFinite(parsed) ? e.target.value : parsed });
        }}
        className="border border-theme/80 px-2 py-1.5 rounded-xl bg-surface text-xs"
      />
    </label>
  );

  if (gate.type === 'checked_in') return <div />;
  if (gate.type === 'quiz_accuracy') {
    return (
      <>
        {field('minScore', lang === 'zh' ? '最低分' : 'Min score', '60', true)}
        {field('elementId', lang === 'zh' ? '题目 ID' : 'Element ID', '')}
      </>
    );
  }
  if (gate.type === 'dwell_seconds') {
    return field('seconds', lang === 'zh' ? '秒' : 'Seconds', '60', true);
  }
  if (gate.type === 'assignment_submitted') {
    return field('assignmentId', lang === 'zh' ? '作业 ID' : 'Assignment ID', '');
  }
  if (gate.type === 'quiz_completed') {
    return field('elementId', lang === 'zh' ? '题目 ID' : 'Element ID', '');
  }
  return field('segmentId', lang === 'zh' ? '环节 ID' : 'Segment ID', '');
}
