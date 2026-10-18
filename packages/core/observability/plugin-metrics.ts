/**
 * 按插件维度的运行指标（Issue #150）。
 *
 * ## 为什么需要
 *
 * 现有 `/metrics` 只有进程级指标（HTTP 状态码分类、迁移积压、备份年龄、events 行数）。
 * 插件出问题时，运维只能看到「某个接口 500 变多」或「worker 反复重启」，
 * 无法回答「是哪个插件慢 / 报错 / 重启」——#150 的验收标准第一条就是这个。
 *
 * ## 设计约束
 *
 * 1. **有界**：label 值来自插件 id，正常情况下数量有限，但仍设上限
 *    （{@link MAX_PLUGIN_METRIC_ENTRIES}），防止安装/卸载反复产生新 id 或异常输入
 *    把内存和 Prometheus 抓取体积拖垮。超出上限后落到 `__overflow__` 汇总。
 * 2. **不抛错**：指标记录发生在命令派发、事件发布、HTTP 网关等热路径上，
 *    任何异常都不能影响业务请求本身。
 * 3. **可归因**：插件命令可能由教师/学生发起（actor 是用户而非插件），
 *    因此除 `plugin:<id>` actor 外，还接受「命令命名空间 = 插件 manifest.id」，
 *    命名空间解析由内核注入（{@link setPluginNamespaceResolver}），
 *    避免本模块反向依赖 PluginHost。
 */

const MAX_LABEL_LENGTH = 120;
export const MAX_PLUGIN_METRIC_ENTRIES = 200;
export const OVERFLOW_PLUGIN_LABEL = '__overflow__';

const statusClasses = ['2xx', '3xx', '4xx', '5xx', 'other'] as const;
type StatusClass = (typeof statusClasses)[number];

interface PluginCounters {
  commandsOk: number;
  commandsError: number;
  commandDurationMs: number;
  events: number;
  http: Record<StatusClass, number>;
  httpDurationMs: number;
  workerCrashes: number;
  workerRestarts: number;
}

const registry = new Map<string, PluginCounters>();

/** 命名空间 → 插件 id 的解析器。由内核在 PluginHost 就绪后注入。 */
let namespaceResolver: ((namespace: string) => string | undefined) | undefined;

/**
 * 命名空间解析缓存（60 秒）。
 *
 * 内核解析器会查 `plugins` 表（`json_extract`，无索引）。命令派发热路径上
 * 每条核心命令都查一次库是白付成本，故：
 * - 「看起来不像插件」的纯小写命名空间（`lesson` / `classroom` / `courseware` …）
 *   直接短路，不查库；
 * - 其余命名空间缓存 60 秒，插件装卸后最多 1 分钟内自愈。
 */
const NAMESPACE_CACHE_TTL_MS = 60_000;
const NAMESPACE_CACHE_MAX = 500;
const namespaceCache = new Map<string, { value: string | undefined; at: number }>();

function looksLikePluginNamespace(namespace: string): boolean {
  return /[\\/@_-]/.test(namespace);
}

function resolveNamespace(namespace: string): string | undefined {
  if (!namespaceResolver) return undefined;
  const cached = namespaceCache.get(namespace);
  const now = Date.now();
  if (cached && now - cached.at < NAMESPACE_CACHE_TTL_MS) return cached.value;
  const value = namespaceResolver(namespace);
  if (namespaceCache.size >= NAMESPACE_CACHE_MAX) namespaceCache.clear();
  namespaceCache.set(namespace, { value, at: now });
  return value;
}

/** 内核注入：把一个命令命名空间（如 `openlearn-plugin-interactive-courseware`）解析成插件。 */
export function setPluginNamespaceResolver(fn: ((namespace: string) => string | undefined) | undefined): void {
  namespaceResolver = fn;
  namespaceCache.clear();
}

/** 仅测试使用：清空所有计数与解析器。 */
export function resetPluginMetricsForTests(): void {
  registry.clear();
  namespaceResolver = undefined;
  namespaceCache.clear();
}

function normalizeLabel(raw: unknown): string {
  let value = String(raw ?? '').trim();
  if (!value) value = 'unknown';
  if (value.length > MAX_LABEL_LENGTH) value = value.slice(0, MAX_LABEL_LENGTH);
  return value;
}

function counterFor(pluginId: unknown): PluginCounters | undefined {
  const label = normalizeLabel(pluginId);
  let counters = registry.get(label);
  if (!counters) {
    if (registry.size >= MAX_PLUGIN_METRIC_ENTRIES) {
      counters = registry.get(OVERFLOW_PLUGIN_LABEL);
      if (!counters) {
        counters = emptyCounters();
        registry.set(OVERFLOW_PLUGIN_LABEL, counters);
      }
      return counters;
    }
    counters = emptyCounters();
    registry.set(label, counters);
  }
  return counters;
}

function emptyCounters(): PluginCounters {
  return {
    commandsOk: 0,
    commandsError: 0,
    commandDurationMs: 0,
    events: 0,
    http: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 },
    httpDurationMs: 0,
    workerCrashes: 0,
    workerRestarts: 0,
  };
}

function statusClassOf(status: number): StatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

/** 从 actor 推导插件：`plugin:<manifest.id|uuid>`。 */
export function pluginIdFromActor(actorId: string | undefined | null): string | undefined {
  if (!actorId || typeof actorId !== 'string') return undefined;
  return actorId.startsWith('plugin:') ? actorId.slice('plugin:'.length) : undefined;
}

