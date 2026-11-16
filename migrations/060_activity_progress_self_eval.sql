-- ============================================================================
-- 060_activity_progress_self_eval.sql
-- Issue IKVO15 · P1 — 学生自评
-- 扩展 activity_progress 表，增加 self_eval_json 列，
-- 存储学生提交后的自评内容（分数 + 评语 JSON）。
-- ============================================================================

ALTER TABLE activity_progress ADD COLUMN self_eval_json TEXT;

-- DOWN
ALTER TABLE activity_progress DROP COLUMN self_eval_json;
