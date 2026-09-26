-- UP
-- 班级固定分组（Class Seating Groups）
--
-- 机房管理中为班级学生建立持久化学习小组：支持自动分组、指定组长、
-- 手动调整成员归属；上课需要分组活动时默认按该分组进行，
-- 同时课堂内可临时新建分组或调整（临时分组只写 classroom_sessions 侧，不改本表）。
--
-- 设计取舍：
--  - is_default 标记「上课默认分组方案」，同一班级至多一套；
--  - member_ids / leader_id 用 JSON 保存整组成员与组长，
--    组数通常为个位数、成员为几十人，单行读取即可渲染整组面板，
--    避免额外的成员关系表与多查询往返；
--  - name_en 记录可选英文组名，跟随平台的 i18n 口径。

CREATE TABLE IF NOT EXISTS class_groups (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_en TEXT,
  color TEXT DEFAULT 'bg-indigo-500',
  member_ids TEXT NOT NULL DEFAULT '[]',
  leader_id TEXT,
  is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_class_groups_class ON class_groups(class_id, sort_order, created_at);

-- DOWN
DROP INDEX IF EXISTS idx_class_groups_class;
DROP TABLE IF EXISTS class_groups;
