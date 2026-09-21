-- UP
-- Courseware Score Aggregation Policy (native / platform side)
--
-- 记录每个互动课件的「成绩归集策略」：同一个 attempt 往往会产生多次分数样本
-- （学生反复提交、或平台分数变量监视器持续采样），宿主按此策略决定最终成绩，
-- 使记录层（submission_raw -> submission_result）自身闭环，不再依赖某个插件。
--
-- courseware_id = '*' 表示全局默认策略（课件没有单独配置时使用）。

CREATE TABLE IF NOT EXISTS courseware_score_config (
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

CREATE INDEX IF NOT EXISTS idx_courseware_score_config_lesson ON courseware_score_config(lesson_id);

-- DOWN
DROP INDEX IF EXISTS idx_courseware_score_config_lesson;
DROP TABLE IF EXISTS courseware_score_config;
