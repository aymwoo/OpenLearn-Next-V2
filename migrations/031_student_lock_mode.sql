-- UP
-- 学生端锁定模式 (lock_mode) 与锁定目标 (lock_target)（Issue #110）
-- lock_mode: 'full' (完全锁定/只读跟随) | 'navigation' (答题锁定/放开输入作答，禁止离开)
-- lock_target: JSON 字符串，例如 {"tab":"whiteboard"|"assignment"|"courseware","assignmentId":"...","elementId":"..."}

ALTER TABLE students ADD COLUMN lock_mode TEXT DEFAULT 'full';
ALTER TABLE students ADD COLUMN lock_target TEXT DEFAULT NULL;

-- DOWN
