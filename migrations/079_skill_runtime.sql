-- UP
-- 079_skill_runtime.sql
-- Skill 运行时 P1/P2：管理员设置、运行记录与配置变更回滚。
--
-- skill_settings：管理员对内置 / 插件技能的启停与场景覆盖（未设置 = 沿用 manifest 声明）。
-- skill_runs：每次技能运行的审计记录（不保存完整产物，只保存类型与状态）。
-- skill_config_rollbacks：config_patch 应用前的旧值快照，用于一键回滚。

CREATE TABLE IF NOT EXISTS skill_settings (
  skill_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  surfaces_json TEXT,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  actor_id TEXT,
  scope_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  artifact_kind TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_skill_runs_created ON skill_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_runs_skill ON skill_runs (skill_id, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_config_rollbacks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  previous_json TEXT NOT NULL,
  applied_by TEXT,
  created_at INTEGER NOT NULL,
  rolled_back_at INTEGER,
  rolled_back_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_config_rollbacks_run ON skill_config_rollbacks (run_id);

-- DOWN
DROP INDEX IF EXISTS idx_skill_config_rollbacks_run;
DROP TABLE IF EXISTS skill_config_rollbacks;
DROP INDEX IF EXISTS idx_skill_runs_skill;
DROP INDEX IF EXISTS idx_skill_runs_created;
DROP TABLE IF EXISTS skill_runs;
DROP TABLE IF EXISTS skill_settings;
