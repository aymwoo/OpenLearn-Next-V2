/**
 * 存量测评数据导入（Issue #185）。
 *
 * 把两条「事实上的测评」旧路径收敛到新模型：
 * - 白板 quiz 图元（whiteboard_elements.type = 'quiz'）
 * - 预置投票 lesson_preset_polls（仅有正确答案的条目）
 *
 * 原则：
 * - **只读旧表**：不修改、不删除任何 legacy 数据；旧接口继续可用（平行视图）。
 * - **幂等**：以 assessments.settings_json.legacy.sourceId 为标记，二次执行为空操作。
 * - **可溯源**：settings_json.legacy = { source, sourceId, lessonId }。
 * - **失败可重试**：单条解析失败只记入 skipped 报告，不中断整批。
 */
import type Database from 'better-sqlite3';
import crypto from 'node:crypto';

export interface LegacyImportReport {
  created: {
    assessments: number;
    items: number;
    assignments: number;
    attempts: number;
    answers: number;
  };
  skipped: Array<{ source: string; sourceId: string; reason: string }>;
}

interface LegacyQuizData {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  points?: unknown;
}

/** 读取某条 legacy 标记是否已导入。 */
function alreadyImported(db: Database.Database, source: string, sourceId: string): boolean {
  const row = db
    .prepare(
      "SELECT id FROM assessments WHERE json_extract(settings_json, '$.legacy.source') = ? AND json_extract(settings_json, '$.legacy.sourceId') = ? LIMIT 1",
    )
    .get(source, sourceId) as { id: string } | undefined;
  return Boolean(row);
}

function parseOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options = raw.map((o) => String(o ?? '').trim());
  if (options.length < 2 || options.some((o) => o.length === 0)) return null;
  return options;
}

/**
 * 执行导入。
 * @param db 目标库
 * @param options.dryRun 只统计不写入
 */
