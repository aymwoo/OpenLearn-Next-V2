-- UP
-- 教学模式（Teaching Modes）
--
-- 课堂启动门户（Classroom Entry Portal）的「教学模式选择器」数据源。
-- 教师为当次课堂选择一种教学模式，用于匹配合适的课堂节奏与互动策略。
--
-- 设计取舍：内置模式定义在代码常量中（server/routes/classroom.ts 的
-- BUILTIN_TEACHING_MODES），不在此处 seed。原因是内置模式的文案需要跟随
-- i18n 与产品迭代变化，写进迁移会造成「迁移与业务常量两处维护」。
-- API 读取时以「数据库记录优先 + 内置常量兜底」合并返回；
-- is_builtin 用于禁止删除内置模式。

CREATE TABLE IF NOT EXISTS teaching_modes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  description_en TEXT,
  icon TEXT,
  color TEXT,
  is_builtin INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_teaching_modes_sort ON teaching_modes(sort_order, created_at);

-- 当次课堂选用的教学模式。单独成列而非写入 settings_json，便于后续按模式
-- 聚合教学行为分布（如「不同模式下的互动次数 / 专注率」对比分析）。
ALTER TABLE classroom_sessions ADD COLUMN teaching_mode_id TEXT;

-- DOWN
DROP INDEX IF EXISTS idx_teaching_modes_sort;
DROP TABLE IF EXISTS teaching_modes;
ALTER TABLE classroom_sessions DROP COLUMN teaching_mode_id;
