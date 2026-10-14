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

export function renderPrometheusMetrics(now = Date.now()): string {
  const uptime = Math.max(0, (now - processStartedAt) / 1000);
  const rss = process.memoryUsage().rss;
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
    [
      '# HELP openlearn_http_responses_total HTTP responses by status class',
      '# TYPE openlearn_http_responses_total counter',
      ...statusClasses.map((key) => `openlearn_http_responses_total{status_class="${key}"} ${httpResponses[key]}`),
    ].join('\n'),
  ];
  return `${parts.join('\n')}\n`;
}
