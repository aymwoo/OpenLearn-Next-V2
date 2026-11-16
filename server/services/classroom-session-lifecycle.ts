/**
 * 课次生命周期（Gitee IKVNIX）：结束本次课次、学生跳回、僵尸课次自动归档、
 * 未结束提示的忽略/延后偏好。
 *
 * 课次（classroom_sessions 一行）与课程/课节（lessons）解耦：
 * 讲完归档的是本次课次，课程整体不因此结束；未结束提示只看当前未归档课次。
 * 阶段枚举保持四阶段不变，ARCHIVED_REPORT → IN_CLASS_TEACHING 的 v0.6.1
 * 回退语义仍由 ClassroomRuntimeService.transitionStage 负责。
 */
import type Database from 'better-sqlite3';
import { ARCHIVED_REPORT_STAGE } from './classroom-runtime-service.js';

/** 默认自动归档阈值：24 小时（大于常见单次课时长，又不会让跨周僵尸课次一直挂着）。 */
export const DEFAULT_AUTO_ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
/** 阈值下限：3 小时，避免误伤仍在进行的长课时，并保护 findActiveLessonForStudent 实时录成绩。 */
export const MIN_AUTO_ARCHIVE_AFTER_MS = 3 * 60 * 60 * 1000;
/** 阈值上限：30 天，防止把开关设成「永不归档」。 */
export const MAX_AUTO_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const UNFINISHED_PROMPT_PREF_KEY = 'classroom.unfinished_prompt';

export type ClassroomSessionRow = {
  id: string;
  lesson_id: string;
  class_id: string | null;
  teacher_id?: string | null;
  stage: string;
  started_at?: number | null;
  ended_at?: number | null;
  created_at?: number | null;
  last_activity_at?: number | null;
  auto_archived_at?: number | null;
  auto_archive_exempt?: number | null;
  current_segment_id?: string | null;
  settings_json?: string | null;
  [key: string]: unknown;
};

export type CloseSessionSource = 'teacher' | 'auto';

export type CloseSessionResult = {
  sessionId: string;
  lessonId: string;
  classId: string | null;
  stage: string;
  endedAt: number;
  alreadyArchived: boolean;
  source: CloseSessionSource;
  autoArchivedAt: number | null;
};

export type UnfinishedPromptPref = {
  action: 'ignore' | 'snooze';
  sessionId: string;
  until?: number | null;
  updatedAt: number;
};

const STAGE_LABELS: Record<string, { zh: string; en: string }> = {
  PRE_CLASS_READY: { zh: '课前准备', en: 'Pre-class ready' },
  IN_CLASS_TEACHING: { zh: '课中授课', en: 'In class' },
  WRAP_UP_EXIT_TICKET: { zh: '结课通票', en: 'Wrap-up' },
  ARCHIVED_REPORT: { zh: '已归档', en: 'Archived' },
};

export function classroomStageLabel(stage: string | null | undefined, lang: 'zh' | 'en' = 'zh'): string {
  const key = String(stage || '');
  const labels = STAGE_LABELS[key];
  if (!labels) return key || (lang === 'zh' ? '未知阶段' : 'Unknown stage');
  return labels[lang];
}

export function isSessionResumable(stage: string | null | undefined): boolean {
  return Boolean(stage) && stage !== ARCHIVED_REPORT_STAGE;
}

export function studentPrefPrincipal(studentId: string): string {
  return `student:${studentId}`;
}

export function clampAutoArchiveAfterMs(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_AUTO_ARCHIVE_AFTER_MS;
  return Math.min(MAX_AUTO_ARCHIVE_AFTER_MS, Math.max(MIN_AUTO_ARCHIVE_AFTER_MS, Math.floor(raw)));
}

export function getAutoArchiveAfterMs(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT classroom_session_auto_archive_after_ms FROM site_settings WHERE id = ?')
      .get('global') as { classroom_session_auto_archive_after_ms?: number | null } | undefined;
    const value = row?.classroom_session_auto_archive_after_ms;
    if (value == null || !Number.isFinite(Number(value))) return DEFAULT_AUTO_ARCHIVE_AFTER_MS;
    return clampAutoArchiveAfterMs(Number(value));
  } catch {
    return DEFAULT_AUTO_ARCHIVE_AFTER_MS;
  }
}

