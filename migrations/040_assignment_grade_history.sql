-- UP
-- 成绩审计与手动分保护（P1 审计修复）：
--   1. assignment_grade_history：每次成绩变更一行，记录旧/新分数、状态、来源与操作者，
--      用于回答「这个分数是谁、什么时候、为什么改的」。
--   2. assignment_submissions.graded_by：最后一次成绩写入的操作者
--      （`user:<id>:<role>` 或 `system`），学期成绩页可据此展示录入人。
--   3. source 补齐：历史遗留 NULL（手动按钮、插件投影、学期成绩同步）按 manual 处理。
--      自动录入只覆盖 source='auto' 的行，NULL 若不回填会被当成「未保护」直接冲掉。
--   4. 缺考行（status='absent'）继续保持 source='manual'，自动规则不得覆盖。

CREATE TABLE IF NOT EXISTS assignment_grade_history (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  old_score REAL,
  new_score REAL,
  old_status TEXT,
  new_status TEXT,
  old_source TEXT,
  new_source TEXT,
  actor_id TEXT,
  actor_role TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assignment_grade_history_target
  ON assignment_grade_history(assignment_id, student_id, created_at);

ALTER TABLE assignment_submissions ADD COLUMN graded_by TEXT;

UPDATE assignment_submissions SET source = 'manual' WHERE source IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_assignment_grade_history_target;
DROP TABLE IF EXISTS assignment_grade_history;
ALTER TABLE assignment_submissions DROP COLUMN graded_by;
