/**
 * ai-persona-registry — AI Agent 角色模板注册表（可持久化、支持替换式 persona 与角色门禁）
 *
 * 来源（source）：
 * - 'builtin'：宿主内置 4 个种子模板（支持管理员调整配置，不可删除）
 * - 'admin'：管理后台创建的角色模板（持久化在 SQLite ai_personas 表）
 * - 'plugin'：第三方插件经 ctx.services.ai.registerAIPersona 或 manifest contributes['ai.persona.provider'] 注册（随插件停用清理）
 */

import crypto from 'node:crypto';
import { recordSecurityAudit } from '../packages/core/observability/audit-log.js';

export type AIPersonaRole = 'administrator' | 'teacher' | 'student';
export type AIPersonaSource = 'builtin' | 'plugin' | 'admin';

export interface AIPersonaToolPolicy {
  allow?: string[];
  deny?: string[];
}

export interface AIPersonaConfig {
  /** 角色唯一标识 */
  id: string;
  /** 角色名称（zh） */
  nameZh: string;
  /** 角色名称（en） */
  nameEn: string;
  /** 角色系统指令（zh） */
  instructionZh: string;
  /** 角色系统指令（en） */
  instructionEn: string;
  /** 展示图标（emoji 或 lucide 名称，可选） */
  icon?: string;
  /** overlay：叠加在宿主基础指令上；replace：替换角色人格（默认 'overlay'） */
  mode?: 'overlay' | 'replace';
  /** replace/overlay 时是否保留宿主基础指令（overlay 默认 'inherit'，replace 默认 'drop'） */
  basePolicy?: 'inherit' | 'drop';
  /** 允许使用该角色的用户角色列表；undefined 表示对所有已认证角色可见 */
  visibility?: AIPersonaRole[];
  /** 作为默认角色绑定的用户角色列表 */
  defaultForRole?: AIPersonaRole[];
  /** 工具访问策略（相对于 ActionRegistry/插件技能导出集合，只可收窄不可扩大） */
  toolPolicy?: AIPersonaToolPolicy;
  /** Agent 最大推理轮次（1..20，默认 5） */
  maxTurns?: number;
}

export interface AIPersona extends AIPersonaConfig {
  registeredBy?: string;
  source: AIPersonaSource;
  createdAt?: number;
  updatedAt?: number;
}

export class AdminPersonaError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdminPersonaError';
  }
}

interface DbLike {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): any;
    all(...params: unknown[]): any[];
  };
}

interface AiPersonaRow {
  id: string;
  source: string;
  plugin_id: string | null;
  name_zh: string;
  name_en: string;
  instruction_zh: string;
  instruction_en: string;
  icon: string | null;
  mode: string | null;
  base_policy: string | null;
  visibility_json: string | null;
  default_for_role_json: string | null;
  tool_policy_json: string | null;
  max_turns: number | null;
  created_at: number;
  updated_at: number;
}

const VALID_ROLES = new Set<AIPersonaRole>(['administrator', 'teacher', 'student']);
const PERSONA_ID_PATTERN = /^[a-zA-Z0-9._:-]{2,64}$/;
export const MAX_PERSONA_TURNS = 20;
export const DEFAULT_PERSONA_TURNS = 5;

const registry: { personas: Map<string, AIPersona> } = {
  personas: new Map(),
};

let boundDb: DbLike | null = null;

function hasAiPersonasTable(db: DbLike): boolean {
  try {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_personas'").get() as
      { name?: string } | undefined;
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function normalizeRoleList(input: unknown): AIPersonaRole[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const deduped: AIPersonaRole[] = [];
  for (const item of input) {
    if (
      typeof item === 'string' &&
      VALID_ROLES.has(item as AIPersonaRole) &&
      !deduped.includes(item as AIPersonaRole)
    ) {
      deduped.push(item as AIPersonaRole);
    }
  }
  return deduped;
}

function normalizePatternList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const result: string[] = [];
  for (const item of input) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && !result.includes(trimmed)) result.push(trimmed);
    }
  }
  return result;
}

