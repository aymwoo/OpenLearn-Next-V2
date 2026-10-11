-- UP
-- 020_upload_max_file_mb.sql
-- v0.6.1：课件上传文件大小上限改为管理员可配置（管理后台 → 站点设置）。
--
-- site_settings 增加 upload_max_file_mb 列（MB，整数）。NULL = 未配置，
-- 运行时取默认 10MB（与历史 express.json 10MB 限制下的实际可用值一致）。
-- 硬上限 90MB：受 express.json 的 110MB 全局 JSON 上限约束（base64 膨胀
-- ~33%），服务端 /api/upload 在解码后按此列逐请求强制执行。

ALTER TABLE site_settings ADD COLUMN upload_max_file_mb INTEGER;

-- DOWN
-- SQLite 3.35+ 支持 DROP COLUMN（Node 24 内置版本满足）；旧版需表重建兜底
ALTER TABLE site_settings DROP COLUMN upload_max_file_mb;
