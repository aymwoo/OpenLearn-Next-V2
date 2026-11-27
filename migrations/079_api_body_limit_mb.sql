-- UP
-- 079_api_body_limit_mb.sql
-- 全局 JSON / urlencoded 请求体上限改为管理员可配置（管理后台 → 站点信息设置）。
--
-- site_settings 增加 api_body_limit_mb 列（MB，整数）。NULL = 未配置，
-- 运行时取默认 2MB（与历史硬编码 express.json 2MB 上限一致）。
-- 硬上限 50MB：全局上限作用于所有非上传端点，抬得越高内存放大风险越大；
-- 更大体积的文件请走专用上传端点（自带 110MB 解析上限）。
ALTER TABLE site_settings ADD COLUMN api_body_limit_mb INTEGER;

-- DOWN
-- SQLite 3.35+ 支持 DROP COLUMN（Node 24 内置版本满足）；旧版需表重建兜底
ALTER TABLE site_settings DROP COLUMN api_body_limit_mb;