function normalizeToolPolicy(input: unknown): AIPersonaToolPolicy | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const allow = normalizePatternList(raw.allow);
  const deny = normalizePatternList(raw.deny);
  if (allow === undefined && deny === undefined) return undefined;
  const policy: AIPersonaToolPolicy = {};
  if (allow !== undefined) policy.allow = allow;
  if (deny !== undefined) policy.deny = deny;
  return policy;
}

export function normalizePersonaConfig<T extends Partial<AIPersonaConfig>>(config: T): AIPersonaConfig {
  const mode: 'overlay' | 'replace' = config.mode === 'replace' ? 'replace' : 'overlay';
  const basePolicy: 'inherit' | 'drop' =
    config.basePolicy === 'drop' || config.basePolicy === 'inherit'
      ? config.basePolicy
      : mode === 'replace'
        ? 'drop'
        : 'inherit';
  const visibility = normalizeRoleList(config.visibility);
  const defaultForRole = normalizeRoleList(config.defaultForRole);
  const toolPolicy = normalizeToolPolicy(config.toolPolicy);
  const rawMaxTurns = config.maxTurns;
  const maxTurns =
    typeof rawMaxTurns === 'number' && Number.isFinite(rawMaxTurns)
      ? Math.min(MAX_PERSONA_TURNS, Math.max(1, Math.trunc(rawMaxTurns)))
      : undefined;

  return {
    id: String(config.id ?? '').trim(),
    nameZh: String(config.nameZh ?? '').trim(),
    nameEn: String(config.nameEn ?? '').trim(),
    instructionZh: typeof config.instructionZh === 'string' ? config.instructionZh : '',
    instructionEn: typeof config.instructionEn === 'string' ? config.instructionEn : '',
    icon: typeof config.icon === 'string' && config.icon.trim() ? config.icon.trim() : undefined,
    mode,
    basePolicy,
    ...(visibility !== undefined ? { visibility } : {}),
    ...(defaultForRole !== undefined ? { defaultForRole } : {}),
    ...(toolPolicy !== undefined ? { toolPolicy } : {}),
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  };
}

