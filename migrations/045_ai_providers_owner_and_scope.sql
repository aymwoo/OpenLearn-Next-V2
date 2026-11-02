-- UP
-- 045_ai_providers_owner_and_scope.sql
-- AI 提供商账号级隔离与共享范围（Issue #383）：
-- owner_id: 所有者用户 ID（私有提供商仅所有者可见可用）
-- is_shared: 0=用户私有，1=平台共享（全员可见可用，仅管理员可维护）

ALTER TABLE ai_providers ADD COLUMN owner_id TEXT;
ALTER TABLE ai_providers ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_ai_providers_owner_shared ON ai_providers(owner_id, is_shared);

-- 存量数据平滑归属：将历史存量非空提供商回填给首个系统管理员，且默认保持私有（is_shared=0）
UPDATE ai_providers
SET owner_id = (SELECT id FROM users WHERE role = 'administrator' ORDER BY created_at ASC LIMIT 1),
    is_shared = 0
WHERE owner_id IS NULL;

-- DOWN
DROP INDEX IF EXISTS idx_ai_providers_owner_shared;
ALTER TABLE ai_providers DROP COLUMN is_shared;
ALTER TABLE ai_providers DROP COLUMN owner_id;
