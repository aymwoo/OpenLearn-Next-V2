/**
 * showcase-work-service.ts — 课中大屏全班作业互评赏析统一数据聚合服务 (Issue #95)
 *
 * 聚合三个异构来源的随堂作品：
 *   1. `plugin_submissions` + `plugin_submission_versions`（课堂作业提交组件，带文件/文本/链接）
 *   2. `courseware_attempt` + `submission_result`（内嵌白板课件与交互作答）
 *   3. `assignment_submissions` + `plugin_assignments`（传统作业提交）
 *
 * 为大屏「互评赏析」（Spotlight / Peer Review Showcase）提供统一、强类型、带多模态文件与文本摘要的 ShowcaseWork 模型。
 */

import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export interface ShowcaseWorkFile {
  fileId?: string;
  name: string;
  mime?: string;
  url: string;
  size?: number;
}

export interface ShowcaseWork {
  workId: string;
  source: 'eval_submission' | 'courseware' | 'assignment' | string;
  sourceLabel: string;
  studentId: string;
  studentName: string;
  lessonId: string;
  sessionId?: string | null;
  title: string;
  contentKind: 'code' | 'text' | 'file' | 'image' | 'structured' | 'empty';
  text?: string | null;
  files?: ShowcaseWorkFile[];
  score?: number | null;
  completion?: number | null;
  submittedAt: number;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp'];
const CODE_EXTS = ['.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.json', '.c', '.cpp', '.java', '.sql', '.sh'];
const CODE_HINT = /\b(function|const|let|var|class|def|import|return|if|for|while|print|console)\b|[{};]\s*$/;

function inferContentKind(
  files: ShowcaseWorkFile[],
  text?: string | null,
): 'code' | 'text' | 'file' | 'image' | 'structured' | 'empty' {
  if (files && files.length > 0) {
    const hasImage = files.some((f) => {
      const lower = (f.name || '').toLowerCase();
      return (f.mime && f.mime.startsWith('image/')) || IMAGE_EXTS.some((ext) => lower.endsWith(ext));
    });
    if (hasImage) return 'image';

    const hasCodeFile = files.some((f) => {
      const lower = (f.name || '').toLowerCase();
      return CODE_EXTS.some((ext) => lower.endsWith(ext));
    });
    if (hasCodeFile) return 'code';

    return 'file';
  }

  if (typeof text === 'string' && text.trim().length > 0) {
    if (CODE_HINT.test(text)) return 'code';
    return 'text';
  }

  return 'empty';
}

/**
 * 查询指定课节 / 课堂会话下的全量统一作品池
 */
export function getUnifiedShowcaseWorks(
  db: Database.Database,
  lessonId: string,
  sessionId?: string | null,
  classId?: string | null,
): ShowcaseWork[] {
  const works: ShowcaseWork[] = [];
  const seenStudentIds = new Set<string>();

  // ── 1. 课堂作业提交组件 (plugin_submissions & plugin_submission_versions) ────────
  try {
    const evalRows = db
      .prepare(
        `SELECT ps.id as sub_id, ps.lesson_id, ps.student_id, ps.file_path, ps.version,
                ps.created_at, ps.updated_at,
                s.name as student_name,
                v.files_json, v.text_content, v.link_url, v.submitted_at
           FROM plugin_submissions ps
           LEFT JOIN students s ON ps.student_id = s.id
           LEFT JOIN plugin_submission_versions v ON v.submission_id = ps.id AND v.version = ps.version
          WHERE ps.lesson_id = ?
          ORDER BY ps.updated_at DESC`,
      )
      .all(lessonId) as any[];

    for (const r of evalRows) {
      if (!r.student_id || r.student_id === 'teacher' || r.student_id === 'guest') continue;

      let files: ShowcaseWorkFile[] = [];
      try {
        const parsed = JSON.parse(r.files_json || '[]');
        if (Array.isArray(parsed) && parsed.length > 0) {
          files = parsed.map((f: any) => ({
            fileId: f.fileId ?? f.id,
            name: f.name || f.filename || '作业附件',
            mime: f.mime || f.mimeType,
            url: f.url || (f.fileId ? `/api/assignments/files/${encodeURIComponent(f.fileId)}` : ''),
            size: f.size,
          }));
        }
      } catch {
        files = [];
      }

      // 兜底：若 files_json 为空但存在历史 file_path
      if (files.length === 0 && r.file_path) {
        const fileName = r.file_path.split('/').pop() || '作业附件';
        files.push({
          name: fileName,
          url: r.file_path.startsWith('/') ? r.file_path : `/${r.file_path}`,
        });
      }

      const text = r.text_content || null;
      const contentKind = inferContentKind(files, text);

      works.push({
        workId: `eval_${r.sub_id}`,
        source: 'plugin',
        sourceLabel: '插件作业',
        studentId: r.student_id,
        studentName: r.student_name || r.student_id,
        lessonId: r.lesson_id || lessonId,
        sessionId: sessionId || null,
        title: files.length > 0 ? files[0].name : '插件作业作答',
        contentKind,
        text,
        files: files.length > 0 ? files : undefined,
        score: null,
        completion: 1,
        submittedAt: r.submitted_at || r.updated_at || r.created_at || Date.now(),
      });
      seenStudentIds.add(r.student_id);
    }
  } catch (err) {
    // 表不存在或字段缺失降级
  }

  // ── 2. 课件作答 (courseware_attempt + submission_result) ─────────────────────────
  try {
    const coursewareIds: string[] = [];
    try {
      const els = db
        .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'html-applet'")
        .all(lessonId) as Array<{ data: string }>;
      for (const el of els) {
        try {
          const parsed = JSON.parse(el.data || '{}');
          const uuid = parsed?.coursewareUuid ?? parsed?.uuid;
          if (typeof uuid === 'string' && uuid.trim()) {
            const cw = db.prepare('SELECT id FROM courseware WHERE uuid = ?').get(uuid.trim()) as
              | { id: string }
              | undefined;
            if (cw?.id && !coursewareIds.includes(cw.id)) coursewareIds.push(cw.id);
          }
        } catch {}
      }
    } catch {}

    const classStudentIds = classId
      ? (
          db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as Array<{
            student_id: string;
          }>
        ).map((r) => r.student_id)
      : [];

    const buildQuery = (whereClause: string, params: unknown[]) =>
      db
        .prepare(
          `SELECT a.id as attemptId, a.student_id as studentId,
                  COALESCE(s.name, a.student_id) as studentName,
                  cw.name as coursewareName, r.score, r.completion,
                  COALESCE(a.finished_at, a.started_at) as submitted_at
             FROM courseware_attempt a
             JOIN courseware cw ON a.courseware_id = cw.id
             LEFT JOIN students s ON a.student_id = s.id
             LEFT JOIN submission_result r ON r.attempt_id = a.id
            WHERE a.student_id NOT IN ('teacher', 'guest', 'teacher_preview', '')
              AND (a.finished_at IS NOT NULL OR r.score IS NOT NULL)
              ${whereClause}
            ORDER BY COALESCE(r.score, 0) DESC`,
        )
        .all(...params) as any[];

    let attempts: any[] = [];
    let isClassFallback = false;
    if (coursewareIds.length > 0) {
      const placeholders = coursewareIds.map(() => '?').join(',');
      attempts = buildQuery(`AND a.courseware_id IN (${placeholders})`, coursewareIds);
    }
    if (attempts.length === 0 && classStudentIds.length > 0) {
      const placeholders = classStudentIds.map(() => '?').join(',');
      attempts = buildQuery(`AND a.student_id IN (${placeholders})`, classStudentIds);
      if (attempts.length > 0) {
        isClassFallback = true;
      }
    }

    for (const a of attempts) {
      works.push({
        workId: `cw_${a.attemptId}`,
        source: 'courseware',
        sourceLabel: '课件作答',
        studentId: a.studentId,
        studentName: a.studentName,
        lessonId,
        sessionId: sessionId || null,
        title: a.coursewareName || '课件互动作品',
        contentKind: 'structured',
        score: typeof a.score === 'number' ? a.score : null,
        completion: typeof a.completion === 'number' ? a.completion : null,
        submittedAt: Number(a.submitted_at) || Date.now(),
      });
    }
  } catch (err) {
    // 课件作答查询异常降级
  }

  // ── 3. 传统作业提交 (assignment_submissions & assignments / plugin_assignments) ───────────────
  try {
    let assignmentRows: any[] = [];
    try {
      assignmentRows = db
        .prepare(
          `SELECT sub.assignment_id, sub.student_id, sub.content, sub.score, sub.submitted_at,
                  COALESCE(s.name, sub.student_id) as student_name, a.title as assignment_title
             FROM assignment_submissions sub
             JOIN assignments a ON sub.assignment_id = a.id
             LEFT JOIN students s ON sub.student_id = s.id
            WHERE a.lesson_id = ? ${classId ? 'OR a.class_id = ?' : ''}
            ORDER BY sub.submitted_at DESC`,
        )
        .all(...(classId ? [lessonId, classId] : [lessonId])) as any[];
    } catch {
      // 降级支持 plugin_assignments
      try {
        assignmentRows = db
          .prepare(
            `SELECT sub.assignment_id, sub.student_id, sub.content, sub.score, sub.submitted_at,
                    COALESCE(s.name, sub.student_id) as student_name, pa.title as assignment_title
               FROM assignment_submissions sub
               JOIN plugin_assignments pa ON sub.assignment_id = pa.id
               LEFT JOIN students s ON sub.student_id = s.id
              WHERE pa.lesson_id = ?
              ORDER BY sub.submitted_at DESC`,
          )
          .all(lessonId) as any[];
      } catch {}
    }

    for (const r of assignmentRows) {
      if (!r.student_id || r.student_id === 'teacher' || r.student_id === 'guest') continue;

      const text = typeof r.content === 'string' ? r.content : null;
      const contentKind = inferContentKind([], text);

      works.push({
        workId: `assign_${r.assignment_id}_${r.student_id}`,
        source: 'assignment',
        sourceLabel: '课堂作业',
        studentId: r.student_id,
        studentName: r.student_name || r.student_id,
        lessonId,
        sessionId: sessionId || null,
        title: r.assignment_title || '作业提交',
        contentKind,
        text,
        score: typeof r.score === 'number' ? r.score : null,
        completion: 1,
        submittedAt: Number(r.submitted_at) || Date.now(),
      });
    }
  } catch (err) {
    // assignment 表查询异常降级
  }

  return works;
}

export function getUnifiedShowcaseWorksResult(
  db: Database.Database,
  lessonId: string,
  sessionId?: string | null,
  classId?: string | null,
): { works: ShowcaseWork[]; scope: 'lesson' | 'class' } {
  // 检查白板上是否存在属于当前课节的 html-applet 课件
  let hasLessonCourseware = false;
  try {
    const els = db
      .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'html-applet'")
      .all(lessonId) as Array<{ data: string }>;
    for (const el of els) {
      const parsed = JSON.parse(el.data || '{}');
      if (parsed?.coursewareUuid || parsed?.uuid) {
        hasLessonCourseware = true;
        break;
      }
    }
  } catch {}

  const works = getUnifiedShowcaseWorks(db, lessonId, sessionId, classId);
  const scope: 'lesson' | 'class' = hasLessonCourseware ? 'lesson' : 'class';
  return { works, scope };
}

export class ShowcaseWorkService {
  constructor(private db: Database.Database = kernelContainer.db) {}

  public getWorks(lessonId: string, sessionId?: string | null, classId?: string | null): ShowcaseWork[] {
    return getUnifiedShowcaseWorks(this.db, lessonId, sessionId, classId);
  }

  public getWorksResult(
    lessonId: string,
    sessionId?: string | null,
    classId?: string | null,
  ): { works: ShowcaseWork[]; scope: 'lesson' | 'class' } {
    return getUnifiedShowcaseWorksResult(this.db, lessonId, sessionId, classId);
  }
}
