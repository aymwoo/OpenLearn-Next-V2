-- UP
-- 080_skill_bindings.sql
-- Skill 细粒度绑定：按「全局 / 班级 / 课节」覆盖技能的可用性。
--
-- 解析优先级（最具体者胜出）：lesson > class > global > skill_settings/manifest。
-- scope_id：global 用空字符串；class 用 classes.id；lesson 用 lessons.id。
-- 同一 (skill_id, surface, scope_type, scope_id) 唯一。

CREATE TABLE IF NOT EXISTS skill_bindings (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  surface TEXT NOT NULL CHECK (surface IN ('lesson_prep', 'admin_settings', 'classroom_live')),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'class', 'lesson')),
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (skill_id, surface, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_skill_bindings_skill ON skill_bindings (skill_id, surface);
CREATE INDEX IF NOT EXISTS idx_skill_bindings_scope ON skill_bindings (scope_type, scope_id);

-- DOWN
DROP INDEX IF EXISTS idx_skill_bindings_scope;
DROP INDEX IF EXISTS idx_skill_bindings_skill;
DROP TABLE IF EXISTS skill_bindings;
