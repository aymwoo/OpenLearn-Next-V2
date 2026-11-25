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

export type SkillSurface = 'lesson_prep' | 'admin_settings' | 'classroom_live';
export type SkillRole = 'administrator' | 'teacher' | 'student';
export type SkillSource = 'builtin' | 'plugin';
export type SkillLatencyClass = 'interactive' | 'background';
export type SkillOutputKind = 'lesson_segments';
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

export interface SkillArtifact {
  kind: 'lesson_segments';
  segments: LessonSegmentDraft[];
}

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
    if (tools.length === 0) continue;

    const name = asString(entry.name) ?? rawId;
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
      outputKind: entry.outputKind === 'lesson_segments' ? 'lesson_segments' : undefined,
      latencyClass: entry.latencyClass === 'background' ? 'background' : 'interactive',
      maxTurns: normalizeMaxTurns(entry.maxTurns),
      requiresConfirm: entry.requiresConfirm === true,
    });
  }
  return descriptors;
}

/** 读取全部 active 插件的 manifest 并解析技能（读失败时只返回内置技能）。 */
export function collectSkillDescriptors(): SkillDescriptor[] {
  const descriptors: SkillDescriptor[] = [...BUILTIN_SKILLS];
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
  return descriptors;
}

/** 纯函数：按场景 + 角色过滤。未声明 roles 的技能默认排除学生（SEC-01）。 */
export function isSkillVisible(skill: SkillDescriptor, surface?: SkillSurface, role?: string): boolean {
  if (surface && !skill.surfaces.includes(surface)) return false;
  if (skill.roles) return !!role && skill.roles.includes(role as SkillRole);
  return role !== 'student';
}

export function listSkillCatalog(options: { surface?: SkillSurface; role?: string } = {}): SkillDescriptor[] {
  return collectSkillDescriptors().filter((skill) => isSkillVisible(skill, options.surface, options.role));
}

export function getSkillDescriptor(id: string): SkillDescriptor | undefined {
  return collectSkillDescriptors().find((skill) => skill.id === id);
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
  } = {},
): SkillToolBinding[] {
  const { surface, callerRole, skillId } = options;
  const descriptors = collectSkillDescriptors();

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

/**
 * 从模型文本中解析技能产物。
 * 解析失败时回退为单个「AI 生成环节」，保证备课端始终有可预览、可插入的产物。
 */
export function parseSkillArtifact(skill: SkillDescriptor, text: string): SkillArtifact | null {
  if (skill.outputKind !== 'lesson_segments') return null;

  const candidate = extractJsonCandidate(text ?? '');
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const segments = normalizeLessonSegments(
        Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).segments,
      );
      if (segments.length > 0) return { kind: 'lesson_segments', segments };
    } catch {
      /* fall through to fallback */
    }
  }

  const firstLine = stripCodeFence(text ?? '')
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
