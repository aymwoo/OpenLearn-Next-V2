/**
 * skill-store — Skill 运行时持久化（P1）。
 *
 * 只负责三张表：
 * - `skill_settings`：管理员启停与场景覆盖；
 * - `skill_runs`：运行审计（不保存完整产物）；
 * - `skill_config_rollbacks`：`config_patch` 应用前的旧值快照，用于回滚。
 *
 * 所有读写都做表缺失兜底：旧库在迁移完成前不应因管理端查询而启动失败。
 */

import crypto from 'node:crypto';
import { kernelContainer } from '../packages/core/kernel/index.js';
import type { SkillRole, SkillSurface } from './skill-registry.js';

export interface SkillSetting {
  enabled: boolean;
  surfaces?: SkillSurface[];
  updatedBy?: string;
  updatedAt?: number;
}

export interface SkillRunRecord {
  id: string;
  skillId: string;
  surface: SkillSurface;
  actorId?: string;
  scope?: Record<string, unknown> | null;
  status: 'running' | 'succeeded' | 'failed';
  artifactKind?: string | null;
  error?: string | null;
  createdAt: number;
  finishedAt?: number | null;
}

export interface ConfigRollbackRecord {
  id: string;
  runId: string;
  patch: Record<string, unknown>;
  previous: Record<string, unknown>;
  appliedBy?: string | null;
  createdAt: number;
  rolledBackAt?: number | null;
  rolledBackBy?: string | null;
}

export type SkillScopeType = 'global' | 'class' | 'lesson';

export interface SkillBinding {
  id: string;
  skillId: string;
  surface: SkillSurface;
  scopeType: SkillScopeType;
  scopeId: string;
  enabled: boolean;
  /** null / undefined = 跟随技能声明；数组 = 在该绑定内只允许这些角色（只可收窄） */
  roles?: SkillRole[] | null;
  updatedBy?: string | null;
  updatedAt: number;
}

const VALID_ROLES: readonly SkillRole[] = ['administrator', 'teacher', 'student'];

function parseBindingRoles(raw: unknown): SkillRole[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (item): item is SkillRole => typeof item === 'string' && (VALID_ROLES as readonly string[]).includes(item),
    );
  } catch {
    return null;
  }
}

const VALID_SURFACES: readonly SkillSurface[] = ['lesson_prep', 'admin_settings', 'classroom_live'];

