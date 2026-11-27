/**
 * skill-registry — Skill 作为插件声明式贡献的宿主注册表（P0）。
 *
 * 设计约束：
 * - **不新建第二套 AI 链路**：技能仍然来自 manifest `contributes['ai.skill.provider']`，
 *   宿主只在其上补一层「目录 + 场景/角色过滤 + 产物解析」，供 `/api/skills` 与
 *   `server/ai-agent.ts` 共用。
 * - 旧条目（只有 `id/name/description/commandType`）保持合法，等价于「单工具技能」。
 * - P0 不落库：技能目录由内置种子 + active 插件 manifest 实时计算，运行记录暂不持久化。
 */

import crypto from 'node:crypto';
import { kernelContainer } from '../packages/core/kernel/index.js';
import { resolvePluginCommandType } from '../packages/core/plugin-host/plugin-namespace.js';
import { loadSkillBindings, loadSkillSettings, resolveSkillBinding, type SkillBinding } from './skill-store.js';

const CAP_SKILL_SCRIPT = 'skill:script';

export type SkillSurface = 'lesson_prep' | 'admin_settings' | 'classroom_live';
export type SkillRole = 'administrator' | 'teacher' | 'student';
export type SkillSource = 'builtin' | 'plugin';
export type SkillLatencyClass = 'interactive' | 'background';
export type SkillOutputKind = 'lesson_segments' | 'config_patch' | 'classroom_card';
export type LessonSegmentType = 'intro' | 'lecture' | 'practice' | 'summary';

export const SKILL_SURFACES: readonly SkillSurface[] = ['lesson_prep', 'admin_settings', 'classroom_live'];
export const SKILL_ROLES: readonly SkillRole[] = ['administrator', 'teacher', 'student'];

export interface SkillToolRef {
  commandType: string;
  requiresConfirm?: boolean;
}

export interface SkillDescriptor {
  id: string;
  source: SkillSource;
  pluginId?: string;
  name: string;
  description: string;
  whenToUse?: string;
  instructions?: string;
  resources?: string[];
  surfaces: SkillSurface[];
  /** undefined 表示「除学生外的所有角色」 */
  roles?: SkillRole[];
  tools: SkillToolRef[];
  outputKind?: SkillOutputKind;
  latencyClass: SkillLatencyClass;
  maxTurns?: number;
  requiresConfirm?: boolean;
  /** 管理员可停用；停用后不出现在目录与运行时（管理端查询可见） */
  enabled: boolean;
  /** 沙箱脚本技能：确定性执行，不经过大模型（需 skill:script 能力） */
  script?: { source: string; timeoutMs?: number };
}

/** 与 `server/ai-agent.ts` 的 PluginSkillTool 结构兼容（结构化类型）。 */
export interface SkillToolBinding {
  toolName: string;
  skillName: string;
  description: string;
  commandType: string;
  parametersSchema?: Record<string, unknown>;
  pluginActorId: string;
  pluginId: string;
  requiresConfirm?: boolean;
}

export interface LessonSegmentDraft {
  title: string;
  duration: string;
  type: LessonSegmentType;
}

export interface ClassroomCard {
  title: string;
  body: string;
}

export interface SkillArtifactMap {
  lesson_segments: { kind: 'lesson_segments'; segments: LessonSegmentDraft[] };
  config_patch: { kind: 'config_patch'; changes: ConfigPatchChanges };
  classroom_card: { kind: 'classroom_card'; card: ClassroomCard };
}

export type SkillArtifact = SkillArtifactMap[keyof SkillArtifactMap];

/** config_patch 的受控字段集合（与 RuntimePolicyPatch 对齐，禁止模型写入任意设置）。 */
export const CONFIG_PATCH_KEYS = [
  'hookTelemetryEnabled',
  'httpAccessLogMode',
  'httpAccessLogIgnore',
  'httpSlowMs',
  'allowUnsignedByDefault',
  'modePacksEnabled',
  'modePackShowXueanTab',
] as const;

export const CONFIG_PATCH_KEY_SET: ReadonlySet<string> = new Set(CONFIG_PATCH_KEYS);

export type ConfigPatchChanges = Record<string, boolean | string | number | null>;

const SKILL_TOOL_PREFIX = 'pskill_';
const MAX_SEGMENTS = 8;

