-- UP
-- 052_community_install_enabled.sql
-- 支持在插件中心「社区」页由管理员开关「允许从社区注册表安装」；
-- NULL 表示未在界面显式配置，服务端回落到环境变量 OPENLEARN_COMMUNITY_INSTALL
-- （仅当值为 1 时开启；未设置则保持历史默认关闭）。
-- 0 = 界面显式关闭（即使环境变量为 1）；1 = 界面显式开启。
-- 默认必须为 NULL，不能写成 0，否则会掩盖环境变量回退。

ALTER TABLE site_settings ADD COLUMN community_install_enabled INTEGER;

-- DOWN
ALTER TABLE site_settings DROP COLUMN community_install_enabled;
