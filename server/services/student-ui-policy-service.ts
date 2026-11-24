/**
 * 学生端界面可见性策略的持久化与解析（Gitee Issue IKW5KV）。
 *
 * 策略分三层：教师全局（teacher）→ 班级（class）→ 课节（lesson）。
 * 每层只保存教师显式设置项；学生看到的最终结果由共享契约
 * `packages/core/student-ui-policy` 统一解析，前端只消费结果。
 */
import {
  EMPTY_STUDENT_UI_POLICY_LAYER,
  parseStoredStudentUiPolicy,
  resolveEffectiveStudentUiPolicy,
  type EffectiveStudentUiPolicy,
  type StudentUiPolicyLayer,
  type StudentUiPolicyLayerWithSource,
  type StudentUiScopeType,
} from '../../packages/core/student-ui-policy/index.js';
import { randomId } from '../utils/id.js';

export interface StudentUiPolicyDbLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

export interface StoredStudentUiPolicyRow {
  id: string;
  scope_type: StudentUiScopeType;
  scope_id: string;
  policy_json: string;
  updated_by: string | null;
  updated_at: number;
}

export interface StoredStudentUiPolicy {
  scopeType: StudentUiScopeType;
  scopeId: string;
  policy: StudentUiPolicyLayer;
  updatedBy: string | null;
  updatedAt: number;
}

export class StudentUiPolicyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'StudentUiPolicyError';
    this.status = status;
  }
}

function isScopeType(value: unknown): value is StudentUiScopeType {
  return value === 'teacher' || value === 'class' || value === 'lesson';
}

export function assertStudentUiScope(
  scopeType: unknown,
  scopeId: unknown,
): { scopeType: StudentUiScopeType; scopeId: string } {
  if (!isScopeType(scopeType)) {
    throw new StudentUiPolicyError('scopeType 必须是 teacher / class / lesson');
  }
  if (typeof scopeId !== 'string' || !scopeId.trim()) {
    throw new StudentUiPolicyError('scopeId 不能为空');
  }
  return { scopeType, scopeId: scopeId.trim() };
}

