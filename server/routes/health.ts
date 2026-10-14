import type { Express, Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { checkReadiness, livenessBody, readinessBody } from '../../packages/core/observability/health.js';
import { renderPrometheusMetrics } from '../../packages/core/observability/metrics.js';
import { PLATFORM_VERSION } from '../../packages/core/version.js';
import { getStorageDir } from '../utils/paths.js';
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
}

/**
 * 注册平台存活探针 (Liveness)、就绪探针 (Readiness) 与 Prometheus 监控指标端点
 */
export function registerHealthRoutes(app: Express, options?: HealthRoutesOptions): void {
  const startTime = options?.startTime ?? Date.now();
  const platformVersion = options?.platformVersion ?? PLATFORM_VERSION;
  const migrationsDir = options?.migrationsDir ?? path.join(process.cwd(), 'migrations');
  const storageDir = options?.storageDir ?? getStorageDir();

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
      res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(renderPrometheusMetrics());
    },
  );
}
