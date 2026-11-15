import type { ServerContext } from '../context.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { sendSafeError } from '../utils/error-handler.js';
import {
  ALLOW_UNSIGNED_ENV,
  HOOK_TELEMETRY_ENV,
  HTTP_ACCESS_LOG_ENV,
  HTTP_ACCESS_LOG_IGNORE_ENV,
  HTTP_SLOW_MS_ENV,
  RuntimePolicyError,
  resolveHookTelemetryPolicy,
  resolveRuntimePolicies,
  setRuntimePolicies,
  type RuntimePoliciesSnapshot,
} from '../services/runtime-policies.js';

/** 仍保留为部署/启动安全边界、不放入普通开关的环境变量（只给管理员展示说明，不含密钥值）。 */
export const RESERVED_ENV_BOUNDARIES: { key: string; reason: string }[] = [
  {
    key: 'OPENLEARN_TRUSTED_INLINE_PLUGINS',
    reason: '受信内联插件名单是启动期信任边界，误开会让第三方代码进入宿主进程。',
  },
  { key: 'OPENLEARN_WORKER_ISOLATE', reason: '插件隔离模式属进程启动边界，关闭隔离不能做成普通按钮。' },
  { key: 'OPENLEARN_PLUGIN_PERMISSION', reason: '子进程权限模型在进程启动时生效，运行中切换无法可靠收回已授予能力。' },
  {
    key: 'OPENLEARN_PLUGIN_QUOTA / MAX_HEAP / MAX_RSS / CPU_QUOTA',
    reason: '资源配额是数值型启动约束，不是布尔功能开关。',
  },
  { key: 'OPENLEARN_WORKER_LIVENESS', reason: '存活探测与宽限是子进程生命周期守卫，关闭会导致失控插件无法被回收。' },
  { key: 'ALLOW_UNSAFE_PLUGIN_SCRIPTS', reason: '允许不安全脚本会削弱沙箱，不得作为后台普通开关。' },
  { key: 'OPENLEARN_SQL_GUARD_ALL_MODES', reason: 'SQL 守卫扩大到 inline 会影响存量插件，属于部署排障开关。' },
  { key: 'OPENLEARN_SKIP_PASSWORD_CHANGE_GATE', reason: '跳过改密门禁属于认证绕过，禁止做成普通按钮。' },
  { key: 'PLAYWRIGHT_TEST / 其它测试专用变量', reason: '仅用于自动化测试，不得在生产后台启用。' },
  { key: 'TRUST_PROXY / HSTS / HTTPS 相关', reason: '反向代理与传输安全是部署拓扑决策，错误配置会造成会话劫持。' },
  { key: 'LOG_REDACT', reason: '日志脱敏默认开启；允许从界面关闭会把口令与令牌写入日志。' },
  { key: 'ROUTE_SCOPE_ENFORCE', reason: '路由数据范围强制是启动期门禁，迁移期才由部署者显式打开。' },
  {
    key: 'ENCRYPTION_KEY / OPENLEARN_*_PASSWORD / *_PUBKEY / TRUSTED_PUBKEYS',
    reason: '密钥与公钥是机密或信任根，不能出现在普通配置开关里。',
  },
];

function serializePolicies(snapshot: RuntimePoliciesSnapshot) {
  return {
    hookTelemetry: {
      enabled: snapshot.hookTelemetry.enabled,
      storedValue: snapshot.hookTelemetry.storedValue,
      configSource: snapshot.hookTelemetry.configSource,
      hasEnvFallback: snapshot.hookTelemetry.hasEnvFallback,
      envVar: HOOK_TELEMETRY_ENV,
      effect: '新打开的课件会立即按此值注入；已打开的课件在宿主同步策略后停止后续网络遥测上报。关闭不会影响成绩提交。',
    },
    httpAccessLog: {
      mode: snapshot.httpAccessLog.mode,
      storedMode: snapshot.httpAccessLog.storedMode,
      modeSource: snapshot.httpAccessLog.modeSource,
      hasModeEnvFallback: snapshot.httpAccessLog.hasModeEnvFallback,
      ignorePrefixes: snapshot.httpAccessLog.ignorePrefixes,
      storedIgnore: snapshot.httpAccessLog.storedIgnore,
      ignoreSource: snapshot.httpAccessLog.ignoreSource,
      slowMs: snapshot.httpAccessLog.slowMs,
      storedSlowMs: snapshot.httpAccessLog.storedSlowMs,
      slowSource: snapshot.httpAccessLog.slowSource,
      envVar: HTTP_ACCESS_LOG_ENV,
      ignoreEnvVar: HTTP_ACCESS_LOG_IGNORE_ENV,
      slowEnvVar: HTTP_SLOW_MS_ENV,
      effect: '访问日志中间件按每次请求读取生效值，保存后对后续请求立即生效，无需重启。不影响安全审计与指标统计。',
    },
    allowUnsigned: {
      allowByDefault: snapshot.allowUnsigned.allowByDefault,
      storedValue: snapshot.allowUnsigned.storedValue,
      configSource: snapshot.allowUnsigned.configSource,
      hasEnvFallback: snapshot.allowUnsigned.hasEnvFallback,
      envVar: ALLOW_UNSIGNED_ENV,
      effect:
        '立即对后续本地 ZIP 安装与更新生效。即使允许默认放行，也不是全信任或允许内联执行；签名错误、公钥、网络限制、权限与沙箱不会被绕过。收紧后须在每次上传时显式确认。',
    },
  };
}

export function registerRuntimePolicyRoutes(ctx: ServerContext) {
  const { app } = ctx;

  // 已登录用户可读有效开关（不含来源与存储值），供宿主向已打开课件同步关闭遥测。
  app.get('/api/bridge/hook-telemetry', requireScopedAuth('authenticated'), (_req, res) => {
    try {
      const policy = resolveHookTelemetryPolicy(kernelContainer.db);
      res.json({ enabled: policy.enabled });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/admin/runtime-policies', requireAuth('administrator'), (_req, res) => {
    try {
      const snapshot = resolveRuntimePolicies(kernelContainer.db);
      res.json({
        success: true,
        policies: serializePolicies(snapshot),
        reservedEnvBoundaries: RESERVED_ENV_BOUNDARIES,
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/admin/runtime-policies', requireAuth('administrator'), (req, res) => {
    try {
      const body = req.body || {};
      const snapshot = setRuntimePolicies(kernelContainer.db, {
        hookTelemetryEnabled: body.hookTelemetryEnabled,
        httpAccessLogMode: body.httpAccessLogMode,
        httpAccessLogIgnore: body.httpAccessLogIgnore,
        httpSlowMs: body.httpSlowMs,
        allowUnsignedByDefault: body.allowUnsignedByDefault,
      });
      recordSecurityAudit('runtime_policy.updated', {
        actorId: getActorId(req),
        hookTelemetry: snapshot.hookTelemetry.enabled,
        hookTelemetrySource: snapshot.hookTelemetry.configSource,
        httpAccessLogMode: snapshot.httpAccessLog.mode,
        allowUnsignedByDefault: snapshot.allowUnsigned.allowByDefault,
        allowUnsignedSource: snapshot.allowUnsigned.configSource,
      });
      res.json({
        success: true,
        policies: serializePolicies(snapshot),
        reservedEnvBoundaries: RESERVED_ENV_BOUNDARIES,
      });
    } catch (e: any) {
      if (e instanceof RuntimePolicyError) {
        return res.status(400).json({ success: false, error: e.message });
      }
      sendSafeError(res, e);
    }
  });
}