export function importLegacyAssessments(
  db: Database.Database,
  options: { dryRun?: boolean; now?: () => number } = {},
): LegacyImportReport {
  const now = options.now ?? (() => Date.now());
  const dryRun = Boolean(options.dryRun);
  const report: LegacyImportReport = {
    created: { assessments: 0, items: 0, assignments: 0, attempts: 0, answers: 0 },
    skipped: [],
  };

  const insertAssessment = db.prepare(
    "INSERT INTO assessments (id, kind, title, description, owner_id, settings_json, status, academic_year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)",
  );
  const insertItem = db.prepare(
    "INSERT INTO assessment_items (id, assessment_id, bank_item_id, section, sort_order, type, stem, config_json, answer_key_json, max_score) VALUES (?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?)",
  );
  const insertAssignment = db.prepare(
    "INSERT INTO assessment_assignments (id, assessment_id, class_id, lesson_id, schedule_id, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
  );
  const insertAttempt = db.prepare(
    "INSERT INTO assessment_attempts (id, assignment_id, student_id, anon_key, attempt_no, status, started_at, submitted_at, deadline_at, score, max_score, needs_manual_review, proctor_json) VALUES (?, ?, ?, NULL, 1, 'submitted', ?, ?, NULL, ?, ?, 0, '{}')",
  );
  const insertAnswer = db.prepare(
    "INSERT INTO assessment_answers (attempt_id, item_id, answer_json, score, max_score, is_correct, grader, feedback, graded_by, graded_at, manual_override, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'auto', NULL, NULL, ?, 0, ?)",
  );

  /** 处理单条来源；返回是否创建。 */
  const importOne = (input: {
    source: string;
    sourceId: string;
    lessonId: string;
    title: string;
    options: string[];
    correctIndex: number;
    maxScore: number;
    ownerId: string;
    attempts?: Array<{ studentId: string; answer: unknown; score: number; isCorrect: boolean | null; submittedAt: number }>;
  }): boolean => {
    if (alreadyImported(db, input.source, input.sourceId)) {
      report.skipped.push({ source: input.source, sourceId: input.sourceId, reason: 'already_imported' });
      return false;
    }
    if (dryRun) {
      report.created.assessments += 1;
      report.created.items += 1;
      return true;
    }

    const ts = now();
    const assessmentId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const settings = JSON.stringify({
      legacy: { source: input.source, sourceId: input.sourceId, lessonId: input.lessonId },
    });
    insertAssessment.run(assessmentId, 'quiz', input.title, '旧数据导入（Issue #185）', input.ownerId, settings, ts, ts);
    report.created.assessments += 1;

    insertItem.run(
      itemId,
      assessmentId,
      'single_choice',
      input.title,
      JSON.stringify({ options: input.options }),
      JSON.stringify({ index: input.correctIndex }),
      input.maxScore,
    );
    report.created.items += 1;

    // 有排课才有班级归属：据此发布 assignment 并导入历史作答
    const schedule = db
      .prepare('SELECT id, class_id FROM schedules WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(input.lessonId) as { id: string; class_id: string } | undefined;
    if (!schedule) return true;

    const assignmentId = crypto.randomUUID();
    insertAssignment.run(assignmentId, assessmentId, schedule.class_id, input.lessonId, schedule.id, input.ownerId, ts);
    db.prepare("UPDATE assessments SET status = 'published', updated_at = ? WHERE id = ?").run(ts, assessmentId);
    report.created.assignments += 1;

    for (const attempt of input.attempts ?? []) {
      const attemptId = crypto.randomUUID();
      insertAttempt.run(
        attemptId,
        assignmentId,
        attempt.studentId,
        attempt.submittedAt,
        attempt.submittedAt,
        attempt.score,
        input.maxScore,
      );
      report.created.attempts += 1;
      insertAnswer.run(
        attemptId,
        itemId,
        JSON.stringify(attempt.answer ?? null),
        attempt.score,
        input.maxScore,
        attempt.isCorrect === null ? null : attempt.isCorrect ? 1 : 0,
        attempt.submittedAt,
        attempt.submittedAt,
      );
      report.created.answers += 1;
    }
    return true;
  };

  // ── 1. 白板 quiz 图元 ────────────────────────────────────────────────
  const quizElements = db
    .prepare("SELECT id, lesson_id, data FROM whiteboard_elements WHERE type = 'quiz'")
    .all() as Array<{ id: string; lesson_id: string; data: string }>;
  for (const element of quizElements) {
    let data: LegacyQuizData;
    try {
      data = JSON.parse(element.data);
    } catch {
      report.skipped.push({ source: 'whiteboard_quiz', sourceId: element.id, reason: 'invalid_json' });
      continue;
    }
    const question = typeof data.question === 'string' ? data.question.trim() : '';
    const options = parseOptions(data.options);
    const correctIndex = Number(data.correctIndex);
    if (!question || !options || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      report.skipped.push({ source: 'whiteboard_quiz', sourceId: element.id, reason: 'invalid_quiz_shape' });
      continue;
    }
    const lesson = db.prepare('SELECT creator_id FROM lessons WHERE id = ?').get(element.lesson_id) as
      | { creator_id: string | null }
      | undefined;
    const submissions = db
      .prepare(
        'SELECT student_id, answer, score, is_correct, submitted_at FROM lesson_quiz_submissions WHERE lesson_id = ? AND element_id = ?',
      )
      .all(element.lesson_id, element.id) as Array<{
      student_id: string;
      answer: string;
      score: number | null;
      is_correct: number | null;
      submitted_at: number;
    }>;
    importOne({
      source: 'whiteboard_quiz',
      sourceId: element.id,
      lessonId: element.lesson_id,
      title: question.slice(0, 120),
      options,
      correctIndex,
      maxScore: Number(data.points) > 0 ? Number(data.points) : 1,
      ownerId: lesson?.creator_id ?? 'system',
      attempts: submissions.map((s) => ({
        studentId: s.student_id,
        answer: s.answer,
        score: typeof s.score === 'number' ? s.score : 0,
        isCorrect: s.is_correct === null ? null : s.is_correct === 1,
        submittedAt: s.submitted_at,
      })),
    });
  }

  // ── 2. 预置投票（仅有正确答案的条目） ───────────────────────────────
  const polls = db
    .prepare('SELECT id, lesson_id, title, options_json, correct_option FROM lesson_preset_polls')
    .all() as Array<{ id: string; lesson_id: string; title: string; options_json: string; correct_option: string | null }>;
  for (const poll of polls) {
    if (!poll.correct_option || !poll.correct_option.trim()) {
      report.skipped.push({ source: 'preset_poll', sourceId: poll.id, reason: 'no_correct_option' });
      continue;
    }
    let options: string[] | null = null;
    try {
      options = parseOptions(JSON.parse(poll.options_json));
    } catch {
      options = null;
    }
    const letterIndex = poll.correct_option.trim().toUpperCase().charCodeAt(0) - 65;
    if (!options || letterIndex < 0 || letterIndex >= options.length) {
      report.skipped.push({ source: 'preset_poll', sourceId: poll.id, reason: 'invalid_poll_shape' });
      continue;
    }
    const lesson = db.prepare('SELECT creator_id FROM lessons WHERE id = ?').get(poll.lesson_id) as
      | { creator_id: string | null }
      | undefined;
    importOne({
      source: 'preset_poll',
      sourceId: poll.id,
      lessonId: poll.lesson_id,
      title: poll.title.slice(0, 120),
      options,
      correctIndex: letterIndex,
      maxScore: 1,
      ownerId: lesson?.creator_id ?? 'system',
      // 预置投票的作答只存在课堂会话内存/事件里，没有可按学生回放的持久表 → 不导入作答
      attempts: [],
    });
  }

  return report;
}
