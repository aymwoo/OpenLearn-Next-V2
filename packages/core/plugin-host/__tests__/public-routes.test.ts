import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  approveDeclaredPublicRoutes,
  clearPublicRouteApprovals,
  declaredPublicRoutes,
  isPublicRouteApproved,
} from '../public-routes.js';
import { loadMigrationsFromDirectory, runMigrations } from '../../db/migrator.js';

const manifest = {
  id: 'ext-public',
  api: {
    routes: [
      { method: 'get', path: '/status', auth: false },
      { method: 'POST', path: '/submit', auth: true },
      { method: 'PUT', path: 'relative-nope', auth: false },
    ],
  },
};

describe('插件公开路由必须由管理员批准', () => {
  it('只收集 auth:false 且以 / 开头的路由', () => {
    expect(declaredPublicRoutes(manifest)).toEqual([{ method: 'GET', path: '/status' }]);
  });

  it('未批准时不放行，批准后按 method+path 放行，撤回后再次拒绝', () => {
    const db = new Database(':memory:');
    expect(isPublicRouteApproved(db, ['ext-public'], 'GET', '/status')).toBe(false);

    const approved = approveDeclaredPublicRoutes(db, ['uuid-1', 'ext-public'], manifest);
    expect(approved).toEqual(['GET /status']);
    expect(isPublicRouteApproved(db, ['uuid-1'], 'GET', '/status')).toBe(true);
    expect(isPublicRouteApproved(db, ['ext-public'], 'get', '/status')).toBe(true);
    expect(isPublicRouteApproved(db, ['ext-public'], 'POST', '/submit')).toBe(false);
    expect(isPublicRouteApproved(db, ['someone-else'], 'GET', '/status')).toBe(false);

    clearPublicRouteApprovals(db, ['ext-public', 'uuid-1']);
    expect(isPublicRouteApproved(db, ['ext-public'], 'GET', '/status')).toBe(false);
    db.close();
  });

  it('迁移 022 创建 plugin_public_routes', () => {
    const db = new Database(':memory:');
    const migrations = loadMigrationsFromDirectory(path.resolve(process.cwd(), 'migrations'));
    expect(migrations.map((item) => item.name)).toContain('022_plugin_public_routes');
    runMigrations(db, migrations);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('plugin_public_routes');
    expect(row).toBeTruthy();
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'migrations/022_plugin_public_routes.sql'), 'utf8');
    expect(sql).toMatch(/DROP TABLE IF EXISTS plugin_public_routes/);
    db.close();
  });
});