function parseSurfaces(raw: unknown): SkillSurface[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const result = parsed.filter(
      (item): item is SkillSurface => typeof item === 'string' && (VALID_SURFACES as readonly string[]).includes(item),
    );
    return result.length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

/** 读取全部技能设置；表缺失时返回空 Map。 */
export function loadSkillSettings(): Map<string, SkillSetting> {
  const map = new Map<string, SkillSetting>();
  try {
    const rows = kernelContainer.db
      .prepare('SELECT skill_id, enabled, surfaces_json, updated_by, updated_at FROM skill_settings')
      .all() as Array<{
      skill_id: string;
      enabled: number;
      surfaces_json?: string | null;
      updated_by?: string | null;
      updated_at?: number | null;
    }>;
    for (const row of rows) {
      map.set(row.skill_id, {
        enabled: row.enabled !== 0,
        surfaces: parseSurfaces(row.surfaces_json),
        updatedBy: row.updated_by ?? undefined,
        updatedAt: row.updated_at ?? undefined,
      });
    }
  } catch {
    /* table may not exist before migration */
  }
  return map;
}

export function setSkillSetting(
  skillId: string,
  patch: { enabled?: boolean; surfaces?: SkillSurface[] | null },
  actorId?: string,
): SkillSetting {
  const current = loadSkillSettings().get(skillId);
  const enabled = patch.enabled ?? current?.enabled ?? true;
  const surfaces = patch.surfaces === undefined ? current?.surfaces : (patch.surfaces ?? undefined);
  const now = Date.now();

  try {
    kernelContainer.db
      .prepare(
        `INSERT INTO skill_settings (skill_id, enabled, surfaces_json, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(skill_id) DO UPDATE SET
           enabled = excluded.enabled,
           surfaces_json = excluded.surfaces_json,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        skillId,
        enabled ? 1 : 0,
        surfaces && surfaces.length > 0 ? JSON.stringify(surfaces) : null,
        actorId ?? null,
        now,
      );
  } catch (err) {
    throw new Error(
      `[SkillStore] failed to persist skill setting: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return { enabled, surfaces, updatedBy: actorId, updatedAt: now };
}

export function startSkillRun(params: {
  skillId: string;
  surface: SkillSurface;
  actorId?: string;
  scope?: Record<string, unknown> | null;
}): string {
  const id = `skillrun_${crypto.randomUUID()}`;
  try {
    kernelContainer.db
      .prepare(
        `INSERT INTO skill_runs (id, skill_id, surface, actor_id, scope_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(
        id,
        params.skillId,
        params.surface,
        params.actorId ?? null,
        params.scope ? JSON.stringify(params.scope) : null,
        Date.now(),
      );
  } catch {
    /* run audit is best-effort in P1 */
  }
  return id;
}

export function finishSkillRun(
  id: string,
  patch: { status: 'succeeded' | 'failed'; artifactKind?: string | null; error?: string | null },
): void {
  try {
    kernelContainer.db
      .prepare('UPDATE skill_runs SET status = ?, artifact_kind = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(patch.status, patch.artifactKind ?? null, patch.error ?? null, Date.now(), id);
  } catch {
    /* best-effort */
  }
}

export function listSkillRuns(limit = 50): SkillRunRecord[] {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit) || 50));
  try {
    const rows = kernelContainer.db
      .prepare(
        `SELECT id, skill_id, surface, actor_id, scope_json, status, artifact_kind, error, created_at, finished_at
         FROM skill_runs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(safeLimit) as Array<{
      id: string;
      skill_id: string;
      surface: string;
      actor_id?: string | null;
      scope_json?: string | null;
      status: string;
      artifact_kind?: string | null;
      error?: string | null;
      created_at: number;
      finished_at?: number | null;
    }>;
    return rows.map((row) => {
      let scope: Record<string, unknown> | null;
      try {
        scope = row.scope_json ? (JSON.parse(row.scope_json) as Record<string, unknown>) : null;
      } catch {
        scope = null;
      }
      return {
        id: row.id,
        skillId: row.skill_id,
        surface: row.surface as SkillSurface,
        actorId: row.actor_id ?? undefined,
        scope,
        status:
          row.status === 'succeeded' || row.status === 'failed' ? (row.status as 'succeeded' | 'failed') : 'running',
        artifactKind: row.artifact_kind ?? null,
        error: row.error ?? null,
        createdAt: row.created_at,
        finishedAt: row.finished_at ?? null,
      };
    });
  } catch {
    return [];
  }
}

export function saveConfigRollback(params: {
  runId: string;
  patch: Record<string, unknown>;
  previous: Record<string, unknown>;
  appliedBy?: string;
}): string {
  const id = `skillrb_${crypto.randomUUID()}`;
  kernelContainer.db
    .prepare(
      `INSERT INTO skill_config_rollbacks (id, run_id, patch_json, previous_json, applied_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      params.runId,
      JSON.stringify(params.patch),
      JSON.stringify(params.previous),
      params.appliedBy ?? null,
      Date.now(),
    );
  return id;
}

export function getConfigRollback(runId: string): ConfigRollbackRecord | null {
  try {
    const row = kernelContainer.db
      .prepare(
        `SELECT id, run_id, patch_json, previous_json, applied_by, created_at, rolled_back_at, rolled_back_by
         FROM skill_config_rollbacks WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as
      | {
          id: string;
          run_id: string;
          patch_json: string;
          previous_json: string;
          applied_by?: string | null;
          created_at: number;
          rolled_back_at?: number | null;
          rolled_back_by?: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      runId: row.run_id,
      patch: JSON.parse(row.patch_json) as Record<string, unknown>,
      previous: JSON.parse(row.previous_json) as Record<string, unknown>,
      appliedBy: row.applied_by ?? null,
      createdAt: row.created_at,
      rolledBackAt: row.rolled_back_at ?? null,
      rolledBackBy: row.rolled_back_by ?? null,
    };
  } catch {
    return null;
  }
}

export function markConfigRollbackApplied(runId: string, actorId?: string): void {
  try {
    kernelContainer.db
      .prepare('UPDATE skill_config_rollbacks SET rolled_back_at = ?, rolled_back_by = ? WHERE run_id = ?')
      .run(Date.now(), actorId ?? null, runId);
  } catch {
    /* best-effort */
  }
}

/* ── 细粒度绑定 ──────────────────────────────────────────────────────── */

export function loadSkillBindings(): SkillBinding[] {
  try {
    const rows = kernelContainer.db
      .prepare(
        `SELECT id, skill_id, surface, scope_type, scope_id, enabled, roles_json, updated_by, updated_at
         FROM skill_bindings`,
      )
      .all() as Array<{
      id: string;
      skill_id: string;
      surface: string;
      scope_type: string;
      scope_id: string;
      enabled: number;
      roles_json?: string | null;
      updated_by?: string | null;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      skillId: row.skill_id,
      surface: row.surface as SkillSurface,
      scopeType: row.scope_type as SkillScopeType,
      scopeId: row.scope_id,
      enabled: row.enabled !== 0,
      roles: parseBindingRoles(row.roles_json),
      updatedBy: row.updated_by ?? null,
      updatedAt: row.updated_at,
    }));
  } catch {
    return [];
  }
}

/** 解析最具体的绑定：lesson > class > global；没有绑定时返回 undefined。 */
export function resolveSkillBinding(
  bindings: SkillBinding[],
  args: { skillId: string; surface: SkillSurface; lessonId?: string | null; classId?: string | null },
): SkillBinding | undefined {
  const candidates = bindings.filter((binding) => binding.skillId === args.skillId && binding.surface === args.surface);
  if (args.lessonId) {
    const lesson = candidates.find((binding) => binding.scopeType === 'lesson' && binding.scopeId === args.lessonId);
    if (lesson) return lesson;
  }
  if (args.classId) {
    const cls = candidates.find((binding) => binding.scopeType === 'class' && binding.scopeId === args.classId);
    if (cls) return cls;
  }
  return candidates.find((binding) => binding.scopeType === 'global');
}

export function resolveBindingEnabled(
  bindings: SkillBinding[],
  args: { skillId: string; surface: SkillSurface; lessonId?: string | null; classId?: string | null },
): boolean | undefined {
  return resolveSkillBinding(bindings, args)?.enabled;
}

export function upsertSkillBinding(params: {
  skillId: string;
  surface: SkillSurface;
  scopeType: SkillScopeType;
  scopeId?: string;
  enabled: boolean;
  roles?: SkillRole[] | null;
  actorId?: string;
}): SkillBinding {
  const scopeId = params.scopeType === 'global' ? '' : (params.scopeId ?? '').trim();
  const id = `skillbind_${crypto.randomUUID()}`;
  const now = Date.now();
  const rolesJson =
    params.roles && params.roles.length > 0
      ? JSON.stringify(params.roles.filter((r) => VALID_ROLES.includes(r)))
      : null;
  kernelContainer.db
    .prepare(
      `INSERT INTO skill_bindings (id, skill_id, surface, scope_type, scope_id, enabled, roles_json, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(skill_id, surface, scope_type, scope_id) DO UPDATE SET
         enabled = excluded.enabled,
         roles_json = excluded.roles_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      params.skillId,
      params.surface,
      params.scopeType,
      scopeId,
      params.enabled ? 1 : 0,
      rolesJson,
      params.actorId ?? null,
      now,
    );
  const saved = kernelContainer.db
    .prepare(
      `SELECT id, skill_id, surface, scope_type, scope_id, enabled, roles_json, updated_by, updated_at
       FROM skill_bindings WHERE skill_id = ? AND surface = ? AND scope_type = ? AND scope_id = ?`,
    )
    .get(params.skillId, params.surface, params.scopeType, scopeId) as {
    id: string;
    skill_id: string;
    surface: string;
    scope_type: string;
    scope_id: string;
    enabled: number;
    roles_json?: string | null;
    updated_by?: string | null;
    updated_at: number;
  };
  return {
    id: saved.id,
    skillId: saved.skill_id,
    surface: saved.surface as SkillSurface,
    scopeType: saved.scope_type as SkillScopeType,
    scopeId: saved.scope_id,
    enabled: saved.enabled !== 0,
    roles: parseBindingRoles(saved.roles_json),
    updatedBy: saved.updated_by ?? null,
    updatedAt: saved.updated_at,
  };
}

export function deleteSkillBinding(params: {
  skillId: string;
  surface: SkillSurface;
  scopeType: SkillScopeType;
  scopeId?: string;
}): boolean {
  const scopeId = params.scopeType === 'global' ? '' : (params.scopeId ?? '').trim();
  const result = kernelContainer.db
    .prepare('DELETE FROM skill_bindings WHERE skill_id = ? AND surface = ? AND scope_type = ? AND scope_id = ?')
    .run(params.skillId, params.surface, params.scopeType, scopeId) as { changes?: number } | undefined;
  return (result?.changes ?? 0) > 0;
}
