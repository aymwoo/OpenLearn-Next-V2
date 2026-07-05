/**
 * ConfigService 单元测试（V3.0）。
 */
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '../config-service.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';

function makeManifest(configProps?: Record<string, any>): Manifest {
  return {
    id: 'ext-test',
    name: 'Test Plugin',
    version: '1.0.0',
    main: 'index.js',
    configuration: configProps ? { properties: configProps } : undefined,
  };
}

describe('ConfigService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('get 返回 schema 声明的默认值', () => {
    const manifest = makeManifest({
      maxQuestions: { type: 'number', default: 50 },
      title: { type: 'string', default: 'Quiz' },
    });
    const svc = new ConfigService(db, manifest);

    expect(svc.get('maxQuestions')).toBe(50);
    expect(svc.get('title')).toBe('Quiz');
  });

  it('get 返回 undefined（无默认值也无 DB 值时）', () => {
    const manifest = makeManifest({
      maxQuestions: { type: 'number' },
    });
    const svc = new ConfigService(db, manifest);

    expect(svc.get('maxQuestions')).toBeUndefined();
  });

  it('set + get 持久化并读取', async () => {
    const manifest = makeManifest({
      maxQuestions: { type: 'number', default: 50 },
    });
    const svc = new ConfigService(db, manifest);

    await svc.set('maxQuestions', 100);
    expect(svc.get('maxQuestions')).toBe(100);
  });

  it('set 校验类型 — string 不接受 number', async () => {
    const manifest = makeManifest({
      title: { type: 'string' },
    });
    const svc = new ConfigService(db, manifest);

    await expect(svc.set('title', 123)).rejects.toThrow('must be string');
  });

  it('set 校验类型 — number 不接受 string', async () => {
    const manifest = makeManifest({
      limit: { type: 'number' },
    });
    const svc = new ConfigService(db, manifest);

    await expect(svc.set('limit', 'abc')).rejects.toThrow('must be number');
  });

  it('set 校验 integer', async () => {
    const manifest = makeManifest({
      count: { type: 'integer' },
    });
    const svc = new ConfigService(db, manifest);

    await svc.set('count', 42);
    expect(svc.get('count')).toBe(42);

    await expect(svc.set('count', 3.14)).rejects.toThrow('must be integer');
  });

  it('set 校验 minimum/maximum', async () => {
    const manifest = makeManifest({
      score: { type: 'number', minimum: 0, maximum: 100 },
    });
    const svc = new ConfigService(db, manifest);

    await svc.set('score', 50);
    await expect(svc.set('score', -1)).rejects.toThrow('minimum');
    await expect(svc.set('score', 101)).rejects.toThrow('maximum');
  });

  it('set 校验 enum', async () => {
    const manifest = makeManifest({
      mode: { type: 'string', enum: ['easy', 'hard'] },
    });
    const svc = new ConfigService(db, manifest);

    await svc.set('mode', 'easy');
    await expect(svc.set('mode', 'extreme')).rejects.toThrow('enum');
  });

  it('set 拒绝未声明的 key', async () => {
    const manifest = makeManifest(); // 无配置声明
    const svc = new ConfigService(db, manifest);

    await expect(svc.set('secret', 'value')).rejects.toThrow('Unknown config key');
  });

  it('getAll 返回所有配置值', () => {
    const manifest = makeManifest({
      a: { type: 'number', default: 1 },
      b: { type: 'string', default: 'hello' },
    });
    const svc = new ConfigService(db, manifest);

    const all = svc.getAll();
    expect(all.a).toBe(1);
    expect(all.b).toBe('hello');
  });

  it('loadFromDB 从持久化存储恢复值', async () => {
    // Pre-populate DB
    db.prepare(
      'INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
    ).run('ext-test', 'config:maxQuestions', JSON.stringify(75), Date.now());

    const manifest = makeManifest({
      maxQuestions: { type: 'number', default: 50 },
    });
    const svc = new ConfigService(db, manifest);
    svc.loadFromDB();

    expect(svc.get('maxQuestions')).toBe(75); // DB 值覆盖默认值
  });

  it('onChange 监听配置变更', async () => {
    const manifest = makeManifest({
      theme: { type: 'string', default: 'light' },
    });
    const svc = new ConfigService(db, manifest);

    const calls: Array<{ key: string; newValue: unknown; oldValue: unknown }> = [];
    svc.onChange((key, newValue, oldValue) => {
      calls.push({ key, newValue, oldValue });
    });

    await svc.set('theme', 'dark');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ key: 'theme', newValue: 'dark', oldValue: undefined });
  });

  it('hasKey 检查 key 是否已声明', () => {
    const manifest = makeManifest({ limit: { type: 'number' } });
    const svc = new ConfigService(db, manifest);

    expect(svc.hasKey('limit')).toBe(true);
    expect(svc.hasKey('unknown')).toBe(false);
  });
});
