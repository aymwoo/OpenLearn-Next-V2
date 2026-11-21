-- UP
-- 074_lesson_eval_attempt_migration.sql
--
-- 阶段 2 收尾：把课时级随堂提交（plugin_submissions.assignment_id IS NULL）
-- 也纳入统一 attempt 状态。
--
-- 映射：
--   - 每个课时一个 kind='lesson_eval' 的 Surface（owner_id = lesson_id）；
--   - 每个学生一条 attempt（复用旧语义：同一课时只有一条提交，重复提交只递增版本）；
--   - 旧互评任务 / 互评通过 submission_id 挂到同一条 attempt。
--
-- 本迁移只回填数据，不改表结构。

INSERT OR IGNORE INTO learning_surfaces
  (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
SELECT
  'lsm_le_' || lesson_id,
  lesson_id,
  'lesson_eval',
  lesson_id,
  json_object(
    'rendererId', 'assignment_submission',
    'source', json_object('kind', 'activity', 'id', lesson_id),
    'config', json_object('title', '随堂提交')
  ),
  NULL,
  MIN(created_at),
  MAX(updated_at)
FROM plugin_submissions
WHERE assignment_id IS NULL AND lesson_id IS NOT NULL AND lesson_id <> ''
GROUP BY lesson_id;

INSERT OR IGNORE INTO learning_surface_attempts
  (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, auto_score, score,
   max_score, completion, state_json, is_preview, submitted_at, graded_at, graded_by, created_at, updated_at)
SELECT
  'lsam_le_' || s.lesson_id || '_' || s.student_id,
  s.lesson_id,
  'lsm_le_' || s.lesson_id,
  s.student_id,
  1,
  'assignment_submission',
  'submitted',
  NULL,
  NULL,
  100,
  1,
  json_object(
    'migratedFrom', 'plugin_submissions',
    'submissionId', s.id,
    'version', s.version,
    'filePath', s.file_path,
    'textContent', NULL
  ),
  0,
  s.updated_at,
  NULL,
  NULL,
  s.created_at,
  s.updated_at
FROM plugin_submissions s
JOIN learning_surfaces ls ON ls.kind = 'lesson_eval' AND ls.owner_id = s.lesson_id
WHERE s.assignment_id IS NULL AND s.lesson_id IS NOT NULL AND s.lesson_id <> '';

UPDATE plugin_submissions
   SET attempt_id = 'lsam_le_' || lesson_id || '_' || student_id
 WHERE assignment_id IS NULL AND lesson_id IS NOT NULL AND lesson_id <> '';

UPDATE plugin_peer_review_tasks
   SET attempt_id = (
     SELECT ps.attempt_id FROM plugin_submissions ps WHERE ps.id = plugin_peer_review_tasks.submission_id
   )
 WHERE attempt_id IS NULL
   AND submission_id IN (
     SELECT id FROM plugin_submissions WHERE assignment_id IS NULL AND lesson_id IS NOT NULL AND lesson_id <> ''
   );

UPDATE plugin_peer_reviews
   SET attempt_id = (
     SELECT ps.attempt_id FROM plugin_submissions ps WHERE ps.id = plugin_peer_reviews.submission_id
   )
 WHERE attempt_id IS NULL
   AND submission_id IN (
     SELECT id FROM plugin_submissions WHERE assignment_id IS NULL AND lesson_id IS NOT NULL AND lesson_id <> ''
   );

-- DOWN
UPDATE plugin_peer_reviews SET attempt_id = NULL WHERE attempt_id LIKE 'lsam_le_%';
UPDATE plugin_peer_review_tasks SET attempt_id = NULL WHERE attempt_id LIKE 'lsam_le_%';
UPDATE plugin_submissions SET attempt_id = NULL WHERE attempt_id LIKE 'lsam_le_%';

DELETE FROM learning_surface_attempts
 WHERE surface_id IN (SELECT id FROM learning_surfaces WHERE kind = 'lesson_eval');
DELETE FROM learning_surfaces WHERE kind = 'lesson_eval';
