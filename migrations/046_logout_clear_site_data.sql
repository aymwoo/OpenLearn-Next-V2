-- UP
-- 046_logout_clear_site_data.sql
-- Issue #487：管理后台可配置登出时是否下发 Clear-Site-Data: "cookies", "storage", "cache"。
-- 默认值为 0（关闭），由管理员在站点设置中按需启用。

ALTER TABLE site_settings ADD COLUMN logout_clear_site_data INTEGER DEFAULT 0;

-- DOWN
ALTER TABLE site_settings DROP COLUMN logout_clear_site_data;
