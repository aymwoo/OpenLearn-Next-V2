-- UP
-- 性能索引补充（DATA-INT-02 / 路线图 A6）
--
-- 高频查询路径缺失索引，数据量增长后退化为全表扫描：
--   1. vfs_nodes(parent_id)：VFS 目录树逐级下钻（workspace GET /files/* 每层一次 parent 查询）
--   2. plugin_submissions(lesson_id)：插件提交按课节检索
--   3. student_point_logs(student_id)：积分台账按学生检索
--   4. student_rollcalls(class_id) / (student_id)：点名记录按班级/学生检索

CREATE INDEX IF NOT EXISTS idx_vfs_nodes_parent ON vfs_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_plugin_submissions_lesson ON plugin_submissions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_student_point_logs_student ON student_point_logs(student_id);
CREATE INDEX IF NOT EXISTS idx_student_rollcalls_class ON student_rollcalls(class_id);
CREATE INDEX IF NOT EXISTS idx_student_rollcalls_student ON student_rollcalls(student_id);

-- DOWN
DROP INDEX IF EXISTS idx_student_rollcalls_student;
DROP INDEX IF EXISTS idx_student_rollcalls_class;
DROP INDEX IF EXISTS idx_student_point_logs_student;
DROP INDEX IF EXISTS idx_plugin_submissions_lesson;
DROP INDEX IF EXISTS idx_vfs_nodes_parent;
