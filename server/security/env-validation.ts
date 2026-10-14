/**
 * 启动期环境变量强校验（P1 trust boundary hardening）。
 *
 * 背景：历史上多个安全相关开关只做「按前缀/包含判断」的宽松归一化 ——
 * 拼错的 `OPENLEARN_PLUGIN_PERMISSION=rw-only` 或 `OPENLEARN_WORKER_LIVENESS=flase`
 * 会静默退化为默认值甚至最宽策略，配置笔误无法被发现。
 *
 * 本模块在 `startServer()` 最早期执行：
 * - `error` 级问题（拼写错误、越界数值、生产弱口令）→ 打印全部问题后**拒绝启动**；
 * - `warning` 级问题（生产仍可自愈但风险偏高）→ 只打印，不阻断。
 *
 * 校验保持纯函数：`validateStartupEnv(env)` 不读 `process.env`、不落盘、不抛异常，
 * 便于单元测试逐个规则覆盖；副作用集中在 `assertStartupEnv()`。
 */
import net from 'node:net';

export type EnvIssueSeverity = 'error' | 'warning';

export interface EnvIssue {
  key: string;
  severity: EnvIssueSeverity;
  message: string;
}

export interface EnvValidationResult {
  errors: EnvIssue[];
  warnings: EnvIssue[];
}

const NODE_ENVS = ['development', 'production', 'test'] as const;
const ISOLATE_KINDS = ['thread', 'process'] as const;
const PERMISSION_POLICIES = ['rw', 'ro', 'off'] as const;
const LIVENESS_VALUES = ['on', 'off'] as const;
const TELEMETRY_VALUES = ['on', 'off'] as const;
const HEX_64 = /^[0-9a-fA-F]{64}$/;

