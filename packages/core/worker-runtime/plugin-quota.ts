/**
 * 子进程资源上限。V8 老生代由 --max-old-space-size 限制；
 * 这里补 RSS（含 Buffer 等 external 内存）和 CPU 时间。
 */

import fs from 'node:fs';

export const DEFAULT_MAX_RSS_MB = 512;
export const DEFAULT_CPU_QUOTA_MS = 8_000;
export const DEFAULT_CPU_WINDOW_MS = 10_000;

export function normalizePositiveInt(raw: unknown, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const text = String(raw).trim().toLowerCase();
  if (text === 'off' || text === '0' || text === 'none') return 0;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export function quotaLimits(env: NodeJS.ProcessEnv = process.env): {
  maxRssMb: number;
  cpuQuotaMs: number;
  cpuWindowMs: number;
} {
  return {
    maxRssMb: normalizePositiveInt(env.OPENLEARN_PLUGIN_MAX_RSS_MB, DEFAULT_MAX_RSS_MB),
    cpuQuotaMs: normalizePositiveInt(env.OPENLEARN_PLUGIN_CPU_QUOTA_MS, DEFAULT_CPU_QUOTA_MS),
    cpuWindowMs: normalizePositiveInt(env.OPENLEARN_PLUGIN_CPU_WINDOW_MS, DEFAULT_CPU_WINDOW_MS),
  };
}

export function quotaExceeded(input: {
  rssKb: number;
  cpuMsInWindow: number;
  maxRssMb: number;
  cpuQuotaMs: number;
}): string | null {
  if (input.maxRssMb > 0 && input.rssKb > input.maxRssMb * 1024) {
    return `RSS ${Math.round(input.rssKb / 1024)}MB exceeds ${input.maxRssMb}MB`;
  }
  if (input.cpuQuotaMs > 0 && input.cpuMsInWindow > input.cpuQuotaMs) {
    return `CPU ${Math.round(input.cpuMsInWindow)}ms in the current window exceeds ${input.cpuQuotaMs}ms`;
  }
  return null;
}

/** Linux /proc 采样。非 Linux 或进程已退出时返回 null。 */
export function readProcSample(pid: number): { cpuMs: number; rssKb: number } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const utime = Number(rest[11]);
    const stime = Number(rest[12]);
    if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
    return { cpuMs: ((utime + stime) / 100) * 1000, rssKb: rss ? Number(rss[1]) : 0 };
  } catch {
    return null;
  }
}

export function startProcessQuota(
  pid: number | undefined,
  onBreach: (reason: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): { stop: () => void } {
  if (!pid || env.OPENLEARN_PLUGIN_QUOTA === 'off') return { stop: () => undefined };
  const limits = quotaLimits(env);
  if (limits.maxRssMb === 0 && limits.cpuQuotaMs === 0) return { stop: () => undefined };

  let stopped = false;
  let windowStartCpu = 0;
  let windowStartAt = Date.now();
  const timer = setInterval(() => {
    if (stopped) return;
    const sample = readProcSample(pid);
    if (!sample) return;
    const now = Date.now();
    if (now - windowStartAt >= limits.cpuWindowMs) {
      windowStartCpu = sample.cpuMs;
      windowStartAt = now;
    }
    const reason = quotaExceeded({
      rssKb: sample.rssKb,
      cpuMsInWindow: sample.cpuMs - windowStartCpu,
      maxRssMb: limits.maxRssMb,
      cpuQuotaMs: limits.cpuQuotaMs,
    });
    if (reason) {
      stopped = true;
      clearInterval(timer);
      onBreach(reason);
    }
  }, 1_000);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
