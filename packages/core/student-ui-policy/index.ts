/**
 * 学生端界面可见性策略（Gitee Issue IKW5KV）。
 *
 * 教师可以按「我的全局 → 班级 → 课节」三层收敛学生首屏可见内容；
 * 学生本地布局只能在这些允许范围内调整，不能突破教师设定。
 *
 * 本模块是前后端共享的唯一契约：
 * - 功能 ID 白名单与默认值；
 * - 策略文档的严格校验（服务端写入）与宽松归一化（前端读取）；
 * - 多层策略的生效解析（服务端解析、前端兜底共用）。
 */

/** 学生首屏可被教师控制的内置功能。 */
export const STUDENT_UI_FEATURE_IDS = [
  'section.hero-widget',
  'section.roll-call-alarms',
  'section.learning-focus',
  'section.floating-quick-actions',
  'widget.upcoming-assignments',
  'widget.schedules',
  'widget.course-progress',
  'widget.quick-stats',
  'widget.assessments',
  'widget.progress-trends',
  'widget.academic-trajectory',
  'widget.academic-comparison',
  'widget.extension-views',
  'quick-action.join-live-session',
  'quick-action.view-assignments',
  'quick-action.check-notifications',
] as const;

export type StudentUiFeatureId = (typeof STUDENT_UI_FEATURE_IDS)[number];

export const STUDENT_UI_FEATURE_SET: ReadonlySet<string> = new Set(STUDENT_UI_FEATURE_IDS);

/** 与 `src/features/student/types/dashboardLayout.ts` 的 DashboardWidgetId 一一对应。 */
export const STUDENT_DASHBOARD_WIDGET_IDS = [
  'upcoming-assignments',
  'schedules',
  'course-progress',
  'quick-stats',
  'assessments',
  'progress-trends',
  'academic-trajectory',
  'academic-comparison',
  'extension-views',
] as const;

export type StudentDashboardWidgetId = (typeof STUDENT_DASHBOARD_WIDGET_IDS)[number];

export function widgetFeatureId(widgetId: StudentDashboardWidgetId): StudentUiFeatureId {
  return `widget.${widgetId}`;
}

/** 未配置策略时的默认值：全部展示，提示文案保持现状。 */
export const STUDENT_UI_DEFAULT_FEATURES: Readonly<Record<StudentUiFeatureId, boolean>> = Object.freeze(
  STUDENT_UI_FEATURE_IDS.reduce(
    (acc, id) => {
      acc[id] = true;
      return acc;
    },
    {} as Record<StudentUiFeatureId, boolean>,
  ),
);

export type StudentUiScopeType = 'teacher' | 'class' | 'lesson';

/** 单层策略：只保存教师显式设置的项，未设置的继续继承上层。 */
export interface StudentUiPolicyLayer {
  features: Partial<Record<StudentUiFeatureId, boolean>>;
  hideGuidance?: boolean;
  hiddenPlugins: string[];
  hiddenExtensions: string[];
}

export interface StudentUiPolicyDocument extends StudentUiPolicyLayer {
  version: 1;
}

export interface EffectiveStudentUiPolicy {
  features: Record<StudentUiFeatureId, boolean>;
  hideGuidance: boolean;
  hiddenPlugins: string[];
  hiddenExtensions: string[];
  /** 服务端返回的策略版本标识，用于客户端缓存与调试。 */
  revision: string;
  /** 每个功能最终来自哪一层，便于教师端预览与学生端排障。 */
  sources: Partial<Record<StudentUiFeatureId, StudentUiScopeType | 'default'>>;
}

export interface StudentUiPolicyLayerWithSource {
  source: StudentUiScopeType;
  policy: StudentUiPolicyLayer;
}

export const EMPTY_STUDENT_UI_POLICY_LAYER: Readonly<StudentUiPolicyLayer> = Object.freeze({
  features: {},
  hiddenPlugins: [],
  hiddenExtensions: [],
});

