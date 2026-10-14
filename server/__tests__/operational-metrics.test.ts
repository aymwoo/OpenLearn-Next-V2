/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { collectOperationalGaugeSample, registerHealthRoutes } from '../routes/health.js';

const SECRET_DIR = 'ol-r17-secret-backup-dir';

let tmp = '';
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers) {
    server.close();
  }
  servers.length = 0;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

function listen(app: express.Express): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('expected a tcp port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('运维 gauge 采样', () => {
  it('统计未应用迁移、最新备份年龄和 events 行数，失败时为 -1 且不含路径', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-r17-'));
    const migrationsDir = path.join(tmp, 'migrations');
    const backupDir = path.join(tmp, SECRET_DIR);
    fs.mkdirSync(migrationsDir);
    fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(migrationsDir, '001_init.sql'), '-- UP\nSELECT 1;\n');
    fs.writeFileSync(path.join(migrationsDir, '002_more.sql'), '-- UP\nSELECT 1;\n');
    fs.writeFileSync(path.join(migrationsDir, 'README.txt'), 'not a migration');

    const now = 1_700_000_000_000;
    const newer = path.join(backupDir, 'backup_new.db');
    const older = path.join(backupDir, 'backup_old.db');
    fs.writeFileSync(newer, 'new');
    fs.writeFileSync(older, 'old');
    fs.mkdirSync(path.join(backupDir, 'nested'));
    fs.utimesSync(newer, (now - 125_000) / 1000, (now - 125_000) / 1000);
    fs.utimesSync(older, (now - 800_000) / 1000, (now - 800_000) / 1000);
    try {
      fs.symlinkSync(path.join(backupDir, 'missing-target'), path.join(backupDir, 'broken-link'));
    } catch {
      // 无法创建符号链接时，其余条目仍应给出最新文件的年龄。
    }

    const sample = collectOperationalGaugeSample({
      migrationsDir,
      backupDir,
      appliedMigrations: () => ['001_init', '009_extra_applied'],
      countEvents: () => 12,
      now,
    });
    expect(sample.migrationsPending).toBe(1);
    expect(sample.backupAgeSeconds).toBe(125);
    expect(sample.eventsRows).toBe(12);
    expect(JSON.stringify(sample)).not.toContain(SECRET_DIR);
    expect(JSON.stringify(sample)).not.toContain('Error');

    const future = path.join(backupDir, 'backup_future.db');
    fs.writeFileSync(future, 'future');
    fs.utimesSync(future, (now + 30_000) / 1000, (now + 30_000) / 1000);
    expect(
      collectOperationalGaugeSample({
        migrationsDir,
        backupDir,
        appliedMigrations: () => ['001_init', '002_more'],
        countEvents: () => 0,
        now,
      }).backupAgeSeconds,
    ).toBe(0);

    expect(
      collectOperationalGaugeSample({
        migrationsDir,
        backupDir: path.join(tmp, 'missing-backups'),
        appliedMigrations: () => {
          throw new Error(`sqlite busy ${backupDir}`);
        },
        countEvents: () => {
          throw new Error(`no such table: events at ${migrationsDir}`);
        },
        now,
      }),
    ).toEqual({ migrationsPending: -1, backupAgeSeconds: -1, eventsRows: -1 });

    expect(
      collectOperationalGaugeSample({
        migrationsDir: path.join(tmp, 'missing-migrations'),
        backupDir,
        appliedMigrations: () => ['001_init', '002_more'],
        countEvents: () => 3,
        now,
      }).migrationsPending,
    ).toBe(-1);

    const emptyBackup = path.join(tmp, 'empty-backups');
    fs.mkdirSync(emptyBackup);
    const fileAsDir = path.join(tmp, 'not-a-backup-dir');
    fs.writeFileSync(fileAsDir, 'x');
    expect(
      collectOperationalGaugeSample({
        migrationsDir: emptyBackup,
        backupDir: emptyBackup,
        appliedMigrations: () => [],
        countEvents: () => Number.NaN,
        now,
      }),
    ).toEqual({ migrationsPending: -1, backupAgeSeconds: -1, eventsRows: -1 });
    expect(
      collectOperationalGaugeSample({
        migrationsDir,
        backupDir: fileAsDir,
        appliedMigrations: () => ['001_init', '002_more'],
        countEvents: () => 1,
        now,
      }).backupAgeSeconds,
    ).toBe(-1);
  });
});

