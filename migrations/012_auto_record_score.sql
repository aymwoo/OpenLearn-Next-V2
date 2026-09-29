-- UP
-- Courseware Auto Grade Recording Rule (auto-record)
--
-- 把「学生提交数据」页的**逐条手动「录入成绩」**升级为**按规则自动录入**：
-- 教师先设定规则（开关 + 完成度门槛），之后课件被提交时由服务端自动把成绩
-- 写入学期成绩（assignment_submissions），无需逐条点击。
--
-- 设计要点：
--   1. 字段挂在既有 courseware_score_config 上，复用它「课件专属 → 全局 '*' → 内置默认」
--      的三级继承（见 packages/plugins/courseware-score.ts 的 resolveScoreConfig），
--      不另立配置表，避免出现两套成绩配置。
--   2. auto_record_enabled 默认 0（关闭）：不改变现有行为，教师显式开启才生效。
--   3. auto_record_min_completion 为完成度门槛（0~1）。完成度低于门槛的提交不自动录入，
--      留在「学生提交数据」页由教师人工判定 —— 规则只自动化"确定性足够"的记录。
--   4. 分数始终取课件聚合分（submission_result.score）。**没有分数一律不录**，
--      绝不凭空造分（历史上 promote 的 finalScore 默认 100 会给满分，已改为拒绝）。

ALTER TABLE courseware_score_config ADD COLUMN auto_record_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE courseware_score_config ADD COLUMN auto_record_min_completion REAL NOT NULL DEFAULT 0;

-- DOWN
-- 不使用 ALTER TABLE ... DROP COLUMN（旧版 SQLite 内核不支持，且迁移执行器只对
-- "duplicate column name" 容错，失败会中断回滚）。改为标准的「重建表」回滚。
CREATE TABLE courseware_score_config__rollback (
  courseware_id TEXT PRIMARY KEY,
  courseware_name TEXT,
  score_policy TEXT NOT NULL DEFAULT 'LATEST',
  score_fields TEXT NOT NULL DEFAULT '',
  raw_full_score REAL NOT NULL DEFAULT 100,
  target_full_score REAL NOT NULL DEFAULT 100,
  weight_percentage REAL NOT NULL DEFAULT 100,
  lesson_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO courseware_score_config__rollback
  (courseware_id, courseware_name, score_policy, score_fields,
   raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at)
SELECT
  courseware_id, courseware_name, score_policy, score_fields,
  raw_full_score, target_full_score, weight_percentage, lesson_id, updated_at
FROM courseware_score_config;

DROP TABLE courseware_score_config;

ALTER TABLE courseware_score_config__rollback RENAME TO courseware_score_config;

CREATE INDEX IF NOT EXISTS idx_courseware_score_config_lesson ON courseware_score_config(lesson_id);