const MAX_ARRAY_ITEMS = 200;
const MAX_ID_LENGTH = 160;
const POLICY_FIELDS = new Set(['version', 'features', 'hideGuidance', 'hiddenPlugins', 'hiddenExtensions']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_ARRAY_ITEMS) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_ID_LENGTH) return null;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export type PolicyValidationResult = { ok: true; value: StudentUiPolicyLayer } | { ok: false; error: string };

/**
 * 严格校验教师提交的策略文档。
 *
 * 未知功能 ID、未知顶层字段、错误类型一律拒绝，避免拼写错误静默落库后
 * “教师以为关掉了、学生实际仍能看到”。
 */
export function validateStudentUiPolicyDocument(input: unknown): PolicyValidationResult {
  if (!isPlainObject(input)) return { ok: false, error: '策略必须是对象' };
  for (const key of Object.keys(input)) {
    if (!POLICY_FIELDS.has(key)) return { ok: false, error: `未知字段：${key}` };
  }
  if (input.version !== 1) return { ok: false, error: 'version 必须为 1' };

  const rawFeatures = input.features;
  if (rawFeatures !== undefined && !isPlainObject(rawFeatures)) {
    return { ok: false, error: 'features 必须是对象' };
  }
  const features: Partial<Record<StudentUiFeatureId, boolean>> = {};
  if (rawFeatures) {
    for (const [key, value] of Object.entries(rawFeatures)) {
      if (!STUDENT_UI_FEATURE_SET.has(key)) return { ok: false, error: `未知功能 ID：${key}` };
      if (typeof value !== 'boolean') return { ok: false, error: `功能 ${key} 的值必须是布尔值` };
      features[key as StudentUiFeatureId] = value;
    }
  }

  if (input.hideGuidance !== undefined && typeof input.hideGuidance !== 'boolean') {
    return { ok: false, error: 'hideGuidance 必须是布尔值' };
  }

  const hiddenPlugins = normalizeStringArray(input.hiddenPlugins);
  if (hiddenPlugins === null) return { ok: false, error: 'hiddenPlugins 必须是字符串数组' };
  const hiddenExtensions = normalizeStringArray(input.hiddenExtensions);
  if (hiddenExtensions === null) return { ok: false, error: 'hiddenExtensions 必须是字符串数组' };

  const value: StudentUiPolicyLayer = {
    features,
    hiddenPlugins,
    hiddenExtensions,
  };
  if (typeof input.hideGuidance === 'boolean') value.hideGuidance = input.hideGuidance;
  return { ok: true, value };
}

/** 解析数据库中的 policy_json；损坏数据视为空层，不让整页策略失败。 */
export function parseStoredStudentUiPolicy(raw: unknown): StudentUiPolicyLayer {
  if (typeof raw !== 'string' && !isPlainObject(raw)) return { ...EMPTY_STUDENT_UI_POLICY_LAYER, features: {} };
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY_STUDENT_UI_POLICY_LAYER, features: {} };
    }
  }
  const result = validateStudentUiPolicyDocument(parsed);
  return result.ok ? result.value : { ...EMPTY_STUDENT_UI_POLICY_LAYER, features: {} };
}

/**
 * 宽松归一化服务端返回的生效策略。
 *
 * 前端不能用严格校验：服务端未来新增功能 ID 时，旧前端应忽略未知项而不是
 * 整体回退到默认值（那会让学生突然看到教师已隐藏的内容）。
 */
export function normalizeEffectiveStudentUiPolicy(input: unknown): EffectiveStudentUiPolicy {
  const fallback: EffectiveStudentUiPolicy = {
    features: { ...STUDENT_UI_DEFAULT_FEATURES },
    hideGuidance: false,
    hiddenPlugins: [],
    hiddenExtensions: [],
    revision: '',
    sources: {},
  };
  if (!isPlainObject(input)) return fallback;

  const features = { ...STUDENT_UI_DEFAULT_FEATURES };
  if (isPlainObject(input.features)) {
    for (const id of STUDENT_UI_FEATURE_IDS) {
      const value = input.features[id];
      if (typeof value === 'boolean') features[id] = value;
    }
  }

  const sources: EffectiveStudentUiPolicy['sources'] = {};
  if (isPlainObject(input.sources)) {
    for (const id of STUDENT_UI_FEATURE_IDS) {
      const value = input.sources[id];
      if (value === 'default' || value === 'teacher' || value === 'class' || value === 'lesson') {
        sources[id] = value;
      }
    }
  }

  const hiddenPlugins = normalizeStringArray(input.hiddenPlugins);
  const hiddenExtensions = normalizeStringArray(input.hiddenExtensions);

  return {
    features,
    hideGuidance: input.hideGuidance === true,
    hiddenPlugins: hiddenPlugins ?? [],
    hiddenExtensions: hiddenExtensions ?? [],
    revision: typeof input.revision === 'string' ? input.revision : '',
    sources,
  };
}

