-- UP
-- 课节进度按 student_id 聚合该课作业最高分，仪表盘按学生取提交。
-- assignment_submissions 的主键是 (assignment_id, student_id)，不能单独服务 student_id 查找。
-- assignments 已有 class_id 索引，没有 lesson_id 索引。

CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student ON assignment_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_lesson ON assignments(lesson_id);

-- DOWN
DROP INDEX IF EXISTS idx_assignments_lesson;
DROP INDEX IF EXISTS idx_assignment_submissions_student;
