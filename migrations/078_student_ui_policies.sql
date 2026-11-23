-- UP
-- 078_student_ui_policies.sql
-- Gitee Issue IKW5KV：学生端界面可见性策略。
-- 教师可按「我的全局（teacher）→ 班级（class）→ 课节（lesson）」收敛学生首屏内容，
-- 学生本地布局只能在这些范围内生效。每层只保存显式设置项，未设置项继续继承上层。
--
-- policy_json 由 packages/core/student-ui-policy 的严格校验写入；scope_id：
--   teacher → users.id
--   class   → classes.id
--   lesson  → lessons.id

CREATE TABLE IF NOT EXISTS student_ui_policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('teacher', 'class', 'lesson')),
  scope_id TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_student_ui_policies_scope
  ON student_ui_policies (scope_type, scope_id);

-- DOWN
DROP INDEX IF EXISTS idx_student_ui_policies_scope;
DROP TABLE IF EXISTS student_ui_policies;