export function loadStoredStudentUiPolicy(
  db: StudentUiPolicyDbLike,
  scopeType: StudentUiScopeType,
  scopeId: string,
): StoredStudentUiPolicy | null {
  const row = db
    .prepare('SELECT * FROM student_ui_policies WHERE scope_type = ? AND scope_id = ?')
    .get(scopeType, scopeId) as StoredStudentUiPolicyRow | undefined;
  if (!row) return null;
  return {
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    policy: parseStoredStudentUiPolicy(row.policy_json),
    updatedBy: row.updated_by ?? null,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function upsertStudentUiPolicy(
  db: StudentUiPolicyDbLike,
  input: {
    scopeType: StudentUiScopeType;
    scopeId: string;
    policy: StudentUiPolicyLayer;
    updatedBy?: string | null;
  },
): StoredStudentUiPolicy {
  const scopeType = input.scopeType;
  const scopeId = input.scopeId;
  const now = Date.now();
  const document = { version: 1 as const, ...input.policy };
  db.prepare(
    `INSERT INTO student_ui_policies (id, scope_type, scope_id, policy_json, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope_type, scope_id) DO UPDATE SET
       policy_json = excluded.policy_json,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).run(randomId('sup_'), scopeType, scopeId, JSON.stringify(document), input.updatedBy ?? null, now);
  return {
    scopeType,
    scopeId,
    policy: input.policy,
    updatedBy: input.updatedBy ?? null,
    updatedAt: now,
  };
}

export function deleteStudentUiPolicy(
  db: StudentUiPolicyDbLike,
  scopeType: StudentUiScopeType,
  scopeId: string,
): boolean {
  const result = db
    .prepare('DELETE FROM student_ui_policies WHERE scope_type = ? AND scope_id = ?')
    .run(scopeType, scopeId) as { changes?: number } | undefined;
  return (result?.changes ?? 0) > 0;
}

interface StudentClassRef {
  id: string;
  owner_user_id: string | null;
}

function loadStudentClasses(db: StudentUiPolicyDbLike, studentId: string): StudentClassRef[] {
  return db
    .prepare(
      `SELECT c.id, c.owner_user_id
         FROM classes c
         JOIN class_students cs ON c.id = cs.class_id
        WHERE cs.student_id = ?`,
    )
    .all(studentId) as StudentClassRef[];
}

function loadLessonLinkedClassIds(db: StudentUiPolicyDbLike, lessonId: string): string[] {
  const rows = db
    .prepare(
      `SELECT class_id FROM schedules WHERE lesson_id = ? AND class_id IS NOT NULL
       UNION SELECT class_id FROM classroom_sessions WHERE lesson_id = ? AND class_id IS NOT NULL
       UNION SELECT class_id FROM assignments WHERE lesson_id = ? AND class_id IS NOT NULL`,
    )
    .all(lessonId, lessonId, lessonId) as Array<{ class_id: string }>;
  return Array.from(new Set(rows.map((row) => row.class_id).filter(Boolean)));
}

function loadLessonClassOwner(db: StudentUiPolicyDbLike, classId: string): string | null {
  const row = db.prepare('SELECT owner_user_id FROM classes WHERE id = ?').get(classId) as
    { owner_user_id: string | null } | undefined;
  return row?.owner_user_id ?? null;
}

function layerFor(
  db: StudentUiPolicyDbLike,
  scopeType: StudentUiScopeType,
  scopeId: string,
): StudentUiPolicyLayerWithSource | null {
  const stored = loadStoredStudentUiPolicy(db, scopeType, scopeId);
  if (!stored) return null;
  return { source: scopeType, policy: stored.policy };
}

function revisionOf(rows: StoredStudentUiPolicy[]): string {
  if (rows.length === 0) return '0:0';
  const maxUpdatedAt = Math.max(...rows.map((row) => row.updatedAt));
  return `${maxUpdatedAt}:${rows.length}`;
}

export interface ResolvedStudentUiPolicy {
  policy: EffectiveStudentUiPolicy;
  applied: {
    lessonId: string | null;
    classIds: string[];
    teacherIds: string[];
  };
}

/**
 * 解析某个学生当前生效的策略。
 *
 * - 存在进行中课节时，只让该课节所属班级参与班级层解析，避免多班交集把
 *   正常班级的显示项误关。
 * - 若课节绑定班级但学生不在其中，直接忽略课节策略（路由层已鉴权，这里做
 *   纵深防御）。
 */
export function resolveStudentUiPolicy(
  db: StudentUiPolicyDbLike,
  input: { studentId: string; lessonId?: string | null },
): ResolvedStudentUiPolicy {
  const studentClasses = loadStudentClasses(db, input.studentId);
  const studentClassIds = new Set(studentClasses.map((row) => row.id));

  let effectiveClassIds = studentClasses.map((row) => row.id);
  let lessonLayer: StudentUiPolicyLayerWithSource | null = null;

  if (input.lessonId) {
    const lessonClassIds = loadLessonLinkedClassIds(db, input.lessonId);
    const shared = lessonClassIds.filter((id) => studentClassIds.has(id));
    if (lessonClassIds.length > 0 && shared.length === 0) {
      // 学生不在该课节关联班级：不应用课节策略，也不改变班级层。
      lessonLayer = null;
    } else {
      if (shared.length > 0) effectiveClassIds = shared;
      lessonLayer = layerFor(db, 'lesson', input.lessonId);
    }
  }

  const ownerIds = Array.from(
    new Set(
      effectiveClassIds
        .map((classId) => studentClasses.find((row) => row.id === classId)?.owner_user_id)
        .filter((value): value is string => !!value),
    ),
  );

  const layers: StudentUiPolicyLayerWithSource[] = [];
  const revisionRows: StoredStudentUiPolicy[] = [];

  for (const teacherId of ownerIds) {
    const stored = loadStoredStudentUiPolicy(db, 'teacher', teacherId);
    if (stored) {
      layers.push({ source: 'teacher', policy: stored.policy });
      revisionRows.push(stored);
    }
  }
  for (const classId of effectiveClassIds) {
    const stored = loadStoredStudentUiPolicy(db, 'class', classId);
    if (stored) {
      layers.push({ source: 'class', policy: stored.policy });
      revisionRows.push(stored);
    }
  }
  if (lessonLayer) {
    const stored = loadStoredStudentUiPolicy(db, 'lesson', input.lessonId!);
    if (stored) revisionRows.push(stored);
    layers.push(lessonLayer);
  }

  return {
    policy: resolveEffectiveStudentUiPolicy(layers, revisionOf(revisionRows)),
    applied: {
      lessonId: input.lessonId ?? null,
      classIds: effectiveClassIds,
      teacherIds: ownerIds,
    },
  };
}

export interface StudentUiPolicyChain {
  stored: StoredStudentUiPolicy | null;
  inherited: EffectiveStudentUiPolicy;
  effective: EffectiveStudentUiPolicy;
}

/**
 * 教师端编辑器的读取入口：返回本层已存设置、继承结果和最终生效结果。
 */
export function resolveStudentUiPolicyChain(
  db: StudentUiPolicyDbLike,
  input: { scopeType: StudentUiScopeType; scopeId: string },
): StudentUiPolicyChain {
  const stored = loadStoredStudentUiPolicy(db, input.scopeType, input.scopeId);

  const inheritedLayers: StudentUiPolicyLayerWithSource[] = [];
  const revisionRows: StoredStudentUiPolicy[] = [];

  const pushLayer = (scopeType: StudentUiScopeType, scopeId: string) => {
    if (input.scopeType === scopeType && input.scopeId === scopeId) return;
    const row = loadStoredStudentUiPolicy(db, scopeType, scopeId);
    if (!row) return;
    inheritedLayers.push({ source: scopeType, policy: row.policy });
    revisionRows.push(row);
  };

  if (input.scopeType === 'class') {
    const ownerId = loadLessonClassOwner(db, input.scopeId);
    if (ownerId) pushLayer('teacher', ownerId);
  } else if (input.scopeType === 'lesson') {
    const classIds = loadLessonLinkedClassIds(db, input.scopeId);
    for (const classId of classIds) {
      const ownerId = loadLessonClassOwner(db, classId);
      if (ownerId) pushLayer('teacher', ownerId);
      pushLayer('class', classId);
    }
  } else {
    // teacher：没有更高层可继承。
  }

  const inheritedRevision = revisionOf(dedupeRows(revisionRows));
  if (stored) revisionRows.push(stored);

  const effectiveLayers = [...inheritedLayers];
  if (stored) effectiveLayers.push({ source: input.scopeType, policy: stored.policy });

  return {
    stored,
    inherited: resolveEffectiveStudentUiPolicy(inheritedLayers, inheritedRevision),
    effective: resolveEffectiveStudentUiPolicy(effectiveLayers, revisionOf(dedupeRows(revisionRows))),
  };
}

function dedupeRows(rows: StoredStudentUiPolicy[]): StoredStudentUiPolicy[] {
  const seen = new Set<string>();
  const out: StoredStudentUiPolicy[] = [];
  for (const row of rows) {
    const key = `${row.scopeType}:${row.scopeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function emptyStudentUiPolicyLayer(): StudentUiPolicyLayer {
  return { ...EMPTY_STUDENT_UI_POLICY_LAYER, features: {} };
}
