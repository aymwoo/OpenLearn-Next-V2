/**
 * @vitest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkReadiness,
  livenessBody,
  listMigrationNames,
  migrationsComplete,
  probeStorageWritable,
  readinessBody,
} from '../health.js';
import {
  OPERATIONAL_GAUGE_CACHE_MS,
  recordHttpResponse,
  renderPrometheusMetrics,
  resetPrometheusMetricsForTests,
  takeOperationalGaugeSample,
} from '../metrics.js';

let tmp: string;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('就绪检查', () => {
  it('存储可写、迁移齐全时就绪，响应不含内部细节', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-ready-'));
    const migrationsDir = path.join(tmp, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, '001_init.sql'), '-- up\nSELECT 1;\n');
    const result = checkReadiness({
      pingDatabase: () => undefined,
      storageDir: path.join(tmp, 'storage'),
      migrationsDir,
      appliedMigrations: () => ['001_init'],
    });
    expect(result.ok).toBe(true);
    expect(probeStorageWritable(path.join(tmp, 'storage'))).toBe(true);
    expect(JSON.stringify(readinessBody(true))).toBe('{"status":"ready"}');
    expect(JSON.stringify(livenessBody(3, '0.6.1'))).not.toContain('wal');
    expect(listMigrationNames(migrationsDir)).toEqual(['001_init']);
  });

  it('数据库、存储或迁移任一失败则不就绪', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-ready-'));
    const migrationsDir = path.join(tmp, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, '002_more.sql'), '-- up\n');
    expect(
      checkReadiness({
        pingDatabase: () => {
          throw new Error('sqlite busy password=secret');
        },
        storageDir: path.join(tmp, 'storage'),
        migrationsDir,
        appliedMigrations: () => [],
      }).reason,
    ).toBe('database');

    const fileAsDir = path.join(tmp, 'not-a-dir');
    fs.writeFileSync(fileAsDir, 'x');
    expect(probeStorageWritable(fileAsDir)).toBe(false);

    const pending = migrationsComplete(['002_more'], []);
    expect(pending.ok).toBe(false);
    expect(pending.pendingMigrations).toEqual(['002_more']);
    expect(JSON.stringify(readinessBody(false))).toBe('{"status":"not_ready"}');
    expect(migrationsComplete(null, [])).toEqual({ ok: false, reason: 'migrations' });
  });

  it('库里有当前构建不认识的迁移名时不就绪，名字只进日志', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = migrationsComplete(['001_init'], ['001_init', '099_from_the_future']);
      expect(result).toEqual({ ok: false, reason: 'migrations' });
      expect(JSON.stringify(result)).not.toContain('099_from_the_future');
      expect(JSON.stringify(readinessBody(result.ok))).toBe('{"status":"not_ready"}');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('099_from_the_future'));

      warn.mockClear();
      expect(migrationsComplete(['001_init'], ['001_init.sql'])).toEqual({ ok: true });
      expect(migrationsComplete(['001_init'], ['001_init\r'])).toEqual({ ok: true });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('Prometheus 指标', () => {
  it('按状态类计数，不包含请求路径', () => {
    resetPrometheusMetricsForTests();
    recordHttpResponse(200);
    recordHttpResponse(503);
    const text = renderPrometheusMetrics(Date.now());
    expect(text).toContain('openlearn_up 1');
    expect(text).toContain('openlearn_http_responses_total{status_class="2xx"} 1');
    expect(text).toContain('openlearn_http_responses_total{status_class="5xx"} 1');
    expect(text).toContain('openlearn_migrations_pending -1');
    expect(text).toContain('openlearn_backup_age_seconds -1');
    expect(text).toContain('openlearn_events_rows -1');
    expect(text).not.toContain('/api/');
    expect(text).not.toMatch(/[/\\]/);
  });

  it('渲染迁移积压、备份年龄和 events 行数，非有限数记为 -1', () => {
    const text = renderPrometheusMetrics(1_700_000_000_000, {
      migrationsPending: 2,
      backupAgeSeconds: 125,
      eventsRows: 3.9,
    });
    expect(text).toContain('# TYPE openlearn_migrations_pending gauge');
    expect(text).toContain('openlearn_migrations_pending 2');
    expect(text).toContain('# TYPE openlearn_backup_age_seconds gauge');
    expect(text).toContain('openlearn_backup_age_seconds 125');
    expect(text).toContain('# TYPE openlearn_events_rows gauge');
    expect(text).toContain('openlearn_events_rows 3');
    expect(text).not.toMatch(/[/\\]/);

    const unknown = renderPrometheusMetrics(1_700_000_000_000, {
      migrationsPending: Number.NaN,
      backupAgeSeconds: Number.POSITIVE_INFINITY,
      eventsRows: Number.NEGATIVE_INFINITY,
    });
    expect(unknown).toContain('openlearn_migrations_pending -1');
    expect(unknown).toContain('openlearn_backup_age_seconds -1');
    expect(unknown).toContain('openlearn_events_rows -1');
  });

  it('运维 gauge 在缓存窗口内复用同一样本', () => {
    let loads = 0;
    const load = () => {
      loads += 1;
      return { migrationsPending: loads, backupAgeSeconds: 10, eventsRows: 4 };
    };
    const first = takeOperationalGaugeSample(null, 1_000, load, OPERATIONAL_GAUGE_CACHE_MS);
    const second = takeOperationalGaugeSample(first, 1_000 + OPERATIONAL_GAUGE_CACHE_MS - 1, load);
    expect(second).toBe(first);
    expect(loads).toBe(1);
    expect(first.sample.migrationsPending).toBe(1);

    const refreshed = takeOperationalGaugeSample(first, 1_000 + OPERATIONAL_GAUGE_CACHE_MS, load);
    expect(refreshed.sample.migrationsPending).toBe(2);
    expect(loads).toBe(2);

    const rewound = takeOperationalGaugeSample(refreshed, 500, load);
    expect(rewound.sample.migrationsPending).toBe(3);

    takeOperationalGaugeSample(rewound, 500, load, 0);
    expect(loads).toBe(4);
  });
});
