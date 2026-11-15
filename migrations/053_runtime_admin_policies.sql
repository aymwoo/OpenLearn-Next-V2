-- UP
-- 053_runtime_admin_policies.sql
-- 管理员可在后台「站点信息设置」中配置三项运行时策略；列默认必须为 NULL（未配置），
-- 以便回退到环境变量，不能写成 0/默认值，否则会掩盖 ENV 回退并改变既有实际状态。
--
-- bridge_hook_telemetry: 课件网络遥测总闸。NULL=未配置；1=显式开启；0=显式关闭。
--   未配置时回退 BRIDGE_HOOK_TELEMETRY（仅 off 关闭，其余/未设置默认开启）。
-- http_access_log_mode: 访问日志策略。NULL=未配置；取值 off / errors / all。
--   未配置时回退 HTTP_ACCESS_LOG，再回退 LOG_LEVEL=debug|trace → all，否则默认 errors。
--   此项不是布尔开关，勿改成 0/1。
-- http_access_log_ignore: 逗号分隔的路径前缀静默名单。NULL=未配置，回退 HTTP_ACCESS_LOG_IGNORE。
-- http_slow_ms: 慢请求阈值（毫秒）。NULL=未配置，回退 HTTP_SLOW_MS（默认 1000）。
-- allow_unsigned_plugins: 未签名本地插件默认放行。NULL=未配置；1=显式允许默认放行；0=显式收紧为逐次确认。
--   未配置时回退 OPENLEARN_ALLOW_UNSIGNED（仅 0/false 收紧，未设置默认放行）。
--   此策略不能绕过签名错误、公钥、网络限制、权限或沙箱。

ALTER TABLE site_settings ADD COLUMN bridge_hook_telemetry INTEGER;
ALTER TABLE site_settings ADD COLUMN http_access_log_mode TEXT;
ALTER TABLE site_settings ADD COLUMN http_access_log_ignore TEXT;
ALTER TABLE site_settings ADD COLUMN http_slow_ms INTEGER;
ALTER TABLE site_settings ADD COLUMN allow_unsigned_plugins INTEGER;

-- DOWN
ALTER TABLE site_settings DROP COLUMN allow_unsigned_plugins;
ALTER TABLE site_settings DROP COLUMN http_slow_ms;
ALTER TABLE site_settings DROP COLUMN http_access_log_ignore;
ALTER TABLE site_settings DROP COLUMN http_access_log_mode;
ALTER TABLE site_settings DROP COLUMN bridge_hook_telemetry;
