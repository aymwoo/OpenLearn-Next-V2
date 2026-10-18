-- Issue #187：AI 辅助批改建议（教师确认后生效）。
--
-- 建议与分数分开存：ai_suggestion_json 只放「建议分 + 理由 + 置信度」，
-- 绝不直接写 score。教师确认走既有 manualGrade（manual_override = 1）。
-- grader 列在未判分时记 'ai_suggested' 作为来源标记；已有分数的行不改 grader。

ALTER TABLE assessment_answers ADD COLUMN ai_suggestion_json TEXT;

-- DOWN
ALTER TABLE assessment_answers DROP COLUMN ai_suggestion_json;