export function setAutoArchiveAfterMs(db: Database.Database, ms: number): number {
  const value = clampAutoArchiveAfterMs(ms);
  db.prepare(
    `INSERT INTO site_settings (id, classroom_session_auto_archive_after_ms) VALUES ('global', ?)
     ON CONFLICT(id) DO UPDATE SET classroom_session_auto_archive_after_ms = excluded.classroom_session_auto_archive_after_ms`,
  ).run(value);
  return value;
}

/** 回写教师活动时间。列不存在（未迁库的精简测试 schema）时静默跳过。 */
export function touchSessionActivity(db: Database.Database, sessionId: string, now = Date.now()): void {
  if (!sessionId) return;
  try {
    db.prepare('UPDATE classroom_sessions SET last_activity_at = ? WHERE id = ?').run(now, sessionId);
  } catch {
    /* 列尚未迁移时忽略 */
  }
}

export function touchSessionActivityByLesson(db: Database.Database, lessonId: string, now = Date.now()): void {
  if (!lessonId) return;
  try {
    db.prepare(
      `UPDATE classroom_sessions
          SET last_activity_at = ?
        WHERE id = (
          SELECT id FROM classroom_sessions
           WHERE lesson_id = ? AND stage != ?
           ORDER BY created_at DESC LIMIT 1
        )`,
    ).run(now, lessonId, ARCHIVED_REPORT_STAGE);
  } catch {
    /* 列尚未迁移时忽略 */
  }
}

export function getLatestSessionForLesson(
  db: Database.Database,
  lessonId: string,
  opts?: { excludeArchived?: boolean },
): ClassroomSessionRow | null {
  const sql = opts?.excludeArchived
    ? 'SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1'
    : 'SELECT * FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1';
  const row = (
    opts?.excludeArchived ? db.prepare(sql).get(lessonId, ARCHIVED_REPORT_STAGE) : db.prepare(sql).get(lessonId)
  ) as ClassroomSessionRow | undefined;
  return row ?? null;
}

export function closeClassroomSession(
  db: Database.Database,
  session: ClassroomSessionRow,
  options?: { now?: number; source?: CloseSessionSource },
): CloseSessionResult {
  const now = options?.now ?? Date.now();
  const source = options?.source ?? 'teacher';
  const alreadyArchived = session.stage === ARCHIVED_REPORT_STAGE;
  const endedAt = Number(session.ended_at) || now;
  const autoArchivedAt = source === 'auto' ? now : (session.auto_archived_at ?? null);

  if (!alreadyArchived) {
    try {
      db.prepare(
        `UPDATE classroom_sessions
            SET stage = ?, ended_at = ?, auto_archived_at = ?, last_activity_at = ?
          WHERE id = ?`,
      ).run(ARCHIVED_REPORT_STAGE, endedAt, autoArchivedAt, now, session.id);
    } catch {
      // 未迁新列时退回原归档写法，保证老测试库仍能结束课次。
      db.prepare('UPDATE classroom_sessions SET stage = ?, ended_at = ? WHERE id = ?').run(
        ARCHIVED_REPORT_STAGE,
        endedAt,
        session.id,
      );
    }
  }

  return {
    sessionId: session.id,
    lessonId: session.lesson_id,
    classId: session.class_id ?? null,
    stage: ARCHIVED_REPORT_STAGE,
    endedAt,
    alreadyArchived,
    source,
    autoArchivedAt: alreadyArchived ? (session.auto_archived_at ?? null) : autoArchivedAt,
  };
}

function isExempt(session: ClassroomSessionRow): boolean {
  return Number(session.auto_archive_exempt) === 1;
}

/**
 * 扫描并归档长期无教师活动的僵尸课次。
 *
 * last_activity_at 为 NULL 的已部署行：只补写当前时间，不改 stage
 * （升级后不立即改变实际课堂状态；再经过一个阈值且仍无教师活动才归档）。
 */
