-- UP
-- 班级临时口令改为 AES-256-GCM 密文（前缀 olenc1:）。
-- 纯 SQL 拿不到 ENCRYPTION_KEY，真正的加密在启动时由
-- encryptStoredClassPasscodes() 完成：已是 olenc1: 密文的行跳过，可重复执行。
-- 本表只用于在 _migrations 之外留下「这一列已经按密文约定存储」的标记。

CREATE TABLE IF NOT EXISTS _class_passcode_encryption (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  note TEXT NOT NULL
);

INSERT OR IGNORE INTO _class_passcode_encryption (id, note)
VALUES (1, 'class_passcode is sealed with olenc1: AES-256-GCM. plaintext rows are encrypted on startup');

-- DOWN
-- 不能在 SQL 里把密文还原成明文（需要 ENCRYPTION_KEY，而且会重新暴露口令）。
-- 回滚应用代码前，请改用迁移前的数据库快照。已加密的 class_passcode 保持不动。
DROP TABLE IF EXISTS _class_passcode_encryption;
