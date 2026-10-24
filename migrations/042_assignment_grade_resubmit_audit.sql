-- UP
-- Issue #248：学生重交会替换已批改行的作答内容，但 `assignment_grade_history`
--   只记分数 / 状态 / 来源 —— 查不到「这份分数是针对哪份内容给的」。
--   于是出现「内容换了、分数没动、历史里查不出来」的脱钩。
--
-- 补一列 `old_content`：只存**被替换掉的那份**内容（带分数的那份）。
-- 新内容就在 `assignment_submissions` 行里，不必再存一份 ——
-- 避免审计表被大段文本撑爆。
ALTER TABLE assignment_grade_history ADD COLUMN old_content TEXT;

-- DOWN
ALTER TABLE assignment_grade_history DROP COLUMN old_content;
