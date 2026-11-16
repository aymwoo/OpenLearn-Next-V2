-- ============================================================================
-- 058_activity_progress_submission.sql
-- Issue IKVO15 · P0 后半段 — 活动提交闭环
-- 扩展 activity_progress 表，增加 submission_json 列，
-- 存储学生提交的作业内容（text / file / link 的 JSON 结构）。
-- 轻量闭环：不侵入现有 assignments 系统，先在 activity_progress 内自洽。
-- ============================================================================

ALTER TABLE activity_progress ADD COLUMN submission_json TEXT;

-- DOWN
ALTER TABLE activity_progress DROP COLUMN submission_json;
