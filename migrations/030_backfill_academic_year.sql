-- UP
-- 学年历史数据向后兼容回填标记与 SQL 级关联回填
-- 细粒度日期推导由启动阶段 backfillAcademicYearData(db) 幂等执行。

CREATE TABLE IF NOT EXISTS _academic_year_backfill (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  backfilled_at TEXT NOT NULL
);

-- SQL 级关联回填：优先从所属父实体继承已存在的学年
UPDATE assignment_submissions
SET academic_year = (SELECT a.academic_year FROM assignments a WHERE a.id = assignment_submissions.assignment_id)
WHERE academic_year IS NULL
  AND EXISTS (SELECT 1 FROM assignments a WHERE a.id = assignment_submissions.assignment_id AND a.academic_year IS NOT NULL);

UPDATE attendance
SET academic_year = (SELECT s.academic_year FROM schedules s WHERE s.id = attendance.schedule_id)
WHERE academic_year IS NULL
  AND EXISTS (SELECT 1 FROM schedules s WHERE s.id = attendance.schedule_id AND s.academic_year IS NOT NULL);

UPDATE exam_scores
SET academic_year = (SELECT e.academic_year FROM exams e WHERE e.id = exam_scores.exam_id)
WHERE academic_year IS NULL
  AND EXISTS (SELECT 1 FROM exams e WHERE e.id = exam_scores.exam_id AND e.academic_year IS NOT NULL);

INSERT OR IGNORE INTO _academic_year_backfill (id, backfilled_at)
VALUES (1, datetime('now'));

-- DOWN
DROP TABLE IF EXISTS _academic_year_backfill;
