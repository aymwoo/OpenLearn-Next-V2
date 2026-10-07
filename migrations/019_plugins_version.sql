-- UP
-- 019_plugins_version.sql
-- 审计项 H-3（原始编号 L-7）：plugins 表补 version 列，让「插件版本」可在 SQL 层查询。
--
-- 背景：plugins 表把整个 manifest 存成一列 JSON（`manifest`），版本信息只存在于
-- `json_extract(manifest, '$.version')` 里面。这带来三个具体问题：
--
--   ① 无法用索引。社区市场、依赖解析、版本兼容性检查都需要「按版本筛选/排序」，
--      `json_extract` 无法走索引，只能全表扫描。plugins 表行数不大但会随生态增长。
--   ② 无法做 SQL 级 DISTINCT / GROUP BY 版本比较。
--      「哪些插件是 1.x」「有没有两个插件声明了同一版本」这类问题写不出来。
--   ③ 无法对版本做 CHECK 约束。manifest 里的 version 写错了也照样入库，
--      只在插件真正激活时才可能在别处炸。
--
-- 为什么不是「从 manifest 里读就行」：
--   读得到不等于查得起。插件宿主本身已有 `resolvePluginUuid()` 用
--   `json_extract(manifest, '$.id')` 做主键回查（index.ts），说明这个模式可用；
--   但那是一次性 O(1) 点查，而版本筛选是集合查询，代价差异很大。
--   同时把 version 提升为独立列后，它才能参与索引与约束 —— 这才是本迁移的目的。
--
-- 数据回填：从已有 manifest JSON 抽取。抽不出（manifest 非合法 JSON 或无 version）
-- 的行留 NULL —— 不猜、不填占位符。NULL 语义明确为「版本未知」。
--
-- 维护说明：安装/更新插件的路径（installPlugin / installPluginFromZip /
-- updatePluginFromZip）需同步写入该列，否则新装插件的 version 仍为 NULL。
-- 读路径已兼容 NULL：既有代码从 manifest JSON 读 version，本列是**加速索引**，
-- 不是唯一真源 —— 这样即使某条写入路径漏了也不会造成功能回归。

ALTER TABLE plugins ADD COLUMN version TEXT;

-- 回填：从 manifest JSON 抽取。
-- 实测：UPDATE ... WHERE json_valid(manifest) 会先过滤再求值，脏行被跳过、不会中断整表；
-- 真正会被脏行炸掉的是下面的**表达式索引**（建索引必须逐行求值），故那里用部分索引。
UPDATE plugins
   SET version = json_extract(manifest, '$.version')
 WHERE json_valid(manifest)
   AND json_extract(manifest, '$.version') IS NOT NULL;

-- 索引：版本筛选 + 排序（社区市场「按版本列出」、兼容性检查「找出低于 X 的插件」）
CREATE INDEX IF NOT EXISTS idx_plugins_version ON plugins(version);

-- manifest.id 是逻辑主键（DB 主键是 UUID），PluginHost.resolvePluginUuid 按它查。
--
-- 必须用**部分索引**：`json_extract()` 遇到非法 JSON 会抛 `malformed JSON`，
-- 而建表达式索引时 SQLite 会对**每一行**求值 —— 一条脏数据就让整条 DDL 失败。
-- 实测（SQLite 3.53.2）：
--   无条件表达式索引 → 抛错 "malformed JSON"
--   带 WHERE json_valid(manifest) 的部分索引 → 通过
--
-- 刻意**不**采用「先把非法 manifest 改写成 {}」的替代方案：那会销毁损坏数据的现场。
-- manifest 理论上只由本宿主写入（JSON.stringify），脏行意味着另有原因，
-- 不该被本迁移顺手掩盖。
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_id
  ON plugins(json_extract(manifest, '$.id'))
  WHERE json_valid(manifest);

-- DOWN
DROP INDEX IF EXISTS idx_plugins_manifest_id;
DROP INDEX IF EXISTS idx_plugins_version;
-- SQLite 3.35+ 支持 DROP COLUMN；旧版走表重建兜底由 migrate 层处理
ALTER TABLE plugins DROP COLUMN version;