describe('GET /metrics 运维 gauge', () => {
  it('匿名访问仍是 401，授权文本包含新序列且不泄露路径', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-r17-http-'));
    const migrationsDir = path.join(tmp, 'migrations');
    const backupDir = path.join(tmp, SECRET_DIR);
    const storageDir = path.join(tmp, 'storage');
    fs.mkdirSync(migrationsDir);
    fs.mkdirSync(backupDir);
    fs.writeFileSync(path.join(migrationsDir, '001_init.sql'), '-- UP\nSELECT 1;\n');
    const backupFile = path.join(backupDir, 'backup.db');
    fs.writeFileSync(backupFile, 'db');
    const stamped = Date.now() - 90_000;
    fs.utimesSync(backupFile, stamped / 1000, stamped / 1000);

    let eventReads = 0;
    let eventRows = 7;
    const app = express();
    registerHealthRoutes(app, {
      metricsToken: 'secret-token-2026',
      migrationsDir,
      backupDir,
      storageDir,
      pingDatabase: () => undefined,
      getAppliedMigrations: () => ['001_init'],
      countEvents: () => {
        eventReads += 1;
        return eventRows;
      },
      operationalGaugeTtlMs: 60_000,
    });

    const baseUrl = await listen(app);
    const anon = await fetch(`${baseUrl}/metrics`);
    expect(anon.status).toBe(401);
    expect(await anon.text()).not.toContain(SECRET_DIR);
    expect(eventReads).toBe(0);

    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'ready' });

    const first = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: 'Bearer secret-token-2026' },
    });
    expect(first.status).toBe(200);
    const text = await first.text();
    expect(text).toContain('openlearn_migrations_pending 0');
    expect(text).toContain('openlearn_events_rows 7');
    expect(text).toContain('openlearn_backup_age_seconds');
    expect(text).not.toContain(SECRET_DIR);
    expect(text).not.toContain(migrationsDir);
    expect(text).not.toContain('Error');
    const age = Number(text.match(/openlearn_backup_age_seconds (-?\d+)/)?.[1]);
    expect(age).toBeGreaterThanOrEqual(80);
    expect(age).toBeLessThan(180);

    eventRows = 99;
    const second = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: 'Bearer secret-token-2026' },
    });
    expect(await second.text()).toContain('openlearn_events_rows 7');
    expect(eventReads).toBe(1);

    const fresh = express();
    registerHealthRoutes(fresh, {
      metricsToken: 'secret-token-2026',
      migrationsDir,
      backupDir,
      countEvents: () => eventRows,
      operationalGaugeTtlMs: 0,
    });
    const freshUrl = await listen(fresh);
    const third = await fetch(`${freshUrl}/metrics`, {
      headers: { Authorization: 'Bearer secret-token-2026' },
    });
    expect(await third.text()).toContain('openlearn_events_rows 99');
  });

  it('缺省采集能读到 events 行数，且不改变就绪响应体', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-r17-default-'));
    const app = express();
    registerHealthRoutes(app, {
      metricsToken: 'secret-token-2026',
      operationalGaugeTtlMs: 0,
      pingDatabase: () => undefined,
      storageDir: tmp,
    });
    const baseUrl = await listen(app);

    const ready = await fetch(`${baseUrl}/health/ready`);
    const readyBody = await ready.json();
    expect(Object.keys(readyBody)).toEqual(['status']);
    expect(readyBody.status === 'ready' || readyBody.status === 'not_ready').toBe(true);

    const metrics = await fetch(`${baseUrl}/metrics`, {
      headers: { Authorization: 'Bearer secret-token-2026' },
    });
    expect(metrics.status).toBe(200);
    const text = await metrics.text();
    const events = Number(text.match(/openlearn_events_rows (-?\d+)/)?.[1]);
    const pending = Number(text.match(/openlearn_migrations_pending (-?\d+)/)?.[1]);
    expect(events).toBeGreaterThanOrEqual(0);
    expect(pending).toBeGreaterThanOrEqual(0);
    expect(text).toContain('openlearn_backup_age_seconds');
  });
});
