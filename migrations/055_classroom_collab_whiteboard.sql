-- UP
-- 055_classroom_collab_whiteboard.sql
-- 持久化随堂小组协作白板与画廊互评数据，按 (lesson_id, class_id) 隔离保存，
-- 关闭/重开模态窗或刷新页面后仍可恢复分组、驱动题、笔画路径、点赞与思辨标签。

CREATE TABLE IF NOT EXISTS classroom_collab_whiteboards (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL,
  class_id TEXT NOT NULL DEFAULT '',
  mission_prompt TEXT NOT NULL DEFAULT '',
  grouping_strategy TEXT NOT NULL DEFAULT 'heterogeneous',
  groups_json TEXT NOT NULL DEFAULT '[]',
  strokes_json TEXT NOT NULL DEFAULT '[]',
  likes_json TEXT NOT NULL DEFAULT '{}',
  inquiries_json TEXT NOT NULL DEFAULT '{}',
  spotlight_group_id TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE(lesson_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_whiteboard_lesson
  ON classroom_collab_whiteboards(lesson_id, class_id);

-- DOWN
DROP INDEX IF EXISTS idx_collab_whiteboard_lesson;
DROP TABLE IF EXISTS classroom_collab_whiteboards;
