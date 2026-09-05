import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  splitSqlStatements,
  parseMigrationSql,
  loadMigrationsFromDirectory,
  runMigrations,
  rollbackMigration,
  sqlMigration,
} from '../utils/migrate.js';

describe('Database Migration Runner (DB-MIG-01)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  describe('splitSqlStatements', () => {
    it('splits SQL string into non-empty statements and strips comments', () => {
      const sql = `
        -- First table
        CREATE TABLE t1 (id INT PRIMARY KEY);

        -- Second table
        CREATE TABLE t2 (
          id INT PRIMARY KEY,
          name TEXT
        );
      `;
      const stmts = splitSqlStatements(sql);
      expect(stmts).toHaveLength(2);
      expect(stmts[0]).toContain('CREATE TABLE t1');
      expect(stmts[1]).toContain('CREATE TABLE t2');
    });

    it('ignores empty trailing semicolons and pure comment blocks', () => {
      const sql = `
        -- Only comments here
        -- another comment
        ;
        CREATE TABLE t3 (id INT);
        ;
      `;
      const stmts = splitSqlStatements(sql);
      expect(stmts).toHaveLength(1);
      expect(stmts[0]).toContain('CREATE TABLE t3');
    });
  });

  describe('parseMigrationSql', () => {
    it('parses UP and DOWN sections correctly', () => {
      const raw = `
        -- UP
        CREATE TABLE foo (id INT);
        -- DOWN
        DROP TABLE foo;
      `;
      const parsed = parseMigrationSql('001_foo', raw);
      expect(parsed.name).toBe('001_foo');
      expect(parsed.up).toBe('CREATE TABLE foo (id INT);');
      expect(parsed.down).toBe('DROP TABLE foo;');
    });

    it('falls back to entire content as UP when no markers present', () => {
      const raw = `CREATE TABLE bar (id INT);`;
      const parsed = parseMigrationSql('002_bar', raw);
      expect(parsed.name).toBe('002_bar');
      expect(parsed.up).toBe('CREATE TABLE bar (id INT);');
      expect(parsed.down).toBe('');
    });
  });

  describe('loadMigrationsFromDirectory', () => {
    it('reads and sorts .sql files from disk', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
      fs.writeFileSync(path.join(tmpDir, '002_second.sql'), '-- UP\nCREATE TABLE s2 (id INT);');
      fs.writeFileSync(path.join(tmpDir, '001_first.sql'), '-- UP\nCREATE TABLE s1 (id INT);');
      fs.writeFileSync(path.join(tmpDir, 'not_sql.txt'), 'ignore me');

      const loaded = loadMigrationsFromDirectory(tmpDir);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].name).toBe('001_first');
      expect(loaded[1].name).toBe('002_second');

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array if directory does not exist', () => {
      const loaded = loadMigrationsFromDirectory('/non/existent/path/for/sure');
      expect(loaded).toEqual([]);
    });
  });

  describe('runMigrations & rollbackMigration', () => {
    it('creates _migrations table and executes unapplied migrations', () => {
      const migrations = [
        sqlMigration('001_test', 'CREATE TABLE test_tbl (id INT, val TEXT);', 'DROP TABLE test_tbl;'),
        sqlMigration('002_test', 'ALTER TABLE test_tbl ADD COLUMN extra TEXT;', ''),
      ];

      runMigrations(db, migrations);

      // Verify table exists
      const tableInfo = db.prepare("PRAGMA table_info(test_tbl)").all() as any[];
      expect(tableInfo.some(col => col.name === 'extra')).toBe(true);

      // Verify _migrations has 2 records
      const applied = db.prepare('SELECT name FROM _migrations ORDER BY name').all() as any[];
      expect(applied.map(a => a.name)).toEqual(['001_test', '002_test']);
    });

    it('is idempotent on subsequent runs', () => {
      const migrations = [
        sqlMigration('001_test', 'CREATE TABLE test_tbl (id INT);', 'DROP TABLE test_tbl;'),
      ];

      runMigrations(db, migrations);
      // Run again - should not throw table already exists
      expect(() => runMigrations(db, migrations)).not.toThrow();

      const count = (db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get() as any).cnt;
      expect(count).toBe(1);
    });

    it('safely handles duplicate column name error if column was already present', () => {
      // Pre-create table with extra column
      db.exec('CREATE TABLE test_col (id INT, status TEXT);');

      // Migration attempts to add status column
      const migrations = [
        sqlMigration('001_add_status', 'ALTER TABLE test_col ADD COLUMN status TEXT;', ''),
      ];

      expect(() => runMigrations(db, migrations)).not.toThrow();
      const applied = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('001_add_status');
      expect(applied).toBeDefined();
    });

    it('throws error and halts on invalid SQL', () => {
      const migrations = [
        sqlMigration('001_bad', 'INVALID SQL COMMAND HERE;', ''),
      ];

      expect(() => runMigrations(db, migrations)).toThrow();
      // Should not record in _migrations
      const applied = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'").get();
      if (applied) {
        const count = (db.prepare('SELECT COUNT(*) as cnt FROM _migrations').get() as any).cnt;
        expect(count).toBe(0);
      }
    });

    it('rolls back a migration using down script', () => {
      const m1 = sqlMigration('001_test', 'CREATE TABLE roll_tbl (id INT);', 'DROP TABLE roll_tbl;');
      runMigrations(db, [m1]);

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roll_tbl'").get()).toBeDefined();

      rollbackMigration(db, m1);

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roll_tbl'").get()).toBeUndefined();
      const applied = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('001_test');
      expect(applied).toBeUndefined();
    });

    it('throws error when rolling back migration with empty down script', () => {
      const m1 = sqlMigration('001_no_down', 'CREATE TABLE nodown (id INT);', '');
      runMigrations(db, [m1]);

      expect(() => rollbackMigration(db, m1)).toThrow(/does not provide a DOWN rollback script/);
    });
  });

  describe('Real migrations/ folder integration', () => {
    it('successfully loads and applies all migrations from migrations/ directory', () => {
      const projectMigrationsDir = path.resolve(__dirname, '../../migrations');
      const migrations = loadMigrationsFromDirectory(projectMigrationsDir);

      expect(migrations.length).toBeGreaterThanOrEqual(4);
      expect(migrations.map(m => m.name)).toEqual(
        expect.arrayContaining([
          '000_initial_schema',
          '001_add_execution_mode',
          '002_add_client_session_expiry',
          '003_classroom_runtime',
        ])
      );

      // Run on fresh database
      expect(() => runMigrations(db, migrations)).not.toThrow();

      // Check key tables
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
      expect(tables).toContain('lessons');
      expect(tables).toContain('plugins');
      expect(tables).toContain('student_rollcalls');
      expect(tables).toContain('site_settings');
      expect(tables).toContain('agent_conversations');
      expect(tables).toContain('_migrations');

      // Check key columns added by later migrations
      const pluginCols = (db.prepare('PRAGMA table_info(plugins)').all() as any[]).map(c => c.name);
      expect(pluginCols).toContain('execution_mode');

      const sessionCols = (db.prepare('PRAGMA table_info(client_sessions)').all() as any[]).map(c => c.name);
      expect(sessionCols).toContain('expires_at');
    });
  });
});
