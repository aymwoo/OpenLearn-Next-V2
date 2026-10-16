import { describe, it, expect } from 'vitest';
import { assertPluginSqlAllowed, sanitizeSql, extractReferencedTables } from '../sql-guard.js';

describe('sql-guard 深度安全校验', () => {
  const ownPrefix = 'plugin_abc_';

  describe('绕过手段阻断测试', () => {
    it('阻断标准 SELECT 跨表访问核心表 users', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM users',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);
    });

    it('阻断逗号连接多表绕过 (SELECT * FROM own_table, users)', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM plugin_abc_table, users',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);
    });

    it('阻断注释混淆绕过 (SELECT * FROM/**/users)', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM/**/users',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);
    });

    it('阻断方括号包裹绕过 (SELECT * FROM [users])', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM [users]',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);
    });

    it('阻断 UPDATE 注释混淆绕过 (UPDATE/**/users SET password_hash=1)', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'UPDATE/**/users SET password_hash=1',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);
    });

    it('阻断其他插件的私有表访问 (SELECT * FROM plugin_other_data)', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM plugin_other_data',
          ownPrefix,
        }),
      ).toThrowError(/not permitted/i);
    });

    it('阻断利用注释窃取全库 sqlite_master 的伪造查询', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: '/* plugin_abc_ */ SELECT sql FROM sqlite_master',
          ownPrefix,
        }),
      ).toThrowError(/metadata table/i);
    });

    it('阻断底层高危操作 ATTACH / PRAGMA', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'ATTACH DATABASE "/tmp/evil.db" AS evil',
          ownPrefix,
        }),
      ).toThrowError(/Dangerous statement/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'PRAGMA table_info(users)',
          ownPrefix,
        }),
      ).toThrowError(/Dangerous statement/i);
    });

    it('阻断子查询与括号包裹表名绕过 (SELECT * FROM (SELECT * FROM users) / FROM (users))', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM (SELECT * FROM users)',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM (users)',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM (SELECT * FROM plugin_abc_items WHERE id = 1) t1, users',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM (SELECT * FROM plugin_other_secret)',
          ownPrefix,
        }),
      ).toThrowError(/not permitted/i);
    });

    it('阻断 UPDATE OR IGNORE 与 ALTER TABLE RENAME TO 跨命名空间绕过', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'UPDATE OR IGNORE users SET role = "administrator"',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'ALTER TABLE plugin_abc_items RENAME TO users',
          ownPrefix,
        }),
      ).toThrowError(/strictly forbidden/i);

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'ALTER TABLE plugin_abc_items RENAME TO plugin_other_items',
          ownPrefix,
        }),
      ).toThrowError(/not permitted/i);
    });
  });

  describe('合法语法与边界放行测试', () => {
    it('允许对自己命名空间表的 SELECT / INSERT / UPDATE / DELETE', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM plugin_abc_items WHERE id = 1',
          ownPrefix,
        }),
      ).not.toThrow();

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'INSERT INTO plugin_abc_items (id, name) VALUES (1, "test")',
          ownPrefix,
        }),
      ).not.toThrow();

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'UPDATE plugin_abc_items SET name = "ok" WHERE id = 1',
          ownPrefix,
        }),
      ).not.toThrow();

      expect(() =>
        assertPluginSqlAllowed({
          sql: 'DELETE FROM plugin_abc_items WHERE id = 1',
          ownPrefix,
        }),
      ).not.toThrow();
    });

    it('允许对 plugin_migrations 共享迁移表的操作', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT * FROM plugin_migrations WHERE plugin_id = ?',
          ownPrefix,
        }),
      ).not.toThrow();
    });

    it('允许合法的精确 dropAllTables 式 sqlite_master 查询', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'plugin_abc_%'",
          ownPrefix,
        }),
      ).not.toThrow();
    });

    it('合法列名包含 users 字样时不应被误杀', () => {
      expect(() =>
        assertPluginSqlAllowed({
          sql: 'SELECT users, score FROM plugin_abc_stats WHERE users > 10',
          ownPrefix,
        }),
      ).not.toThrow();
    });
  });
});
