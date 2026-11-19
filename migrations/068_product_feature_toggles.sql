-- UP
-- 068_product_feature_toggles.sql
-- Mode Pack 与「Mode Pack 开启时显示学生平行学案页」改为设置项。
-- 两列必须保持 NULL 表示未配置：NULL 使用历史默认（都关闭），不能写成 0，
-- 否则无法区分「从未配置」与「管理员显式关闭」。
-- 不再读取 VITE_OPENLEARN_MODE_PACKS、window.__OPENLEARN_MODE_PACKS__
-- 或 window.__OPENLEARN_DEBUG_XUEAN_TAB__。

ALTER TABLE site_settings ADD COLUMN mode_packs_enabled INTEGER;
ALTER TABLE site_settings ADD COLUMN mode_pack_show_xuean_tab INTEGER;

-- DOWN
ALTER TABLE site_settings DROP COLUMN mode_pack_show_xuean_tab;
ALTER TABLE site_settings DROP COLUMN mode_packs_enabled;