export const LESSON_SEGMENT_COLORS: Record<LessonSegmentType, string> = {
  intro: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
  lecture: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
  practice: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
  summary: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
};

const BUILTIN_SKILLS: readonly SkillDescriptor[] = [
  {
    id: 'lesson.plan.generate',
    source: 'builtin',
    name: '课时教案生成',
    description: '根据课节标题与已有环节生成 3-5 个教学环节，可直接插入备课时间线。',
    whenToUse: '教师备课时需要快速产出课时环节结构',
    instructions: [
      '你是备课助手。请基于当前课节标题与已有环节，设计 3-5 个连贯的教学环节。',
      '要求：',
      '1. 只输出 JSON，不要输出解释、Markdown 代码围栏或其他文字；',
      '2. JSON 结构：{"segments":[{"title":"环节名称","duration":"10m","type":"intro|lecture|practice|summary"}]}；',
      '3. 每个 title 不超过 20 个汉字，duration 使用 "5m"/"10m"/"15m" 格式；',
      '4. 不要重复已有环节的标题。',
    ].join('\n'),
    surfaces: ['lesson_prep'],
    roles: ['teacher', 'administrator'],
    tools: [],
    outputKind: 'lesson_segments',
    latencyClass: 'interactive',
    maxTurns: 1,
    requiresConfirm: true,
    enabled: true,
  },
  {
    id: 'admin.settings.review',
    source: 'builtin',
    name: '运行时设置体检',
    description: '根据当前运行时策略与管理员诉求，给出受控的配置变更建议（需管理员确认后应用）。',
    whenToUse: '管理员需要调整运行时策略但不确定影响时',
    instructions: [
      '你是系统设置助手。根据当前运行时策略快照与管理员诉求，给出最小必要的配置变更建议。',
      '可变更字段仅限：hookTelemetryEnabled, httpAccessLogMode, httpAccessLogIgnore, httpSlowMs, allowUnsignedByDefault, modePacksEnabled, modePackShowXueanTab。',
      '要求：',
      '1. 只输出 JSON，不要输出解释或 Markdown 代码围栏；',
      '2. JSON 结构：{"changes":{"modePacksEnabled":true}}；',
      '3. 不需要变更时输出 {"changes":{}}；',
      '4. 不得建议白名单之外的字段。',
    ].join('\n'),
    surfaces: ['admin_settings'],
    roles: ['administrator'],
    tools: [],
    outputKind: 'config_patch',
    latencyClass: 'interactive',
    maxTurns: 1,
    requiresConfirm: true,
    enabled: true,
  },
  {
    id: 'classroom.lesson_summary',
    source: 'builtin',
    name: '课堂小结卡片',
    description: '根据当前课节与课堂阶段生成一张可投屏的课堂小结卡片。',
    whenToUse: '课堂收尾或环节切换时需要快速生成小结时',
    instructions: [
      '你是课堂助教。请根据当前课节标题、教学环节与课堂阶段，生成一张简洁的课堂小结卡片。',
      '要求：',
      '1. 只输出 JSON，不要输出解释或 Markdown 代码围栏；',
      '2. JSON 结构：{"title":"卡片标题","body":"3-6 行要点，使用换行分隔"}；',
      '3. 标题不超过 20 个汉字，正文不超过 300 字；',
      '4. 不编造课节中未出现的知识点。',
    ].join('\n'),
    surfaces: ['classroom_live'],
    roles: ['teacher', 'administrator'],
    tools: [],
    outputKind: 'classroom_card',
    latencyClass: 'interactive',
    maxTurns: 1,
    requiresConfirm: true,
    enabled: true,
  },
];

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const asStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    const trimmed = asString(item);
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result.length > 0 ? result : undefined;
};

const normalizeSurfaces = (value: unknown): SkillSurface[] => {
  const raw = asStringArray(value);
  if (!raw) return [...SKILL_SURFACES];
  const result = raw.filter((item): item is SkillSurface => (SKILL_SURFACES as readonly string[]).includes(item));
  return result.length > 0 ? result : [...SKILL_SURFACES];
};

const normalizeRoles = (value: unknown): SkillRole[] | undefined => {
  const raw = asStringArray(value);
  if (!raw) return undefined;
  const result = raw.filter((item): item is SkillRole => (SKILL_ROLES as readonly string[]).includes(item));
  return result.length > 0 ? result : undefined;
};

