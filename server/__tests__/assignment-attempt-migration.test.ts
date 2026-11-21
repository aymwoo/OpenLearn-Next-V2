import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { loadMigrationsFromDirectory, runMigrations } from '../utils/migrate.js';

/**
 * 迁移 073 的存量回填回归。
 *
 * 先跑到 072（动作与线上升级一致：旧表已有真实数据），插入两种作业体系的提交、
 * 版本、文件、互评、评分与成绩历史，再执行 073，验证：
 *   - 每个作业定义都有 kind='assignment' 的 Surface；
 *   - 每条提交都有 attempt，状态 / 分数 / 内容快照正确；
 *   - 全部明细表的 attempt_id 都被回填。
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

describe('迁移 073：作业域回填', () => {
  it('把 hub 与传统作业的提交、文件、互评、评分挂到 attempt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learningsurface-073-'));
    const db = new Database(path.join(dir, 'migrate.db'));
    try {
      const migrations = loadMigrationsFromDirectory(MIGRATIONS_DIR);
      const before = migrations.filter((m) => !m.name.startsWith('073_') && !m.name.startsWith('074_'));
      runMigrations(db, before);

      const now = 1_700_000_000_000;
      db.prepare(
        `INSERT INTO plugin_assignments (id, class_id, lesson_id, title, created_at, updated_at)
         VALUES ('asg-hub-1', 'class-1', NULL, 'Hub 作业', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
         VALUES ('sub-1', 'asg-hub-1', NULL, 'stu-1', NULL, 2, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_submission_versions
           (id, submission_id, assignment_id, student_id, version, files_json, text_content, link_url, is_late, submitted_at)
         VALUES ('sv-2', 'sub-1', 'asg-hub-1', 'stu-1', 2, '[{"fileId":"af-1","name":"a.pdf"}]', '答案', NULL, 0, ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO plugin_assignment_files
           (id, assignment_id, student_id, original_name, stored_path, size, mime, sha256, uploaded_at, submission_id, version_id)
         VALUES ('af-1', 'asg-hub-1', 'stu-1', 'a.pdf', 'x/a.pdf', 10, 'application/pdf', 'sha', ?, 'sub-1', 'sv-2')`,
      ).run(now);
      db.prepare(
        `INSERT INTO plugin_peer_review_tasks (id, assignment_id, submission_id, reviewer_id, status, created_at)
         VALUES ('task-1', 'asg-hub-1', 'sub-1', 'stu-2', 'pending', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO plugin_peer_reviews
           (id, task_id, submission_id, assignment_id, reviewer_id, score, comment, status, created_at, updated_at)
         VALUES ('review-1', 'task-1', 'sub-1', 'asg-hub-1', 'stu-2', 80, '不错', 'submitted', ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_grades
           (id, submission_id, teacher_score, teacher_comment, teacher_weight, peer_weight,
            calculated_final_score, status, graded_at, assignment_id, peer_average_score, source, published_at, graded_by)
         VALUES ('grd-1', 'sub-1', 90, '很好', 0.6, 0.4, 88, 'confirmed', ?, 'asg-hub-1', 80, 'teacher', ?, 'teacher-1')`,
      ).run(now, now);

      db.prepare(
        `INSERT INTO assignments (id, class_id, lesson_id, title, created_at)
         VALUES ('ast-1', 'class-1', NULL, '传统作业', ?)`,
      ).run(now);
      db.prepare(
        `INSERT INTO assignment_submissions
           (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status, graded_by)
         VALUES ('ast-1', 'stu-1', '我的答案', 75, '继续努力', ?, ?, 'graded', 'teacher-1')`,
      ).run(now - 1000, now);
      db.prepare(
        `INSERT INTO assignment_grade_history
           (id, assignment_id, student_id, old_score, new_score, old_status, new_status, actor_id, actor_role, created_at)
         VALUES ('agh-1', 'ast-1', 'stu-1', 70, 75, 'submitted', 'graded', 'teacher-1', 'teacher', ?)`,
      ).run(now);

      // 课时级随堂提交（assignment_id IS NULL），由 074 回填。
      db.prepare(
        `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
         VALUES ('sub-lesson-1', NULL, 'lesson-1', 'stu-2', 'files/lesson.pdf', 3, ?, ?)`,
      ).run(now, now);
      db.prepare(
        `INSERT INTO plugin_peer_reviews
           (id, task_id, submission_id, assignment_id, reviewer_id, score, comment, status, created_at, updated_at)
         VALUES ('review-lesson-1', NULL, 'sub-lesson-1', NULL, 'stu-3', 90, '好', 'submitted', ?, ?)`,
      ).run(now, now);

      runMigrations(db, migrations);

      const hubSurface = db
        .prepare("SELECT * FROM learning_surfaces WHERE kind = 'assignment' AND owner_id = 'asg-hub-1'")
        .get() as { id: string; lesson_id: string; content_ref_json: string } | undefined;
      expect(hubSurface).toBeDefined();
      expect(hubSurface?.lesson_id).toBe('');
      expect(JSON.parse(hubSurface!.content_ref_json)).toMatchObject({
        rendererId: 'assignment_submission',
        source: { kind: 'assignment', id: 'asg-hub-1' },
      });

      const hubAttempt = db
        .prepare("SELECT * FROM learning_surface_attempts WHERE surface_id = ? AND student_id = 'stu-1'")
        .get(hubSurface!.id) as
        { id: string; status: string; score: number; completion: number; state_json: string } | undefined;
      expect(hubAttempt).toBeDefined();
      expect(hubAttempt?.status).toBe('graded');
      expect(hubAttempt?.score).toBe(88);
      expect(hubAttempt?.completion).toBe(1);
      expect(JSON.parse(hubAttempt!.state_json)).toMatchObject({
        submissionId: 'sub-1',
        version: 2,
        textContent: '答案',
      });
      expect(JSON.parse(hubAttempt!.state_json).files).toEqual([{ fileId: 'af-1', name: 'a.pdf' }]);

      const attemptIdOf = (sql: string) => (db.prepare(sql).get() as { attempt_id: string | null }).attempt_id;
      expect(attemptIdOf("SELECT attempt_id FROM plugin_submissions WHERE id = 'sub-1'")).toBe(hubAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM plugin_submission_versions WHERE id = 'sv-2'")).toBe(hubAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM plugin_assignment_files WHERE id = 'af-1'")).toBe(hubAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM plugin_peer_review_tasks WHERE id = 'task-1'")).toBe(hubAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM plugin_peer_reviews WHERE id = 'review-1'")).toBe(hubAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM plugin_grades WHERE id = 'grd-1'")).toBe(hubAttempt!.id);

      const traditionalSurface = db
        .prepare("SELECT id FROM learning_surfaces WHERE kind = 'assignment' AND owner_id = 'ast-1'")
        .get() as { id: string } | undefined;
      const traditionalAttempt = db
        .prepare("SELECT * FROM learning_surface_attempts WHERE surface_id = ? AND student_id = 'stu-1'")
        .get(traditionalSurface!.id) as { id: string; status: string; score: number; state_json: string } | undefined;
      expect(traditionalAttempt?.status).toBe('graded');
      expect(traditionalAttempt?.score).toBe(75);
      expect(JSON.parse(traditionalAttempt!.state_json)).toMatchObject({ content: '我的答案', feedback: '继续努力' });
      expect(
        attemptIdOf(
          "SELECT attempt_id FROM assignment_submissions WHERE assignment_id = 'ast-1' AND student_id = 'stu-1'",
        ),
      ).toBe(traditionalAttempt!.id);
      expect(attemptIdOf("SELECT attempt_id FROM assignment_grade_history WHERE id = 'agh-1'")).toBe(
        traditionalAttempt!.id,
      );

      const lessonSurface = db
        .prepare(
          "SELECT id, lesson_id, content_ref_json FROM learning_surfaces WHERE kind = 'lesson_eval' AND owner_id = 'lesson-1'",
        )
        .get() as { id: string; lesson_id: string; content_ref_json: string } | undefined;
      expect(lessonSurface).toBeDefined();
      expect(lessonSurface?.lesson_id).toBe('lesson-1');
      expect(JSON.parse(lessonSurface!.content_ref_json)).toMatchObject({
        rendererId: 'assignment_submission',
        source: { kind: 'activity', id: 'lesson-1' },
      });

      const lessonAttempt = db
        .prepare("SELECT * FROM learning_surface_attempts WHERE surface_id = ? AND student_id = 'stu-2'")
        .get(lessonSurface!.id) as { id: string; status: string; completion: number; state_json: string } | undefined;
      expect(lessonAttempt?.status).toBe('submitted');
      expect(lessonAttempt?.completion).toBe(1);
      expect(JSON.parse(lessonAttempt!.state_json)).toMatchObject({
        submissionId: 'sub-lesson-1',
        version: 3,
        filePath: 'files/lesson.pdf',
      });
      expect(attemptIdOf("SELECT attempt_id FROM plugin_submissions WHERE id = 'sub-lesson-1'")).toBe(
        lessonAttempt!.id,
      );
      expect(attemptIdOf("SELECT attempt_id FROM plugin_peer_reviews WHERE id = 'review-lesson-1'")).toBe(
        lessonAttempt!.id,
      );
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