/**
 * 从命令类型推导插件 id。
 *
 * 插件命令的命名空间是 manifest.id（`@ext/class-manager.xxx`、`openlearn-plugin-x.yyy`）。
 * 优先问内核注入的解析器：只有**确实已安装**的命名空间才算插件命令，
 * 否则核心命令（`lesson.create`）也会被记成插件指标。
 * 解析器未注入时，只认 npm 作用域形式（含 `/` 且以 `@` 开头），避免误报。
 */
export function pluginIdFromCommandType(type: string | undefined | null): string | undefined {
  if (!type || typeof type !== 'string') return undefined;
  const dot = type.indexOf('.');
  if (dot <= 0) return undefined;
  const namespace = type.slice(0, dot);
  if (!namespace) return undefined;
  // 纯小写单词是核心命名空间（lesson / classroom / courseware …），不查库。
  if (!looksLikePluginNamespace(namespace)) return undefined;
  const resolved = resolveNamespace(namespace);
  if (resolved) return resolved;
  return namespace.startsWith('@') && namespace.includes('/') ? namespace : undefined;
}

/** 记录一次命令派发（成功/失败 + 耗时）。 */
export function recordPluginCommand(pluginId: string | undefined, ok: boolean, durationMs: number): void {
  try {
    if (!pluginId) return;
    const counters = counterFor(pluginId);
    if (!counters) return;
    if (ok) counters.commandsOk += 1;
    else counters.commandsError += 1;
    if (Number.isFinite(durationMs) && durationMs >= 0) counters.commandDurationMs += durationMs;
  } catch {
    /* 指标不能影响业务 */
  }
}

/** 记录一次由插件发出的事件（`event.source = plugin:<id>`）。 */
export function recordPluginEvent(source: string | undefined | null): void {
  try {
    const pluginId = pluginIdFromActor(source);
    if (!pluginId) return;
    const counters = counterFor(pluginId);
    if (counters) counters.events += 1;
  } catch {
    /* 同上 */
  }
}

/** 记录一次插件 HTTP 网关派发。 */
export function recordPluginHttp(pluginId: string | undefined, status: number, durationMs: number): void {
  try {
    if (!pluginId) return;
    const counters = counterFor(pluginId);
    if (!counters) return;
    counters.http[statusClassOf(status)] += 1;
    if (Number.isFinite(durationMs) && durationMs >= 0) counters.httpDurationMs += durationMs;
  } catch {
    /* 同上 */
  }
}

export function recordWorkerCrash(pluginId: string | undefined): void {
  try {
    if (!pluginId) return;
    const counters = counterFor(pluginId);
    if (counters) counters.workerCrashes += 1;
  } catch {
    /* 同上 */
  }
}

export function recordWorkerRestart(pluginId: string | undefined): void {
  try {
    if (!pluginId) return;
    const counters = counterFor(pluginId);
    if (counters) counters.workerRestarts += 1;
  } catch {
    /* 同上 */
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function metric(
  name: string,
  help: string,
  type: 'counter' | 'gauge',
  samples: Array<{ labels?: Record<string, string>; value: number }>,
): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const sample of samples) {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
          .join(',')}}`
      : '';
    lines.push(`${name}${labels} ${sample.value}`);
  }
  return lines.join('\n');
}

/**
 * 渲染按插件维度的 Prometheus 文本指标。
 *
 * 没有记录过任何插件指标时返回空串 —— 避免在未安装/未激活插件的部署里
 * 输出一堆空样本，干扰 grep 与抓取体积。
 */
export function renderPluginMetrics(): string {
  if (registry.size === 0) return '';
  const entries = [...registry.entries()].sort(([a], [b]) => a.localeCompare(b));
  const byPlugin = (pick: (counters: PluginCounters) => number) =>
    entries.map(([plugin, counters]) => ({ labels: { plugin }, value: pick(counters) }));

  const parts = [
    metric(
      'openlearn_plugin_commands_total',
      'Commands dispatched per plugin by result',
      'counter',
      entries.flatMap(([plugin, counters]) => [
        { labels: { plugin, result: 'ok' }, value: counters.commandsOk },
        { labels: { plugin, result: 'error' }, value: counters.commandsError },
      ]),
    ),
    metric(
      'openlearn_plugin_command_duration_seconds_sum',
      'Cumulative command dispatch duration per plugin in seconds',
      'counter',
      byPlugin((c) => c.commandDurationMs / 1000),
    ),
    metric(
      'openlearn_plugin_command_duration_seconds_count',
      'Number of timed command dispatches per plugin',
      'counter',
      byPlugin((c) => c.commandsOk + c.commandsError),
    ),
    metric(
      'openlearn_plugin_events_total',
      'Events published by each plugin (event.source = plugin:<id>)',
      'counter',
      byPlugin((c) => c.events),
    ),
    metric(
      'openlearn_plugin_http_requests_total',
      'Plugin HTTP gateway requests per plugin by status class',
      'counter',
      entries.flatMap(([plugin, counters]) =>
        statusClasses.map((status) => ({
          labels: { plugin, status },
          value: counters.http[status],
        })),
      ),
    ),
    metric(
      'openlearn_plugin_http_request_duration_seconds_sum',
      'Cumulative plugin HTTP gateway duration per plugin in seconds',
      'counter',
      byPlugin((c) => c.httpDurationMs / 1000),
    ),
    metric(
      'openlearn_plugin_worker_crashes_total',
      'Worker crashes per plugin (nonzero exit while running)',
      'counter',
      byPlugin((c) => c.workerCrashes),
    ),
    metric(
      'openlearn_plugin_worker_restarts_total',
      'Watchdog worker restarts scheduled per plugin',
      'counter',
      byPlugin((c) => c.workerRestarts),
    ),
  ];
  return parts.join('\n');
}

/** 测试/诊断：当前已登记的插件数（不含 overflow）。 */
export function pluginMetricEntryCount(): number {
  return registry.size;
}
