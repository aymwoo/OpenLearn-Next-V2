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
import { renderPrometheusMetrics, resetPrometheusMetricsForTests, recordHttpResponse } from '../metrics.js';

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
    expect(text).not.toContain('/api/');
  });
});