const normalizeMaxTurns = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(20, Math.max(1, Math.trunc(value)));
};

const namespaceSkillId = (pluginId: string, rawId: string): string =>
  rawId.includes(':') ? rawId : `${pluginId}:${rawId}`;

const MAX_SCRIPT_SOURCE = 32768;

const normalizeSkillScript = (value: unknown): { source: string; timeoutMs?: number } | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const source = typeof entry.source === 'string' ? entry.source : '';
  if (!source.trim() || source.length > MAX_SCRIPT_SOURCE) return undefined;
  const timeoutRaw = entry.timeoutMs;
  const timeoutMs =
    typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw)
      ? Math.min(3000, Math.max(50, Math.trunc(timeoutRaw)))
      : undefined;
  return { source, ...(timeoutMs ? { timeoutMs } : {}) };
};

export interface SkillScopeContext {
  surface?: SkillSurface;
  lessonId?: string | null;
  classId?: string | null;
}

const hasScriptCapability = (pluginId: string): boolean => {
  try {
    return kernelContainer.capabilityGuard?.check(`plugin:${pluginId}`, CAP_SKILL_SCRIPT) === true;
  } catch {
    return false;
  }
};

/**
 * 纯函数：把一个 manifest 解析为技能描述符。便于单测与跨模块复用。
 *
 * @param source manifest JSON 字符串或已解析对象
 */
