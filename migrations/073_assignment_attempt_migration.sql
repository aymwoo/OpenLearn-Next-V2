-- UP
-- 073_assignment_attempt_migration.sql
--
-- 阶段 2：作业域全量迁移到 LearningSurface / attempt 状态底座。
--
-- 设计见 docs/architecture/learning-surface.md。本迁移做两件事：
--   ① 给旧作业明细表补 `attempt_id`，让提交、文件、版本、互评、评分、成绩历史
--      都能直接指向统一 attempt；
--   ② 存量数据一次性回填（单事务）：
--      - 每个作业定义（plugin_assignments / assignments）建一个 kind='assignment' 的 Surface；
--      - 每条提交建一条 attempt（attempt_no = 1），并回填全部明细外键。
--
-- 说明：
--   - 班级级作业没有 lesson_id，按已确认决策写空字符串（课时查询不会命中它们）；
--   - 旧表仍保留，读 API 不变；写 API 在本阶段改为 410，由 learning-surface 通道接管；
--   - 回填使用确定性 id（lsm_ / lsam_ 前缀），重复执行时 INSERT OR IGNORE 不会产生重复行。

-- ── 1. 明细表补 attempt_id ────────────────────────────────────────────────
ALTER TABLE assignment_submissions ADD COLUMN attempt_id TEXT;
ALTER TABLE assignment_grade_history ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_submissions ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_submission_versions ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_assignment_files ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_peer_review_tasks ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_peer_reviews ADD COLUMN attempt_id TEXT;
ALTER TABLE plugin_grades ADD COLUMN attempt_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_attempt ON assignment_submissions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_assignment_grade_history_attempt ON assignment_grade_history(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_submissions_attempt ON plugin_submissions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_submission_versions_attempt ON plugin_submission_versions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_assignment_files_attempt ON plugin_assignment_files(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_peer_review_tasks_attempt ON plugin_peer_review_tasks(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_peer_reviews_attempt ON plugin_peer_reviews(attempt_id);
CREATE INDEX IF NOT EXISTS idx_plugin_grades_attempt ON plugin_grades(attempt_id);

-- ── 2. 作业定义 → Surface ─────────────────────────────────────────────────
-- 作业中心（plugin_assignments）
INSERT OR IGNORE INTO learning_surfaces
  (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
SELECT
  'lsm_p_' || id,
  COALESCE(lesson_id, ''),
  'assignment',
  id,
  json_object(
    'rendererId', 'assignment_submission',
    'source', json_object('kind', 'assignment', 'id', id),
    'config', json_object('title', title)
  ),
  NULL,
  created_at,
  updated_at
FROM plugin_assignments;

-- 传统班级作业（assignments）
INSERT OR IGNORE INTO learning_surfaces
  (id, lesson_id, kind, owner_id, content_ref_json, deleted_at, created_at, updated_at)
SELECT
  'lsm_t_' || id,
  COALESCE(lesson_id, ''),
  'assignment',
  id,
  json_object(
    'rendererId', 'assignment_submission',
    'source', json_object('kind', 'assignment', 'id', id),
    'config', json_object('title', title)
  ),
  NULL,
  created_at,
  created_at
FROM assignments;

-- ── 3. 作业中心提交 → attempt ─────────────────────────────────────────────
INSERT OR IGNORE INTO learning_surface_attempts
  (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, auto_score, score,
   max_score, completion, state_json, is_preview, submitted_at, graded_at, graded_by, created_at, updated_at)
SELECT
  'lsam_p_' || s.id,
  COALESCE(s.lesson_id, ''),
  'lsm_p_' || s.assignment_id,
  s.student_id,
  1,
  'assignment_submission',
  CASE
    WHEN g.status IN ('confirmed', 'published') OR g.calculated_final_score IS NOT NULL THEN 'graded'
    ELSE 'submitted'
  END,
  NULL,
  g.calculated_final_score,
  100,
  1,
  json_object(
    'migratedFrom', 'plugin_submissions',
    'submissionId', s.id,
    'version', s.version,
    'textContent', v.text_content,
    'linkUrl', v.link_url,
    'files', json(v.files_json)
  ),
  0,
  COALESCE(v.submitted_at, s.created_at),
  g.graded_at,
  g.graded_by,
  s.created_at,
  s.updated_at
FROM plugin_submissions s
JOIN learning_surfaces ls ON ls.kind = 'assignment' AND ls.owner_id = s.assignment_id
LEFT JOIN plugin_grades g ON g.submission_id = s.id
LEFT JOIN plugin_submission_versions v ON v.id = (
  SELECT id FROM plugin_submission_versions
   WHERE submission_id = s.id
   ORDER BY version DESC
   LIMIT 1
)
WHERE s.assignment_id IS NOT NULL;

-- ── 4. 传统班级作业提交 → attempt ─────────────────────────────────────────
INSERT OR IGNORE INTO learning_surface_attempts
  (id, lesson_id, surface_id, student_id, attempt_no, renderer_id, status, auto_score, score,
   max_score, completion, state_json, is_preview, submitted_at, graded_at, graded_by, created_at, updated_at)
SELECT
  'lsam_t_' || sub.assignment_id || '_' || sub.student_id,
  COALESCE(a.lesson_id, ''),
  'lsm_t_' || sub.assignment_id,
  sub.student_id,
  1,
  'assignment_submission',
  CASE
    WHEN sub.status = 'graded' OR (sub.score IS NOT NULL AND sub.graded_at IS NOT NULL) THEN 'graded'
    ELSE 'submitted'
  END,
  NULL,
  sub.score,
  100,
  1,
  json_object(
    'migratedFrom', 'assignment_submissions',
    'content', sub.content,
    'feedback', sub.feedback
  ),
  0,
  sub.submitted_at,
  sub.graded_at,
  sub.graded_by,
  sub.submitted_at,
  COALESCE(sub.graded_at, sub.submitted_at)
FROM assignment_submissions sub
JOIN assignments a ON a.id = sub.assignment_id
JOIN learning_surfaces ls ON ls.kind = 'assignment' AND ls.owner_id = a.id;

-- ── 5. 明细外键回填 ───────────────────────────────────────────────────────
UPDATE plugin_submissions
   SET attempt_id = 'lsam_p_' || id
 WHERE attempt_id IS NULL AND assignment_id IS NOT NULL;

UPDATE plugin_submission_versions
   SET attempt_id = (
     SELECT s.attempt_id FROM plugin_submissions s WHERE s.id = plugin_submission_versions.submission_id
   )
 WHERE attempt_id IS NULL;

UPDATE plugin_assignment_files
   SET attempt_id = COALESCE(
     (SELECT s.attempt_id FROM plugin_submissions s WHERE s.id = plugin_assignment_files.submission_id),
     (SELECT s.attempt_id FROM plugin_submissions s
       WHERE s.assignment_id = plugin_assignment_files.assignment_id
         AND s.student_id = plugin_assignment_files.student_id)
   )
 WHERE attempt_id IS NULL;

UPDATE plugin_peer_review_tasks
   SET attempt_id = (
     SELECT ps.attempt_id FROM plugin_submissions ps WHERE ps.id = plugin_peer_review_tasks.submission_id
   )
 WHERE attempt_id IS NULL AND submission_id IS NOT NULL;

UPDATE plugin_peer_reviews
   SET attempt_id = (
     SELECT ps.attempt_id FROM plugin_submissions ps WHERE ps.id = plugin_peer_reviews.submission_id
   )
 WHERE attempt_id IS NULL AND submission_id IS NOT NULL;

UPDATE plugin_grades
   SET attempt_id = (
     SELECT ps.attempt_id FROM plugin_submissions ps WHERE ps.id = plugin_grades.submission_id
   )
 WHERE attempt_id IS NULL AND submission_id IS NOT NULL;

UPDATE assignment_submissions
   SET attempt_id = 'lsam_t_' || assignment_id || '_' || student_id
 WHERE attempt_id IS NULL;

UPDATE assignment_grade_history
   SET attempt_id = (
     SELECT sub.attempt_id FROM assignment_submissions sub
      WHERE sub.assignment_id = assignment_grade_history.assignment_id
        AND sub.student_id = assignment_grade_history.student_id
   )
 WHERE attempt_id IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_plugin_grades_attempt;
DROP INDEX IF EXISTS idx_plugin_peer_reviews_attempt;
DROP INDEX IF EXISTS idx_plugin_peer_review_tasks_attempt;
DROP INDEX IF EXISTS idx_plugin_assignment_files_attempt;
DROP INDEX IF EXISTS idx_plugin_submission_versions_attempt;
DROP INDEX IF EXISTS idx_plugin_submissions_attempt;
DROP INDEX IF EXISTS idx_assignment_grade_history_attempt;
DROP INDEX IF EXISTS idx_assignment_submissions_attempt;

DELETE FROM learning_surface_attempts
 WHERE surface_id IN (SELECT id FROM learning_surfaces WHERE kind = 'assignment');
DELETE FROM learning_surfaces WHERE kind = 'assignment';

ALTER TABLE plugin_grades DROP COLUMN attempt_id;
ALTER TABLE plugin_peer_reviews DROP COLUMN attempt_id;
ALTER TABLE plugin_peer_review_tasks DROP COLUMN attempt_id;
ALTER TABLE plugin_assignment_files DROP COLUMN attempt_id;
ALTER TABLE plugin_submission_versions DROP COLUMN attempt_id;
ALTER TABLE plugin_submissions DROP COLUMN attempt_id;
ALTER TABLE assignment_grade_history DROP COLUMN attempt_id;
ALTER TABLE assignment_submissions DROP COLUMN attempt_id;