export function archiveZombieSessions(db: Database.Database, now = Date.now()): CloseSessionResult[] {
  const threshold = getAutoArchiveAfterMs(db);
  let rows: ClassroomSessionRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM classroom_sessions
          WHERE stage != ?
            AND (auto_archive_exempt IS NULL OR auto_archive_exempt = 0)`,
      )
      .all(ARCHIVED_REPORT_STAGE) as ClassroomSessionRow[];
  } catch {
    return [];
  }

  const closed: CloseSessionResult[] = [];
  for (const session of rows) {
    if (isExempt(session)) continue;
    if (session.last_activity_at == null) {
      touchSessionActivity(db, session.id, now);
      continue;
    }
    if (now - Number(session.last_activity_at) >= threshold) {
      closed.push(closeClassroomSession(db, session, { now, source: 'auto' }));
    }
  }
  return closed;
}

export function setSessionAutoArchiveExempt(
  db: Database.Database,
  sessionId: string,
  exempt: boolean,
  now = Date.now(),
): boolean {
  try {
    const result = db
      .prepare('UPDATE classroom_sessions SET auto_archive_exempt = ?, last_activity_at = ? WHERE id = ?')
      .run(exempt ? 1 : 0, now, sessionId);
    return result.changes > 0;
  } catch {
    return false;
  }
}

export function readUnfinishedPromptPrefs(
  db: Database.Database,
  principalKey: string,
): Record<string, UnfinishedPromptPref> {
  try {
    const row = db
      .prepare('SELECT pref_value FROM user_preferences WHERE principal_key = ? AND pref_key = ?')
      .get(principalKey, UNFINISHED_PROMPT_PREF_KEY) as { pref_value: string } | undefined;
    if (!row?.pref_value) return {};
    const parsed = JSON.parse(row.pref_value) as { bySession?: Record<string, UnfinishedPromptPref> };
    return parsed?.bySession && typeof parsed.bySession === 'object' ? parsed.bySession : {};
  } catch {
    return {};
  }
}

export function writeUnfinishedPromptPref(
  db: Database.Database,
  principalKey: string,
  pref: UnfinishedPromptPref,
): UnfinishedPromptPref {
  const bySession = readUnfinishedPromptPrefs(db, principalKey);
  bySession[pref.sessionId] = pref;
  const now = pref.updatedAt;
  db.prepare(
    `INSERT INTO user_preferences (principal_key, pref_key, pref_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(principal_key, pref_key) DO UPDATE SET
       pref_value = excluded.pref_value,
       updated_at = excluded.updated_at`,
  ).run(principalKey, UNFINISHED_PROMPT_PREF_KEY, JSON.stringify({ bySession }), now);
  return pref;
}

export function resolvePromptVisibility(
  prefs: Record<string, UnfinishedPromptPref>,
  sessionId: string,
  now = Date.now(),
): { showBanner: boolean; ignored: boolean; snoozedUntil: number | null } {
  const pref = prefs[sessionId];
  if (!pref) return { showBanner: true, ignored: false, snoozedUntil: null };
  if (pref.action === 'ignore') return { showBanner: false, ignored: true, snoozedUntil: null };
  const until = typeof pref.until === 'number' ? pref.until : null;
  if (until != null && now < until) return { showBanner: false, ignored: false, snoozedUntil: until };
  return { showBanner: true, ignored: false, snoozedUntil: until };
}

/** 「延后到明天」：当前时刻起 24 小时，测试稳定且语义接近次日再提醒。 */
export function snoozeUntilTomorrow(now = Date.now()): number {
  return now + 24 * 60 * 60 * 1000;
}

export function buildSessionResumeFields(
  session: ClassroomSessionRow | null,
  lang: 'zh' | 'en' = 'zh',
): {
  stage: string;
  stageLabel: string;
  resumable: boolean;
  lastActivityAt: number | null;
  classId: string | null;
} {
  const stage = session?.stage || 'PRE_CLASS_READY';
  return {
    stage,
    stageLabel: classroomStageLabel(stage, lang),
    resumable: isSessionResumable(session?.stage),
    lastActivityAt: session?.last_activity_at ?? null,
    classId: session?.class_id ?? null,
  };
}