function computeInstructionDigest(persona: { instructionZh?: string; instructionEn?: string }): string {
  return crypto
    .createHash('sha256')
    .update(`${persona.instructionZh ?? ''}\n${persona.instructionEn ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

function getBuiltinSeeds(): AIPersona[] {
  const mk = (cfg: Omit<AIPersona, 'source'>): AIPersona => ({
    ...normalizePersonaConfig(cfg),
    source: 'builtin',
  });

  return [
    mk({
      id: 'socratic_questioner',
      nameZh: '苏格拉底追问者',
      nameEn: 'Socratic Questioner',
      instructionZh:
        '你现在切换为「苏格拉底追问者」角色：不直接给出答案，而是通过一连串有层次的追问引导学生自己发现结论。每次回复最多提出 1-2 个问题，聚焦学生表述中的模糊点或未经验证的假设。保持友善但坚持让学生自己推理。',
      instructionEn:
        'You are now in "Socratic Questioner" mode: never hand over the answer directly. Guide the student with layered follow-up questions, one or two at a time. Challenge assumptions kindly but firmly, and keep pushing the student to articulate their own reasoning.',
      icon: '🤔',
      mode: 'overlay',
      basePolicy: 'inherit',
    }),
    mk({
      id: 'debate_opponent',
      nameZh: '反方辩论助手',
      nameEn: 'Debate Opponent',
      instructionZh:
        '你现在切换为「反方辩论助手」角色：针对老师或学生提出的观点，始终站在反方立场给出有理有据的反驳，每次反驳控制在 3 句话以内，并在最后提出一个引导学生换位思考的问题。',
      instructionEn:
        'You are now in "Debate Opponent" mode: always argue from the opposing side with well-reasoned counterpoints (max 3 sentences), then end with one perspective-shifting question.',
      icon: '⚔️',
      mode: 'overlay',
      basePolicy: 'inherit',
    }),
    mk({
      id: 'historical_figure',
      nameZh: '历史名人模拟对话',
      nameEn: 'Historical Figure Roleplay',
      instructionZh:
        '你现在切换为「历史名人模拟对话」角色：根据对话中出现的历史人物名称，以该人物的第一人称视角、用语习惯与时代背景进行对话，对话中自然融入该时代的历史事实，并在结尾以人物口吻提出一个反思问题。',
      instructionEn:
        'You are in "Historical Figure" mode: adopt the first-person voice of the historical figure named in the conversation, weave period-accurate facts into the dialogue, and end with one reflective question in character.',
      icon: '🏛️',
      mode: 'overlay',
      basePolicy: 'inherit',
    }),
    mk({
      id: 'plain_assistant',
      nameZh: '普通助教（默认）',
      nameEn: 'Plain Assistant (Default)',
      instructionZh: '',
      instructionEn: '',
      icon: '🤖',
      mode: 'overlay',
      basePolicy: 'inherit',
    }),
  ];
}

function seedBuiltins(): void {
  for (const seed of getBuiltinSeeds()) {
    registry.personas.set(seed.id, seed);
  }
}

seedBuiltins();

function parseJsonSafe<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function rowToPersona(row: AiPersonaRow): AIPersona {
  const source: AIPersonaSource =
    row.source === 'builtin' || row.source === 'admin' || row.source === 'plugin' ? row.source : 'admin';
  const normalized = normalizePersonaConfig({
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    instructionZh: row.instruction_zh,
    instructionEn: row.instruction_en,
    icon: row.icon ?? undefined,
    mode: row.mode === 'replace' ? 'replace' : 'overlay',
    basePolicy: row.base_policy === 'drop' || row.base_policy === 'inherit' ? row.base_policy : undefined,
    visibility: parseJsonSafe<AIPersonaRole[]>(row.visibility_json),
    defaultForRole: parseJsonSafe<AIPersonaRole[]>(row.default_for_role_json),
    toolPolicy: parseJsonSafe<AIPersonaToolPolicy>(row.tool_policy_json),
    maxTurns: row.max_turns ?? undefined,
  });

  return {
    ...normalized,
    source,
    registeredBy: row.plugin_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function persistPersonaToDb(persona: AIPersona): void {
  if (!boundDb || !hasAiPersonasTable(boundDb)) return;
  const now = Date.now();
  const createdAt = persona.createdAt ?? now;
  const updatedAt = persona.updatedAt ?? now;
  boundDb
    .prepare(
      `INSERT INTO ai_personas (
        id, source, plugin_id, name_zh, name_en, instruction_zh, instruction_en,
        icon, mode, base_policy, visibility_json, default_for_role_json,
        tool_policy_json, max_turns, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source,
        plugin_id = excluded.plugin_id,
        name_zh = excluded.name_zh,
        name_en = excluded.name_en,
        instruction_zh = excluded.instruction_zh,
        instruction_en = excluded.instruction_en,
        icon = excluded.icon,
        mode = excluded.mode,
        base_policy = excluded.base_policy,
        visibility_json = excluded.visibility_json,
        default_for_role_json = excluded.default_for_role_json,
        tool_policy_json = excluded.tool_policy_json,
        max_turns = excluded.max_turns,
        updated_at = excluded.updated_at`,
    )
    .run(
      persona.id,
      persona.source,
      persona.registeredBy ?? null,
      persona.nameZh,
      persona.nameEn,
      persona.instructionZh,
      persona.instructionEn,
      persona.icon ?? null,
      persona.mode ?? 'overlay',
      persona.basePolicy ?? (persona.mode === 'replace' ? 'drop' : 'inherit'),
      persona.visibility !== undefined ? JSON.stringify(persona.visibility) : null,
      persona.defaultForRole !== undefined ? JSON.stringify(persona.defaultForRole) : null,
      persona.toolPolicy !== undefined ? JSON.stringify(persona.toolPolicy) : null,
      persona.maxTurns ?? null,
      createdAt,
      updatedAt,
    );
}

/**
 * 在服务器迁移完成后绑定 SQLite 数据库：
 * 1. 清理上次进程异常退出可能残留的 `source = 'plugin'` 孤儿行；
 * 2. 补齐缺失的内置种子行（INSERT OR IGNORE）；
 * 3. 从 `ai_personas` 加载全部 `builtin` 与 `admin` Persona（保留管理员持久化定制）。
 */
export function initAIPersonaPersistence(db: DbLike | null): void {
  boundDb = db;
  registry.personas.clear();
  seedBuiltins();

  if (!db || !hasAiPersonasTable(db)) return;

  db.prepare("DELETE FROM ai_personas WHERE source = 'plugin'").run();

  const now = Date.now();
  const insertIgnore = db.prepare(
    `INSERT OR IGNORE INTO ai_personas (
      id, source, plugin_id, name_zh, name_en, instruction_zh, instruction_en,
      icon, mode, base_policy, visibility_json, default_for_role_json,
      tool_policy_json, max_turns, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const seed of getBuiltinSeeds()) {
    insertIgnore.run(
      seed.id,
      'builtin',
      null,
      seed.nameZh,
      seed.nameEn,
      seed.instructionZh,
      seed.instructionEn,
      seed.icon ?? null,
      seed.mode ?? 'overlay',
      seed.basePolicy ?? 'inherit',
      null,
      null,
      null,
      null,
      now,
      now,
    );
  }

  const rows = db
    .prepare("SELECT * FROM ai_personas WHERE source IN ('builtin', 'admin') ORDER BY created_at ASC")
    .all() as AiPersonaRow[];
  for (const row of rows) {
    registry.personas.set(row.id, rowToPersona(row));
  }
}

/** 仅用于测试重置内存状态与 DB 绑定。 */
export function resetAIPersonaRegistryForTest(db: DbLike | null = null): void {
  boundDb = db;
  registry.personas.clear();
  seedBuiltins();
}

/** 注册角色模板（插件 or 宿主；插件不得覆盖 builtin 或 admin 持久化角色） */
export function registerAIPersona(
  config: Omit<AIPersona, 'source'> & { source?: AIPersonaSource },
  registeredBy?: string,
): void {
  const trimmedId = config?.id?.trim() ?? '';
  const allowsEmptyInstruction = trimmedId === 'plain_assistant';
  if (!trimmedId || (!allowsEmptyInstruction && !config.instructionZh?.trim())) {
    throw new Error('[AIPersonaRegistry] id and instructionZh are required');
  }

  const effectiveSource: AIPersonaSource = config.source ?? 'plugin';
  const effectiveOwner = registeredBy ?? config.registeredBy;
  const existing = registry.personas.get(trimmedId);

  if (effectiveSource === 'plugin' && existing) {
    if (existing.source === 'builtin' || existing.source === 'admin') {
      throw new Error(`[AIPersonaRegistry] Plugin cannot overwrite ${existing.source} persona "${trimmedId}"`);
    }
    if (
      existing.source === 'plugin' &&
      existing.registeredBy &&
      effectiveOwner &&
      existing.registeredBy !== effectiveOwner
    ) {
      throw new Error(`[AIPersonaRegistry] Persona "${trimmedId}" is already owned by another plugin`);
    }
  }

  const now = Date.now();
  const normalized = normalizePersonaConfig({ ...config, id: trimmedId });
  const persona: AIPersona = {
    ...normalized,
    nameZh: normalized.nameZh || trimmedId,
    nameEn: normalized.nameEn || normalized.nameZh || trimmedId,
    registeredBy: effectiveSource === 'plugin' ? effectiveOwner : undefined,
    source: effectiveSource,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  registry.personas.set(trimmedId, persona);
  persistPersonaToDb(persona);

  recordSecurityAudit('ai_persona.registered', {
    personaId: persona.id,
    source: persona.source,
    pluginId: persona.registeredBy ?? null,
    mode: persona.mode ?? 'overlay',
    basePolicy: persona.basePolicy ?? 'inherit',
    instructionHash: computeInstructionDigest(persona),
  });
}

/** 管理员创建或更新 Persona（持久化到 ai_personas 表） */
export function upsertAdminPersona(
  input: Partial<AIPersonaConfig>,
  options: { isUpdate?: boolean; actorId?: string } = {},
): AIPersona {
  const id = String(input.id ?? '').trim();
  if (!id || !PERSONA_ID_PATTERN.test(id)) {
    throw new AdminPersonaError(400, 'INVALID_PERSONA_ID', 'Persona id must be 2-64 characters of [a-zA-Z0-9._:-]');
  }

  const existing = registry.personas.get(id);
  if (!options.isUpdate && existing) {
    throw new AdminPersonaError(409, 'PERSONA_EXISTS', `Persona "${id}" already exists`);
  }
  if (options.isUpdate && !existing) {
    throw new AdminPersonaError(404, 'PERSONA_NOT_FOUND', `Persona "${id}" not found`);
  }
  if (options.isUpdate && existing?.source === 'plugin') {
    throw new AdminPersonaError(
      400,
      'PLUGIN_PERSONA_READONLY',
      'Plugin-managed personas cannot be overwritten by admin CRUD',
    );
  }

  const nameZh = String(input.nameZh ?? existing?.nameZh ?? '').trim();
  const nameEn = String(input.nameEn ?? existing?.nameEn ?? '').trim();
  const instructionZh = typeof input.instructionZh === 'string' ? input.instructionZh : (existing?.instructionZh ?? '');
  const instructionEn = typeof input.instructionEn === 'string' ? input.instructionEn : (existing?.instructionEn ?? '');

  if (!nameZh || !nameEn) {
    throw new AdminPersonaError(400, 'INVALID_PERSONA_NAME', 'nameZh and nameEn are required');
  }
  if (id !== 'plain_assistant' && (!instructionZh.trim() || !instructionEn.trim())) {
    throw new AdminPersonaError(400, 'INVALID_PERSONA_INSTRUCTION', 'instructionZh and instructionEn are required');
  }

  if (input.maxTurns !== undefined) {
    if (
      typeof input.maxTurns !== 'number' ||
      !Number.isFinite(input.maxTurns) ||
      input.maxTurns < 1 ||
      input.maxTurns > MAX_PERSONA_TURNS
    ) {
      throw new AdminPersonaError(
        400,
        'INVALID_MAX_TURNS',
        `maxTurns must be an integer between 1 and ${MAX_PERSONA_TURNS}`,
      );
    }
  }

  const targetSource: AIPersonaSource = existing?.source === 'builtin' ? 'builtin' : 'admin';
  const now = Date.now();
  const normalized = normalizePersonaConfig({
    id,
    nameZh,
    nameEn,
    instructionZh,
    instructionEn,
    icon: input.icon !== undefined ? input.icon : existing?.icon,
    mode: input.mode ?? existing?.mode,
    basePolicy: input.basePolicy ?? existing?.basePolicy,
    visibility: input.visibility !== undefined ? input.visibility : existing?.visibility,
    defaultForRole: input.defaultForRole !== undefined ? input.defaultForRole : existing?.defaultForRole,
    toolPolicy: input.toolPolicy !== undefined ? input.toolPolicy : existing?.toolPolicy,
    maxTurns: input.maxTurns !== undefined ? input.maxTurns : existing?.maxTurns,
  });

  const saved: AIPersona = {
    ...normalized,
    source: targetSource,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  registry.personas.set(id, saved);
  persistPersonaToDb(saved);

  recordSecurityAudit(options.isUpdate ? 'admin.ai_persona_update' : 'admin.ai_persona_create', {
    actorId: options.actorId ?? null,
    personaId: saved.id,
    source: saved.source,
    mode: saved.mode,
    instructionHash: computeInstructionDigest(saved),
  });

  return saved;
}

/** 管理员删除自定义 Persona（内置与插件托管不可通过此入口删除） */
export function deleteAdminPersona(id: string, actorId?: string): void {
  const existing = registry.personas.get(id);
  if (!existing) {
    throw new AdminPersonaError(404, 'PERSONA_NOT_FOUND', `Persona "${id}" not found`);
  }
  if (existing.source === 'builtin') {
    throw new AdminPersonaError(400, 'BUILTIN_PERSONA_PROTECTED', 'Built-in personas cannot be deleted');
  }
  if (existing.source === 'plugin') {
    throw new AdminPersonaError(400, 'PLUGIN_PERSONA_READONLY', 'Deactivate the owning plugin to remove its persona');
  }

  registry.personas.delete(id);
  if (boundDb && hasAiPersonasTable(boundDb)) {
    boundDb.prepare("DELETE FROM ai_personas WHERE id = ? AND source = 'admin'").run(id);
  }

  recordSecurityAudit('admin.ai_persona_delete', {
    actorId: actorId ?? null,
    personaId: id,
  });
}

export function getAIPersona(id: string | null | undefined): AIPersona | undefined {
  if (!id) return undefined;
  return registry.personas.get(id);
}

/** 判断某角色是否有权使用该 Persona */
export function isPersonaVisibleToRole(persona: Pick<AIPersona, 'visibility'>, callerRole?: string): boolean {
  if (persona.visibility === undefined) return true;
  if (!callerRole) return false;
  return persona.visibility.includes(callerRole as AIPersonaRole);
}

/** 列出 Persona：传入 role 时按 visibility 过滤；不传则返回全量 */
export function listAIPersonas(callerRole?: string): AIPersona[] {
  const all = Array.from(registry.personas.values());
  if (!callerRole) return all;
  return all.filter((p) => isPersonaVisibleToRole(p, callerRole));
}

/** 解析某角色的默认 Persona ID（优先匹配 defaultForRole，回退 plain_assistant 或首个可见项） */
export function getDefaultPersonaIdForRole(callerRole?: string): string | null {
  const visible = listAIPersonas(callerRole);
  if (visible.length === 0) return null;
  if (callerRole) {
    const matched = visible.find(
      (p) => Array.isArray(p.defaultForRole) && p.defaultForRole.includes(callerRole as AIPersonaRole),
    );
    if (matched) return matched.id;
  }
  const plain = visible.find((p) => p.id === 'plain_assistant');
  return plain ? plain.id : visible[0].id;
}

/** 注销插件注册的角色（builtin 与 admin 不可注销） */
export function unregisterAIPersona(id: string, registeredBy?: string): void {
  const persona = registry.personas.get(id);
  if (!persona || persona.source !== 'plugin') return;
  if (registeredBy && persona.registeredBy && persona.registeredBy !== registeredBy) return;
  registry.personas.delete(id);
  if (boundDb && hasAiPersonasTable(boundDb)) {
    boundDb.prepare("DELETE FROM ai_personas WHERE id = ? AND source = 'plugin'").run(id);
  }
}

/**
 * 服务器启动时接线：把角色注册表委托给 kernel AIService（插件经
 * ctx.services.ai.registerAIPersona 调用的真源落地在此）。
 */
export function bindAIPersonaRegistry(kernelAIService: {
  bindPersonaRegistry(delegates: {
    register: (persona: AIPersona) => void;
    list: () => AIPersona[];
    unregister: (id: string, registeredBy?: string) => void;
  }): void;
}): void {
  kernelAIService.bindPersonaRegistry({
    register: (persona) => registerAIPersona(persona, persona.registeredBy),
    list: () => listAIPersonas(),
    unregister: (id, registeredBy) => unregisterAIPersona(id, registeredBy),
  });
}