function trimmed(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value === '' ? undefined : value;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/** 校验 TRUST_PROXY 的单个逗号分段。 */
function isValidTrustProxyToken(token: string): boolean {
  const value = token.trim();
  if (value === '') return false;
  if (/^\d+$/.test(value)) return Number(value) >= 0;
  if (value === 'true' || value === 'false') return true;
  if (value === 'loopback' || value === 'linklocal' || value === 'uniquelocal') return true;
  // Express 也接受具体 IP（用于按代理地址精确信任）。
  if (net.isIP(value) !== 0) return true;
  // 以及 CIDR 网段，例如 192.168.0.0/16 或 fc00::/7。
  const cidr = /^(.+)\/(\d+)$/.exec(value);
  if (cidr && net.isIP(cidr[1]) !== 0) {
    const prefix = Number(cidr[2]);
    const maxPrefix = net.isIPv6(cidr[1]) ? 128 : 32;
    return prefix >= 0 && prefix <= maxPrefix;
  }
  return false;
}

/**
 * 校验 origin 条目。允许 `*`、带通配端口（`http://localhost:*`）、
 * 以及带通配子域（`https://*.example.com`）。
 */
function isValidOriginPattern(entry: string): boolean {
  const value = entry.trim();
  if (value === '') return false;
  if (value === '*') return true;
  let parsed: URL;
  try {
    parsed = new URL(value.replace(':*', ':0'));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;
  return true;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateStartupEnv(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];
  const isProduction = env.NODE_ENV === 'production';

  // ── NODE_ENV ─────────────────────────────────────────────────────────
  const nodeEnv = trimmed(env, 'NODE_ENV');
  if (nodeEnv && !(NODE_ENVS as readonly string[]).includes(nodeEnv)) {
    errors.push({
      key: 'NODE_ENV',
      severity: 'error',
      message: `NODE_ENV 必须是 ${NODE_ENVS.join(' / ')} 之一，实际为 "${nodeEnv}"。`,
    });
  }

  // ── PORT ─────────────────────────────────────────────────────────────
  const port = trimmed(env, 'PORT');
  if (port && !/^\d+$/.test(port)) {
    errors.push({ key: 'PORT', severity: 'error', message: `PORT 必须是整数，实际为 "${port}"。` });
  } else if (port) {
    const parsedPort = Number(port);
    if (parsedPort < 1 || parsedPort > 65535) {
      errors.push({
        key: 'PORT',
        severity: 'error',
        message: `PORT 必须在 1-65535 之间，实际为 ${parsedPort}。`,
      });
    }
  }

  // ── TRUST_PROXY ──────────────────────────────────────────────────────
  const trustProxy = trimmed(env, 'TRUST_PROXY');
  if (trustProxy) {
    const tokens = splitList(trustProxy);
    const invalid = tokens.filter((token) => !isValidTrustProxyToken(token));
    if (tokens.length === 0 || invalid.length > 0) {
      errors.push({
        key: 'TRUST_PROXY',
        severity: 'error',
        message:
          `TRUST_PROXY 含无法识别的取值 ${invalid.length ? invalid.map((t) => `"${t}"`).join(', ') : `"${trustProxy}"`}。` +
          ' 允许：0/false、1/true、非负整数、loopback/linklocal/uniquelocal、具体 IP、逗号分隔组合。',
      });
    }
    if (isProduction && tokens.some((token) => token === 'true' || token === '1')) {
      warnings.push({
        key: 'TRUST_PROXY',
        severity: 'warning',
        message:
          '生产环境信任所有上游代理（TRUST_PROXY=1/true）。若服务可被公网直连，客户端可伪造 X-Forwarded-For 绕过限流。',
      });
    }
  }

  // ── 加密密钥 ─────────────────────────────────────────────────────────
  const encryptionKey = trimmed(env, 'ENCRYPTION_KEY');
  if (encryptionKey) {
    const value = unquote(encryptionKey);
    if (!HEX_64.test(value)) {
      errors.push({
        key: 'ENCRYPTION_KEY',
        severity: 'error',
        message: 'ENCRYPTION_KEY 必须是 64 位十六进制（32 字节）。不要使用短密钥或占位符。',
      });
    }
  } else if (isProduction) {
    warnings.push({
      key: 'ENCRYPTION_KEY',
      severity: 'warning',
      message:
        '未设置 ENCRYPTION_KEY，将使用/生成 storage/encryption-key。生产环境建议显式设置并离线备份，否则丢失该文件将无法解密 AI Key 与班级口令。',
    });
  }

  // ── 插件隔离档位 ─────────────────────────────────────────────────────
  const isolate = trimmed(env, 'OPENLEARN_WORKER_ISOLATE');
  if (isolate && !(ISOLATE_KINDS as readonly string[]).includes(isolate.toLowerCase())) {
    errors.push({
      key: 'OPENLEARN_WORKER_ISOLATE',
      severity: 'error',
      message: `OPENLEARN_WORKER_ISOLATE 必须是 ${ISOLATE_KINDS.join(' / ')}，实际为 "${isolate}"。`,
    });
  }

  const permission = trimmed(env, 'OPENLEARN_PLUGIN_PERMISSION');
  if (permission && !(PERMISSION_POLICIES as readonly string[]).includes(permission.toLowerCase())) {
    errors.push({
      key: 'OPENLEARN_PLUGIN_PERMISSION',
      severity: 'error',
      message:
        `OPENLEARN_PLUGIN_PERMISSION 必须是 ${PERMISSION_POLICIES.join(' / ')}，实际为 "${permission}"。` +
        ' 拼错会静默回落默认策略，因此拒绝启动而不是继续。',
    });
  }

  const heap = trimmed(env, 'OPENLEARN_PLUGIN_MAX_HEAP_MB');
  if (heap) {
    const lower = heap.toLowerCase();
    if (lower !== 'off' && lower !== 'none' && lower !== '0') {
      const match = /^(\d+)$/.exec(heap);
      const mb = match ? Number(match[1]) : NaN;
      if (!match || mb < 32) {
        errors.push({
          key: 'OPENLEARN_PLUGIN_MAX_HEAP_MB',
          severity: 'error',
          message:
            `OPENLEARN_PLUGIN_MAX_HEAP_MB 必须是 "off"/"none"/"0" 或 >= 32 的整数 MB，实际为 "${heap}"。` +
            ' 带单位（如 128MB）或低于下限会静默回落默认值，因此拒绝启动而不是继续。',
        });
      }
    }
  }

  const liveness = trimmed(env, 'OPENLEARN_WORKER_LIVENESS');
  if (liveness && !(LIVENESS_VALUES as readonly string[]).includes(liveness.toLowerCase())) {
    errors.push({
      key: 'OPENLEARN_WORKER_LIVENESS',
      severity: 'error',
      message: `OPENLEARN_WORKER_LIVENESS 只能是 on / off，实际为 "${liveness}"。`,
    });
  }

  const telemetry = trimmed(env, 'BRIDGE_HOOK_TELEMETRY');
  if (telemetry && !(TELEMETRY_VALUES as readonly string[]).includes(telemetry.toLowerCase())) {
    errors.push({
      key: 'BRIDGE_HOOK_TELEMETRY',
      severity: 'error',
      message: `BRIDGE_HOOK_TELEMETRY 只能是 on / off，实际为 "${telemetry}"。`,
    });
  }

  // ── CORS / iframe / LTI 白名单 ───────────────────────────────────────
  const allowedOrigins = trimmed(env, 'ALLOWED_ORIGINS');
  if (allowedOrigins) {
    const origins = splitList(allowedOrigins);
    const invalid = origins.filter((origin) => !isValidOriginPattern(origin));
    if (invalid.length > 0) {
      errors.push({
        key: 'ALLOWED_ORIGINS',
        severity: 'error',
        message: `ALLOWED_ORIGINS 含非法 origin：${invalid.map((o) => `"${o}"`).join(', ')}。`,
      });
    }
    if (origins.includes('*')) {
      warnings.push({
        key: 'ALLOWED_ORIGINS',
        severity: 'warning',
        message: 'ALLOWED_ORIGINS 含 "*"，将关闭凭证支持。生产环境建议改为显式来源白名单。',
      });
    }
  }

  for (const key of ['ALLOWED_FRAME_ORIGINS', 'LTI_ALLOWED_LMS_ORIGINS'] as const) {
    const raw = trimmed(env, key);
    if (!raw) continue;
    const invalid = splitList(raw).filter((origin) => !isValidOriginPattern(origin));
    if (invalid.length > 0) {
      warnings.push({
        key,
        severity: 'warning',
        message: `${key} 含无法解析的 origin：${invalid.map((o) => `"${o}"`).join(', ')}，将无法匹配任何来源。`,
      });
    }
  }

  // ── 生产环境种子口令 / 指标令牌 ──────────────────────────────────────
  if (isProduction) {
    const adminPassword = trimmed(env, 'OPENLEARN_ADMIN_PASSWORD');
    if (adminPassword && adminPassword.toLowerCase() === 'admin') {
      errors.push({
        key: 'OPENLEARN_ADMIN_PASSWORD',
        severity: 'error',
        message: '生产环境禁止把 OPENLEARN_ADMIN_PASSWORD 设为用户名 "admin"。请设置强口令。',
      });
    }
    const teacherPassword = trimmed(env, 'OPENLEARN_TEACHER_PASSWORD');
    if (teacherPassword && teacherPassword.toLowerCase() === 'teacher') {
      errors.push({
        key: 'OPENLEARN_TEACHER_PASSWORD',
        severity: 'error',
        message: '生产环境禁止把 OPENLEARN_TEACHER_PASSWORD 设为用户名 "teacher"。请设置强口令。',
      });
    }
  }

  const metricsToken = trimmed(env, 'METRICS_TOKEN');
  if (metricsToken && metricsToken.length < 16) {
    warnings.push({
      key: 'METRICS_TOKEN',
      severity: 'warning',
      message: 'METRICS_TOKEN 短于 16 个字符，容易被暴力猜测，建议加长。',
    });
  }

  return { errors, warnings };
}

export function formatEnvIssues(issues: EnvIssue[]): string {
  return issues.map((issue) => `  [${issue.severity.toUpperCase()}] ${issue.key}: ${issue.message}`).join('\n');
}

/**
 * 在 `startServer()` 最早期调用：打印 warning，遇到 error 立即拒绝启动。
 *
 * 之所以直接抛错而不是 `process.exit`：由调用方（server.ts）统一走
 * `startServer().catch()` 的日志与退出码路径，保持可测试性。
 */
export function assertStartupEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { errors, warnings } = validateStartupEnv(env);

  if (warnings.length > 0) {
    console.warn(`[Security] 启动期环境变量告警：\n${formatEnvIssues(warnings)}`);
  }

  if (errors.length > 0) {
    const message =
      `[Security] FATAL: 启动期环境变量校验失败，拒绝启动（${errors.length} 项）：\n` +
      formatEnvIssues(errors);
    const error = new Error(message);
    error.name = 'StartupEnvValidationError';
    throw error;
  }
}
