-- UP
-- 成绩来源（source）与自动录入更新策略（auto_record_strategy）
--
-- 背景（2026-09-30 审计教学缺口 2）：
--   1. 自动录入（autoRecordAttempt，submit_attempt 实时触发）无条件 upsert 覆盖
--      —— 教师手动调整过的分数会被课件分冲掉。
--   2. 批量补录（autoRecordForLesson）只要已有成绩行就跳过
--      —— 学生重做课件后，自动录入的旧分永不更新。
--   根因是 assignment_submissions 无法区分「手动录入」与「自动录入」。
--
-- 设计要点：
--   1. source 列区分成绩来源：'manual'（教师录入/改判，受保护）与 'auto'（规则自动录入，可刷新）。
--      auto 路径遇 source='manual' 跳过（manual-protected），auto 行按策略刷新。
--   2. 存量回填：自动路径写入的 feedback 固定以「由自动录入规则。」开头
--      （见 auto-record-score.ts 的 sourceLabel），据此回填 source='auto'；其余一律 'manual'
--      （含历史自动录入但 feedback 文案不符合的行 —— 宁可多保护，不可误覆盖）。
--   3. status='absent'（缺考）行在 auto 路径同样受保护（absent-protected），见 commit 3。
--   4. auto_record_strategy 挂在既有 courseware_score_config 上，复用其三级继承：
--      'latest'（默认，最新一次 attempt 分数覆盖）/ 'highest'（仅新分更高才覆盖，鼓励重做）。

ALTER TABLE assignment_submissions ADD COLUMN source TEXT;

UPDATE assignment_submissions SET source =
  CASE WHEN feedback LIKE '由自动录入规则。%' THEN 'auto' ELSE 'manual' END;

ALTER TABLE courseware_score_config ADD COLUMN auto_record_strategy TEXT NOT NULL DEFAULT 'latest';

-- DOWN
-- 「重建表」回滚（同 012：不用 ALTER TABLE ... DROP COLUMN，旧版 SQLite 内核不支持）。

CREATE TABLE assignment_submissions__rollback (
  assignment_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  content TEXT,
  score INTEGER,
  feedback TEXT,
  submitted_at INTEGER NOT NULL,
  graded_at INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted',
  PRIMARY KEY (assignment_id, student_id)
);

INSERT INTO assignment_submissions__rollback
  (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
SELECT
  assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status
FROM assignment_submissions;

DROP TABLE assignment_submissions;

ALTER TABLE assignment_submissions__rollback RENAME TO assignment_submissions;

CREATE TABLE courseware_score_config__rollback (
  courseware_id TEXT PRIMARY KEY,
  courseware_name TEXT,
  score_policy TEXT NOT NULL DEFAULT 'LATEST',
  score_fields TEXT NOT NULL DEFAULT '',
  raw_full_score REAL NOT NULL DEFAULT 100,
  target_full_score REAL NOT NULL DEFAULT 100,
  weight_percentage REAL NOT NULL DEFAULT 100,
  lesson_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  auto_record_enabled INTEGER NOT NULL DEFAULT 0,
  auto_record_min_completion REAL NOT NULL DEFAULT 0
);

INSERT INTO courseware_score_config__rollback
  (courseware_id, courseware_name, score_policy, score_fields,
   raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at,
   auto_record_enabled, auto_record_min_completion)
SELECT
  courseware_id, courseware_name, score_policy, score_fields,
  raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at,
  auto_record_enabled, auto_record_min_completion
FROM courseware_score_config;

DROP TABLE courseware_score_config;

ALTER TABLE courseware_score_config__rollback RENAME TO courseware_score_config;

CREATE INDEX IF NOT EXISTS idx_courseware_score_config_lesson ON courseware_score_config(lesson_id);
