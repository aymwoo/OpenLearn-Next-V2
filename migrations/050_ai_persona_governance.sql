-- UP
CREATE TABLE IF NOT EXISTS ai_persona_governance (
  persona_id TEXT PRIMARY KEY,
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  preferred_provider_id TEXT
);

-- DOWN
DROP TABLE IF EXISTS ai_persona_governance;