export function parseManifestSkills(source: string | object | null | undefined): SkillDescriptor[] {
  if (!source) return [];
  let parsed: unknown;
  try {
    parsed = typeof source === 'string' ? JSON.parse(source) : source;
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const manifest = parsed as { id?: unknown; contributes?: Record<string, unknown> };
  const pluginId = asString(manifest.id);
  const entries = manifest.contributes?.['ai.skill.provider'];
  if (!pluginId || !Array.isArray(entries)) return [];

  const descriptors: SkillDescriptor[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const rawId = asString(entry.id);
    if (!rawId) continue;

    const tools: SkillToolRef[] = [];
    if (Array.isArray(entry.tools)) {
      for (const tool of entry.tools) {
        if (!tool || typeof tool !== 'object') continue;
        const commandType = asString((tool as Record<string, unknown>).commandType);
        if (!commandType) continue;
        tools.push({
          commandType,
          requiresConfirm: (tool as Record<string, unknown>).requiresConfirm === true,
        });
      }
    }
    // 旧条目：顶层 commandType 等价于单工具技能
    const legacyCommandType = asString(entry.commandType);
    if (tools.length === 0 && legacyCommandType) {
      tools.push({ commandType: legacyCommandType, requiresConfirm: entry.requiresConfirm === true });
    }

    const script = normalizeSkillScript(entry.script);
    // 既没有工具也没有脚本的条目无法执行，直接跳过。
    if (tools.length === 0 && !script) continue;

    const name = asString(entry.name) ?? rawId;
    const outputKind =
      entry.outputKind === 'lesson_segments' ||
      entry.outputKind === 'config_patch' ||
      entry.outputKind === 'classroom_card'
        ? entry.outputKind
        : undefined;
    descriptors.push({
      id: namespaceSkillId(pluginId, rawId),
      source: 'plugin',
      pluginId,
      name,
      description: asString(entry.description) ?? name,
      whenToUse: asString(entry.whenToUse),
      instructions: asString(entry.instructions),
      resources: asStringArray(entry.resources),
      surfaces: normalizeSurfaces(entry.surfaces),
      roles: normalizeRoles(entry.roles),
      tools,
      outputKind,
      latencyClass: entry.latencyClass === 'background' ? 'background' : 'interactive',
      maxTurns: normalizeMaxTurns(entry.maxTurns),
      requiresConfirm: entry.requiresConfirm === true,
      enabled: true,
      ...(script ? { script } : {}),
    });
  }
  return descriptors;
}

/**
 * 把生效绑定合并进技能描述符。
 *
 * 角色规则：绑定 roles 只能**收窄**技能声明，不能扩大。
 * 未声明 roles 的技能默认角色是 teacher + administrator；因此绑定声明
 * student 时交集为空（该范围内无人可用，fail-closed）。
 */
export function applyBindingToSkill(
  skill: SkillDescriptor,
  binding: Pick<SkillBinding, 'enabled' | 'roles'>,
): SkillDescriptor {
  const next: SkillDescriptor = { ...skill, enabled: binding.enabled };
  if (!binding.roles) return next;
  const declared: SkillRole[] = skill.roles ?? ['teacher', 'administrator'];
  next.roles = declared.filter((role) => binding.roles!.includes(role));
  return next;
}

/**
 * 读取全部 active 插件的 manifest 并解析技能，并合并管理员设置与细粒度绑定。
 * `includeDisabled: true` 仅供管理端使用：不应用绑定、不过滤停用技能。
 */
export function collectSkillDescriptors(
  options: { includeDisabled?: boolean } & SkillScopeContext = {},
): SkillDescriptor[] {
  const descriptors: SkillDescriptor[] = BUILTIN_SKILLS.map((skill) => ({ ...skill }));
  try {
    const rows = kernelContainer.db
      .prepare("SELECT manifest FROM plugins WHERE status = 'active' AND manifest IS NOT NULL AND manifest != ''")
      .all() as Array<{ manifest: string }>;
    for (const row of rows) {
      descriptors.push(...parseManifestSkills(row.manifest));
    }
  } catch (err: unknown) {
    console.error('[SkillRegistry] Failed to collect plugin skills:', err instanceof Error ? err.message : String(err));
  }

  const settings = loadSkillSettings();
  const bindings = options.includeDisabled ? [] : loadSkillBindings();
  const resolved = descriptors.map((skill) => {
    let next = skill;
    const setting = settings.get(skill.id);
    if (setting) {
      next = {
        ...next,
        enabled: setting.enabled,
        surfaces: setting.surfaces && setting.surfaces.length > 0 ? setting.surfaces : next.surfaces,
      };
    }
    // 脚本能力 fail-closed：未获 skill:script 的插件，脚本被剥离（技能保留为普通技能）。
    if (next.script && next.pluginId && !hasScriptCapability(next.pluginId)) {
      next = { ...next, script: undefined };
    }
    if (!options.includeDisabled && options.surface) {
      const binding = resolveSkillBinding(bindings, {
        skillId: next.id,
        surface: options.surface,
        lessonId: options.lessonId,
        classId: options.classId,
      });
      if (binding) next = applyBindingToSkill(next, binding);
    }
    return next;
  });
  return options.includeDisabled ? resolved : resolved.filter((skill) => skill.enabled);
}

/** 纯函数：按场景 + 角色过滤。未声明 roles 的技能默认排除学生（SEC-01）。 */
export function isSkillVisible(skill: SkillDescriptor, surface?: SkillSurface, role?: string): boolean {
  if (!skill.enabled) return false;
  if (surface && !skill.surfaces.includes(surface)) return false;
  if (skill.roles) return !!role && skill.roles.includes(role as SkillRole);
  return role !== 'student';
}

export function listSkillCatalog(
  options: { surface?: SkillSurface; role?: string } & SkillScopeContext = {},
): SkillDescriptor[] {
  return collectSkillDescriptors({
    surface: options.surface,
    lessonId: options.lessonId,
    classId: options.classId,
  }).filter((skill) => isSkillVisible(skill, options.surface, options.role));
}

export function getSkillDescriptor(
  id: string,
  options: { includeDisabled?: boolean } & SkillScopeContext = {},
): SkillDescriptor | undefined {
  return collectSkillDescriptors(options).find((skill) => skill.id === id);
}

const resolveSkillCommandType = (skill: SkillDescriptor, commandType: string): string => {
  if (skill.source === 'builtin' || !skill.pluginId) return commandType;
  const isFirstParty = skill.pluginId.startsWith('@openlearn/');
  const registered = !!kernelContainer.actionRegistry.getActionByCommandType(commandType);
  return isFirstParty && registered ? commandType : resolvePluginCommandType(commandType, skill.pluginId);
};

const skillToolName = (commandType: string): string => SKILL_TOOL_PREFIX + commandType.replace(/[^a-zA-Z0-9_-]/g, '_');

/** 把技能声明的工具解析为可注入 Agent 的绑定（含命名空间规则与插件 actor）。 */
export function buildSkillToolBindings(skill: SkillDescriptor): SkillToolBinding[] {
  return skill.tools.map((tool) => {
    const commandType = resolveSkillCommandType(skill, tool.commandType);
    return {
      toolName: skillToolName(commandType),
      skillName: skill.name,
      description: skill.whenToUse || skill.description,
      commandType,
      pluginActorId: skill.pluginId ? `plugin:${skill.pluginId}` : 'system',
      pluginId: skill.pluginId ?? 'builtin',
      requiresConfirm: tool.requiresConfirm === true || skill.requiresConfirm === true,
    };
  });
}

/**
 * 解析本次请求应注入的插件技能工具。
 * - 指定 skillId：只注入该技能声明的工具（渐进披露，避免全量注入）；
 * - 未指定：保持旧行为，注入全部插件技能（但按 surface/role 过滤）。
 */
export function resolvePluginSkillTools(
  options: {
    surface?: SkillSurface;
    callerRole?: string;
    skillId?: string | null;
    lessonId?: string | null;
    classId?: string | null;
  } = {},
): SkillToolBinding[] {
  const { surface, callerRole, skillId, lessonId, classId } = options;
  const descriptors = collectSkillDescriptors({ surface, lessonId, classId });

  if (skillId) {
    const selected = descriptors.find((skill) => skill.id === skillId);
    if (!selected || !isSkillVisible(selected, surface, callerRole)) return [];
    return buildSkillToolBindings(selected);
  }

  return descriptors
    .filter((skill) => skill.source === 'plugin')
    .filter((skill) => {
      if (surface && !skill.surfaces.includes(surface)) return false;
      if (skill.roles) return !!callerRole && skill.roles.includes(callerRole as SkillRole);
      return callerRole !== 'student';
    })
    .flatMap((skill) => buildSkillToolBindings(skill));
}

/** 生成注入 system instruction 的技能段。 */
export function buildSkillInstructionBlock(skill: SkillDescriptor, lang: 'zh' | 'en'): string {
  const lines: string[] = [`[Skill · ${skill.name}]`];
  const instruction = (skill.instructions || skill.description || '').trim();
  if (instruction) lines.push(instruction);
  if (skill.outputKind === 'lesson_segments') {
    lines.push(
      lang === 'zh'
        ? '输出必须是一个 JSON 对象，形如 {"segments":[{"title":"...","duration":"10m","type":"intro|lecture|practice|summary"}]}，不要输出其他内容。'
        : 'Your output MUST be a single JSON object like {"segments":[{"title":"...","duration":"10m","type":"intro|lecture|practice|summary"}]} with no extra text.',
    );
  } else if (skill.outputKind === 'config_patch') {
    lines.push(
      lang === 'zh'
        ? `输出必须是一个 JSON 对象，形如 {"changes":{"modePacksEnabled":true}}；可用字段仅限：${CONFIG_PATCH_KEYS.join(', ')}。`
        : `Output MUST be a single JSON object like {"changes":{"modePacksEnabled":true}}. Allowed keys: ${CONFIG_PATCH_KEYS.join(', ')}.`,
    );
  } else if (skill.outputKind === 'classroom_card') {
    lines.push(
      lang === 'zh'
        ? '输出必须是一个 JSON 对象，形如 {"title":"...","body":"..."}，不要输出其他内容。'
        : 'Output MUST be a single JSON object like {"title":"...","body":"..."} with no extra text.',
    );
  }
  return lines.join('\n');
}

const stripCodeFence = (text: string): string =>
  text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

const extractJsonCandidate = (text: string): string | null => {
  const trimmed = stripCodeFence(text);
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return null;
};

const normalizeSegmentType = (value: unknown): LessonSegmentType => {
  const raw = asString(value);
  return raw === 'intro' || raw === 'lecture' || raw === 'practice' || raw === 'summary' ? raw : 'lecture';
};

const normalizeDuration = (value: unknown): string => {
  const raw = asString(value);
  if (!raw) return '15m';
  const match = raw.match(/^(\d{1,3})\s*(m|min|分钟)?$/i);
  if (!match) return '15m';
  return `${Math.min(180, Math.max(1, Number(match[1])))}m`;
};

/** 校验并裁剪模型产出的环节数组（不信任模型输出）。 */
export function normalizeLessonSegments(value: unknown): LessonSegmentDraft[] {
  if (!Array.isArray(value)) return [];
  const result: LessonSegmentDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const title = asString(entry.title);
    if (!title) continue;
    result.push({
      title: title.length > 80 ? `${title.slice(0, 80)}…` : title,
      duration: normalizeDuration(entry.duration),
      type: normalizeSegmentType(entry.type),
    });
    if (result.length >= MAX_SEGMENTS) break;
  }
  return result;
}

