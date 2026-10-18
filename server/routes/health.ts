import type { Express, Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkReadiness,
  listMigrationNames,
  livenessBody,
  readinessBody,
} from '../../packages/core/observability/health.js';
import {
  OPERATIONAL_GAUGE_CACHE_MS,
  OPERATIONAL_GAUGE_UNKNOWN,
  renderPrometheusMetrics,
  takeOperationalGaugeSample,
  type OperationalGaugeCacheEntry,
  type OperationalGaugeSample,
} from '../../packages/core/observability/metrics.js';
import { renderPluginMetrics } from '../../packages/core/observability/plugin-metrics.js';
import { PLATFORM_VERSION } from '../../packages/core/version.js';
import { getBackupsDir, getStorageDir } from '../utils/paths.js';
import { requireAuth } from '../middleware/auth.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export interface HealthRoutesOptions {
  startTime?: number;
  platformVersion?: string;
  migrationsDir?: string;
  storageDir?: string;
  pingDatabase?: () => void;
  getAppliedMigrations?: () => string[];
  metricsToken?: string;
  /** 备份目录。缺省为 `getBackupsDir()`（`BACKUP_DIR` 或数据目录下的 `backups`）。 */
  backupDir?: string;
  /** `events` 行数。缺省执行 `SELECT COUNT(*) FROM events`。 */
  countEvents?: () => number;
  /** 运维 gauge 缓存毫秒数。缺省 15000。`0` 表示每次抓取都重新查询。 */
  operationalGaugeTtlMs?: number;
}

export interface OperationalGaugeQuery {
  migrationsDir: string;
  backupDir: string;
  appliedMigrations: () => string[];
  countEvents: () => number;
  now?: number;
}

function asUnknownGauge(value: number): number {
  if (!Number.isFinite(value)) return OPERATIONAL_GAUGE_UNKNOWN;
  return Math.trunc(value);
}

function countPendingMigrations(migrationsDir: string, appliedMigrations: () => string[]): number {
  const expected = listMigrationNames(migrationsDir);
  if (!expected) return OPERATIONAL_GAUGE_UNKNOWN;
  let applied: string[];
  try {
    applied = appliedMigrations();
  } catch {
    return OPERATIONAL_GAUGE_UNKNOWN;
  }
  const have = new Set(applied);
  return expected.filter((name) => !have.has(name)).length;
}

/** 备份目录里最新普通文件的年龄（秒）。目录不存在、没有文件、或读不出来时为 -1。不返回路径。 */
function newestBackupAgeSeconds(backupDir: string, now: number): number {
  let names: string[];
  try {
    if (!fs.existsSync(backupDir)) return OPERATIONAL_GAUGE_UNKNOWN;
    names = fs.readdirSync(backupDir);
  } catch {
    return OPERATIONAL_GAUGE_UNKNOWN;
  }

  let newestMs = Number.NEGATIVE_INFINITY;
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(backupDir, name));
      if (!stat.isFile()) continue;
      if (stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
    } catch {
      // 单个条目读失败时跳过，不把路径或错误文本写进指标。
    }
  }
  if (!Number.isFinite(newestMs)) return OPERATIONAL_GAUGE_UNKNOWN;
  return Math.max(0, Math.floor((now - newestMs) / 1000));
}

function countEventRows(countEvents: () => number): number {
  try {
    return asUnknownGauge(countEvents());
  } catch {
    return OPERATIONAL_GAUGE_UNKNOWN;
  }
}

/** 采集三项运维 gauge。单项失败互不影响，失败值是 -1，不携带路径或错误文本。 */
export function collectOperationalGaugeSample(query: OperationalGaugeQuery): OperationalGaugeSample {
  const now = query.now ?? Date.now();
  return {
    migrationsPending: countPendingMigrations(query.migrationsDir, query.appliedMigrations),
    backupAgeSeconds: newestBackupAgeSeconds(query.backupDir, now),
    eventsRows: countEventRows(query.countEvents),
  };
}

function defaultCountEvents(): number {
  const row = kernelContainer.db.prepare('SELECT COUNT(*) AS n FROM events').get() as
    { n: number | bigint } | undefined;
  if (!row) return OPERATIONAL_GAUGE_UNKNOWN;
  return Number(row.n);
}

/**
 * 注册平台存活探针 (Liveness)、就绪探针 (Readiness) 与 Prometheus 监控指标端点
 */
export function registerHealthRoutes(app: Express, options?: HealthRoutesOptions): void {
  const startTime = options?.startTime ?? Date.now();
  const platformVersion = options?.platformVersion ?? PLATFORM_VERSION;
  const migrationsDir = options?.migrationsDir ?? path.join(process.cwd(), 'migrations');
  const storageDir = options?.storageDir ?? getStorageDir();
  const backupDir = options?.backupDir ?? getBackupsDir();
  const countEvents = options?.countEvents ?? defaultCountEvents;
  const operationalGaugeTtlMs = options?.operationalGaugeTtlMs ?? OPERATIONAL_GAUGE_CACHE_MS;
  let gaugeCache: OperationalGaugeCacheEntry | null = null;

  const pingDb =
    options?.pingDatabase ??
    (() => {
      kernelContainer.db.prepare('SELECT 1').get();
    });

  const getMigrations =
    options?.getAppliedMigrations ??
    (() => {
      const rows = kernelContainer.db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
      return rows.map((r) => r.name);
    });

  // 1. 存活探针 (Liveness Probe)
  app.get('/health', (_req: Request, res: Response) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    res.json(livenessBody(uptimeSeconds, platformVersion));
  });

  // 2. 就绪探针 (Readiness Probe)
  app.get('/health/ready', (_req: Request, res: Response) => {
    const result = checkReadiness({
      pingDatabase: pingDb,
      storageDir,
      migrationsDir,
      appliedMigrations: getMigrations,
    });

    if (!result.ok) {
      console.warn(
        `[health] not ready: ${result.reason || 'unknown'}${
          result.pendingMigrations?.length ? ` pending=${result.pendingMigrations.join(',')}` : ''
        }`,
      );
      res.status(503).json(readinessBody(false));
      return;
    }

    res.json(readinessBody(true));
  });

  // 3. Prometheus 监控指标 (Metrics Probe)
  // 受保护端点：支持 METRICS_TOKEN Bearer 认证，或管理员身份 Session
  app.get(
    '/metrics',
    (req: Request, res: Response, next: NextFunction) => {
      const token = (options?.metricsToken ?? process.env.METRICS_TOKEN ?? '').trim();
      const header = req.headers.authorization;
      if (token && header === `Bearer ${token}`) {
        next();
        return;
      }
      requireAuth('administrator')(req, res, next);
    },
    (_req: Request, res: Response) => {
      const now = Date.now();
      const cached = takeOperationalGaugeSample(
        gaugeCache,
        now,
        () =>
          collectOperationalGaugeSample({
            migrationsDir,
            backupDir,
            appliedMigrations: getMigrations,
            countEvents,
            now,
          }),
        operationalGaugeTtlMs,
      );
      gaugeCache = cached;
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // Issue #150：进程级指标之后追加按插件维度指标（未安装插件时为空串）。
      const pluginMetrics = renderPluginMetrics();
      const body = pluginMetrics
        ? `${renderPrometheusMetrics(now, cached.sample)}\n${pluginMetrics}`
        : renderPrometheusMetrics(now, cached.sample);
      res.send(body);
    },
  );
}