/**
 * 解析多层策略。
 *
 * 规则：
 * - 功能项：默认 → 教师全局 → 班级（多个班级隐藏优先）→ 课节（显式覆盖）。
 * - 插件隐藏：各层取并集（隐藏一旦设置，下层不能重新放开整个插件）。
 * - hideGuidance：课节 > 班级（任一班级隐藏即隐藏） > 教师全局 > 默认显示。
 */
export function resolveEffectiveStudentUiPolicy(
  layers: StudentUiPolicyLayerWithSource[],
  revision = '',
): EffectiveStudentUiPolicy {
  const teacher = layers.filter((l) => l.source === 'teacher');
  const classes = layers.filter((l) => l.source === 'class');
  const lessons = layers.filter((l) => l.source === 'lesson');

  const features = { ...STUDENT_UI_DEFAULT_FEATURES };
  const sources: EffectiveStudentUiPolicy['sources'] = {};

  for (const id of STUDENT_UI_FEATURE_IDS) {
    let value = STUDENT_UI_DEFAULT_FEATURES[id];
    let source: StudentUiScopeType | 'default' = 'default';

    const teacherValues = teacher
      .map((layer) => layer.policy.features[id])
      .filter((next): next is boolean => typeof next === 'boolean');
    if (teacherValues.length > 0) {
      value = teacherValues.every(Boolean);
      source = 'teacher';
    }

    const classValues = classes
      .map((layer) => layer.policy.features[id])
      .filter((next): next is boolean => typeof next === 'boolean');
    if (classValues.length > 0) {
      value = classValues.every(Boolean);
      source = 'class';
    }

    for (const layer of lessons) {
      const next = layer.policy.features[id];
      if (typeof next === 'boolean') {
        value = next;
        source = 'lesson';
      }
    }

    features[id] = value;
    sources[id] = source;
  }

  let hideGuidance = false;
  for (const layer of teacher) {
    if (typeof layer.policy.hideGuidance === 'boolean') hideGuidance = layer.policy.hideGuidance;
  }
  const classGuidance = classes
    .map((layer) => layer.policy.hideGuidance)
    .filter((value): value is boolean => typeof value === 'boolean');
  if (classGuidance.length > 0) hideGuidance = classGuidance.some(Boolean);
  for (const layer of lessons) {
    if (typeof layer.policy.hideGuidance === 'boolean') hideGuidance = layer.policy.hideGuidance;
  }

  const hiddenPlugins = new Set<string>();
  const hiddenExtensions = new Set<string>();
  for (const layer of layers) {
    for (const id of layer.policy.hiddenPlugins) hiddenPlugins.add(id);
    for (const id of layer.policy.hiddenExtensions) hiddenExtensions.add(id);
  }

  return {
    features,
    hideGuidance,
    hiddenPlugins: Array.from(hiddenPlugins),
    hiddenExtensions: Array.from(hiddenExtensions),
    revision,
    sources,
  };
}

/** 判断某个插件贡献是否被策略隐藏。 */
export function isPluginHiddenByPolicy(
  policy: Pick<EffectiveStudentUiPolicy, 'hiddenPlugins' | 'hiddenExtensions'> | null | undefined,
  pluginId: string,
  extensionId?: string,
): boolean {
  if (!policy) return false;
  if (policy.hiddenPlugins.includes(pluginId)) return true;
  if (!extensionId) return false;
  return policy.hiddenExtensions.includes(`${pluginId}/${extensionId}`);
}
