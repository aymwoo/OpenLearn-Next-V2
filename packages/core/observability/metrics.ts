/**
 * 基础 Prometheus 文本指标。默认由路由层做鉴权，本模块不决定谁能看。
 */
const statusClasses = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;
type StatusClass = (typeof statusClasses)[number];

const httpResponses: Record<StatusClass, number> = {
  '2xx': 0,
  '3xx': 0,
  '4xx': 0,
  '5xx': 0,
  other: 0,
};

const processStartedAt = Date.now();

/** 运维 gauge 读不到时的哨兵。Prometheus 文本里只出现这个数字，不出现路径或错误文本。 */
export const OPERATIONAL_GAUGE_UNKNOWN = -1;

/** 进程内复用运维 gauge 的时间。`events` 的 COUNT(*) 不在每次抓取时都跑。 */
export const OPERATIONAL_GAUGE_CACHE_MS = 15_000;

export const MIGRATIONS_PENDING_METRIC = 'openlearn_migrations_pending';
export const BACKUP_AGE_SECONDS_METRIC = 'openlearn_backup_age_seconds';
export const EVENTS_ROWS_METRIC = 'openlearn_events_rows';

export interface OperationalGaugeSample {
  /** 磁盘迁移里尚未记入 `_migrations` 的个数。读不到时为 -1。 */
  migrationsPending: number;
  /** 备份目录中最新文件的年龄（秒）。没有文件时为 -1。 */
  backupAgeSeconds: number;
  /** `events` 表当前行数。查询失败时为 -1。 */
  eventsRows: number;
}

export interface OperationalGaugeCacheEntry {
  at: number;
  sample: OperationalGaugeSample;
}

export function statusClassOf(status: number): StatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

export function recordHttpResponse(status: number): void {
  httpResponses[statusClassOf(status)] += 1;
}

export function resetPrometheusMetricsForTests(): void {
  for (const key of statusClasses) httpResponses[key] = 0;
}

function line(name: string, help: string, type: 'gauge' | 'counter', value: string): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, value].join('\n');
}

function formatGauge(value: number): string {
  if (!Number.isFinite(value)) return String(OPERATIONAL_GAUGE_UNKNOWN);
  return String(Math.trunc(value));
}

function gauge(name: string, help: string, value: number): string {
  return line(name, help, 'gauge', `${name} ${formatGauge(value)}`);
}

const unknownOperationalGauges = (): OperationalGaugeSample => ({
  migrationsPending: OPERATIONAL_GAUGE_UNKNOWN,
  backupAgeSeconds: OPERATIONAL_GAUGE_UNKNOWN,
  eventsRows: OPERATIONAL_GAUGE_UNKNOWN,
});

/**
 * 15 秒内返回同一份样本。`ttlMs <= 0` 或时钟回拨时重新采样。
 * 调用方持有缓存槽，本函数不保存进程状态。
 */
export function takeOperationalGaugeSample(
  cache: OperationalGaugeCacheEntry | null,
  now: number,
  load: () => OperationalGaugeSample,
  ttlMs = OPERATIONAL_GAUGE_CACHE_MS,
): OperationalGaugeCacheEntry {
  if (
    cache &&
    Number.isFinite(ttlMs) &&
    ttlMs > 0 &&
    Number.isFinite(cache.at) &&
    Number.isFinite(now) &&
    now >= cache.at &&
    now - cache.at < ttlMs
  ) {
    return cache;
  }
  return { at: now, sample: load() };
}

export function renderPrometheusMetrics(now = Date.now(), sample?: OperationalGaugeSample): string {
  const uptime = Math.max(0, (now - processStartedAt) / 1000);
  const rss = process.memoryUsage().rss;
  const operational = sample ?? unknownOperationalGauges();
  const parts = [
    line('openlearn_up', '1 if the process is serving', 'gauge', 'openlearn_up 1'),
    line(
      'openlearn_process_uptime_seconds',
      'Process uptime in seconds',
      'gauge',
      `openlearn_process_uptime_seconds ${uptime.toFixed(3)}`,
    ),
    line(
      'openlearn_process_resident_memory_bytes',
      'Resident memory in bytes',
      'gauge',
      `openlearn_process_resident_memory_bytes ${rss}`,
    ),
    gauge(
      MIGRATIONS_PENDING_METRIC,
      'On-disk migrations not yet recorded as applied; -1 if unknown',
      operational.migrationsPending,
    ),
    gauge(
      BACKUP_AGE_SECONDS_METRIC,
      'Age in seconds of the newest file in the backup directory; -1 if there is no file',
      operational.backupAgeSeconds,
    ),
    gauge(EVENTS_ROWS_METRIC, 'Current number of rows in the events table; -1 if unknown', operational.eventsRows),
    [
      '# HELP openlearn_http_responses_total HTTP responses by status class',
      '# TYPE openlearn_http_responses_total counter',
      ...statusClasses.map((key) => `openlearn_http_responses_total{status_class="${key}"} ${httpResponses[key]}`),
    ].join('\n'),
  ];
  return `${parts.join('\n')}\n`;
}
