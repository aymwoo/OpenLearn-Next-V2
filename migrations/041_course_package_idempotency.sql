-- UP
-- 课程包导入幂等（G-06，docs/audit/course-import-audit.md）：
--
-- 课程包格式本身没有天然主键（不像数据库行有 id），去重键只能派生：
--   * 包声明了 meta.id  → key = "id:<meta.id>"（作者给的稳定标识，抗内容漂移）
--   * 包没声明 meta.id  → key = "sha256:<内容哈希>"（规范化内容，见
--                         server/services/course-package-identity.ts）
--
-- 三列各司其职：
--   source_package_key   去重键本体。查重就查它 —— 命中即视为「同一个包」。
--   source_package_hash  内容哈希。即便包声明了 id 也要留着：换了内容但沿用
--                        同一个 id 时，能看出「内容确实变过」。
--   source_package_id    包声明的 meta.id（可空）。仅为可读性/排查而存在。
--
-- 作用域是**按创建者**：内置课程模板要能被每一位教师各导入一份，
-- 所以去重只在同一 creator_id 内生效，不做全局去重。
--
-- 键随课程行一起存在 → 教师删课即释放该键，无需额外的清理链路。

ALTER TABLE lessons ADD COLUMN source_package_key TEXT;
ALTER TABLE lessons ADD COLUMN source_package_hash TEXT;
ALTER TABLE lessons ADD COLUMN source_package_id TEXT;

-- 查重路径：creator_id + source_package_key 精确命中。
CREATE INDEX IF NOT EXISTS idx_lessons_source_package_key
  ON lessons(creator_id, source_package_key)
  WHERE source_package_key IS NOT NULL;

-- DOWN
DROP INDEX IF EXISTS idx_lessons_source_package_key;
ALTER TABLE lessons DROP COLUMN source_package_id;
ALTER TABLE lessons DROP COLUMN source_package_hash;
ALTER TABLE lessons DROP COLUMN source_package_key;