/** 校验模型给出的配置变更：只允许受控字段，值必须合法；整体非法时返回 null。 */
export function normalizeConfigPatch(value: unknown): ConfigPatchChanges | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = (value as Record<string, unknown>).changes ?? value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const changes: ConfigPatchChanges = {};
  for (const [key, raw] of Object.entries(source as Record<string, unknown>)) {
    if (!CONFIG_PATCH_KEY_SET.has(key)) continue;
    if (key === 'httpAccessLogMode') {
      if (raw === null) changes[key] = null;
      else if (raw === 'off' || raw === 'errors' || raw === 'all') changes[key] = raw;
      continue;
    }
    if (key === 'httpAccessLogIgnore') {
      if (raw === null) changes[key] = null;
      else if (typeof raw === 'string' && raw.length <= 1000) changes[key] = raw;
      continue;
    }
    if (key === 'httpSlowMs') {
      if (raw === null) changes[key] = null;
      else if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 50 && raw <= 60000) changes[key] = raw;
      continue;
    }
    if (raw === null || typeof raw === 'boolean') changes[key] = raw;
  }
  return changes;
}

/** 从模型文本中解析课堂卡片；解析失败时把整段文本作为正文。 */
export function parseClassroomCard(text: string): ClassroomCard {
  const candidate = extractJsonCandidate(text ?? '');
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const title = asString(parsed.title);
      const body = asString(parsed.body) ?? asString(parsed.content);
      if (title || body) {
        return {
          title: (title ?? '课堂小结').slice(0, 60),
          body: (body ?? '').slice(0, 2000),
        };
      }
    } catch {
      /* fall through */
    }
  }
  const cleaned = stripCodeFence(text ?? '').slice(0, 2000);
  const lines = cleaned.split('\n').filter((line) => line.trim().length > 0);
  return {
    title: (lines[0] ?? '课堂小结').replace(/^[#>*\-\s]+/, '').slice(0, 60),
    body: lines.slice(1).join('\n').slice(0, 2000) || cleaned.slice(0, 2000),
  };
}

/**
 * 从模型文本中解析技能产物。
 * 解析失败时按产物类型回退为安全的最小结果，保证前端始终有可预览内容。
 */
export function parseSkillArtifact(skill: SkillDescriptor, text: string): SkillArtifact | null {
  const raw = text ?? '';
  if (skill.outputKind === 'config_patch') {
    const candidate = extractJsonCandidate(raw);
    if (!candidate) return { kind: 'config_patch', changes: {} };
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      return { kind: 'config_patch', changes: normalizeConfigPatch(parsed) ?? {} };
    } catch {
      return { kind: 'config_patch', changes: {} };
    }
  }

  if (skill.outputKind === 'classroom_card') {
    return { kind: 'classroom_card', card: parseClassroomCard(raw) };
  }

  if (skill.outputKind !== 'lesson_segments') return null;

  const candidate = extractJsonCandidate(raw);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const segments = normalizeLessonSegments(Array.isArray(parsed) ? parsed : parsed.segments);
      if (segments.length > 0) return { kind: 'lesson_segments', segments };
    } catch {
      /* fall through to fallback */
    }
  }

  const firstLine = stripCodeFence(raw)
    .split('\n')
    .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
    .find((line) => line.length > 0);
  return {
    kind: 'lesson_segments',
    segments: [
      {
        title: firstLine ? firstLine.slice(0, 80) : 'AI 生成环节',
        duration: '15m',
        type: 'lecture',
      },
    ],
  };
}

/** 生成新的环节 ID（保留宿主既有 `seg-*` 风格）。 */
export const createLessonSegmentId = (): string => `seg-${crypto.randomUUID().slice(0, 8)}`;
