-- UP
CREATE TABLE IF NOT EXISTS ai_personas (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  plugin_id TEXT,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  instruction_zh TEXT NOT NULL DEFAULT '',
  instruction_en TEXT NOT NULL DEFAULT '',
  icon TEXT,
  mode TEXT NOT NULL DEFAULT 'overlay',
  base_policy TEXT NOT NULL DEFAULT 'inherit',
  visibility_json TEXT,
  default_for_role_json TEXT,
  tool_policy_json TEXT,
  max_turns INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_personas_source_plugin ON ai_personas(source, plugin_id);

-- DOWN
DROP INDEX IF EXISTS idx_ai_personas_source_plugin;
DROP TABLE IF EXISTS ai_personas;
