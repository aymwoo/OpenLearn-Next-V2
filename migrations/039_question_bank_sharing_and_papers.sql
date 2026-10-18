-- Issue #186：题库共享与按规则随机抽题（每人一卷）。
--
-- * question_bank_items.visibility：'private'（默认，仅 owner）| 'school'（同实例教师可见）。
--   共享不复制条目：读取时按 owner_id + visibility 过滤。
-- * assessment_attempts.paper_json：本次作答实际抽到的题目集合与种子（{ seed, itemIds }）。
--   同一学生多次进入复用同一条 attempt/paper，保证题目一致；不同学生种子不同 → 卷不同。
--   未配置抽题规则的试卷为 NULL（沿用整卷）。

ALTER TABLE question_bank_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE assessment_attempts ADD COLUMN paper_json TEXT;

-- DOWN
ALTER TABLE assessment_attempts DROP COLUMN paper_json;
ALTER TABLE question_bank_items DROP COLUMN visibility;
