-- UP
-- 051_community_registry_url.sql
-- 支持在插件中心「社区」标签页配置社区插件注册表 JSON 地址；
-- NULL 表示未在界面显式覆盖，服务端回落到环境变量 PLUGIN_COMMUNITY_REGISTRY_URL。

ALTER TABLE site_settings ADD COLUMN community_registry_url TEXT;

-- DOWN
ALTER TABLE site_settings DROP COLUMN community_registry_url;
