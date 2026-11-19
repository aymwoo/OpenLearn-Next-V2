import type { ServerContext } from '../context.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { recordSecurityAudit } from '../../packages/core/observability/audit-log.js';
import { sendSafeError } from '../utils/error-handler.js';
import { resolveCommunityInstallConfig, setStoredCommunityInstallEnabled } from '../services/community-attest.js';
import {
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

/** 曾经用来开关产品功能、现已停止读取的变量。只作说明，响应里不含当前值。 */
export const RETIRED_FEATURE_ENV: { key: string; setting: string; historicalDefault: string }[] = [
  {
    key: 'VITE_OPENLEARN_MODE_PACKS / window.__OPENLEARN_MODE_PACKS__',
    setting: 'Mode Pack',
    historicalDefault: '关闭',
  },
  {
    key: 'window.__OPENLEARN_DEBUG_XUEAN_TAB__',
    setting: 'Mode Pack 开启时显示学生平行学案页',
    historicalDefault: '隐藏',
  },
  { key: 'OPENLEARN_COMMUNITY_INSTALL', setting: '允许从社区注册表安装', historicalDefault: '开启' },
  { key: 'BRIDGE_HOOK_TELEMETRY', setting: '课件网络遥测总闸', historicalDefault: '开启' },
  { key: 'HTTP_ACCESS_LOG', setting: 'HTTP 访问日志模式', historicalDefault: 'errors' },
  { key: 'HTTP_ACCESS_LOG_IGNORE', setting: 'HTTP 访问日志忽略前缀', historicalDefault: '空' },
  { key: 'HTTP_SLOW_MS', setting: '慢请求阈值', historicalDefault: '1000 毫秒' },
  { key: 'OPENLEARN_ALLOW_UNSIGNED', setting: '未签名本地插件默认放行', historicalDefault: '放行' },
];

function serializePolicies(snapshot: RuntimePoliciesSnapshot, db: Parameters<typeof resolveCommunityInstallConfig>[0]) {
  const community = resolveCommunityInstallConfig(db);
  return {
    hookTelemetry: {
      enabled: snapshot.hookTelemetry.enabled,
      storedValue: snapshot.hookTelemetry.storedValue,
      configSource: snapshot.hookTelemetry.configSource,
      effect:
        '新打开的课件会立即按此值注入；已打开的课件在宿主同步策略后停止后续网络遥测上报。关闭不会影响成绩提交。无需重启。',
    },
    httpAccessLog: {
      mode: snapshot.httpAccessLog.mode,
      storedMode: snapshot.httpAccessLog.storedMode,
      modeSource: snapshot.httpAccessLog.modeSource,
      ignorePrefixes: snapshot.httpAccessLog.ignorePrefixes,
      storedIgnore: snapshot.httpAccessLog.storedIgnore,
      ignoreSource: snapshot.httpAccessLog.ignoreSource,
      slowMs: snapshot.httpAccessLog.slowMs,
      storedSlowMs: snapshot.httpAccessLog.storedSlowMs,
      slowSource: snapshot.httpAccessLog.slowSource,
      effect: '访问日志中间件按每次请求读取生效值，保存后对后续请求立即生效，无需重启。不影响安全审计与指标统计。',
    },
    allowUnsigned: {
      allowByDefault: snapshot.allowUnsigned.allowByDefault,
      storedValue: snapshot.allowUnsigned.storedValue,
      configSource: snapshot.allowUnsigned.configSource,
      effect:
        '立即对后续本地 ZIP 安装与更新生效，无需重启。即使允许默认放行，也不是全信任或允许内联执行；签名错误、公钥、网络限制、权限与沙箱不会被绕过。收紧后须在每次上传时显式确认。',
    },
    modePacks: {
      enabled: snapshot.modePacks.enabled,
      storedValue: snapshot.modePacks.storedValue,
      configSource: snapshot.modePacks.configSource,
      showXueanTab: snapshot.modePacks.showXueanTab,
      storedShowXueanTab: snapshot.modePacks.storedShowXueanTab,
      showXueanTabSource: snapshot.modePacks.showXueanTabSource,
      effect:
        '保存后无需重启。已打开的页面在重新获得焦点或刷新后切换 Mode Pack。未配置时默认关闭，课中行为与既有白板中栏一致。',
    },
    communityInstall: {
      enabled: community.enabled,
      storedValue: community.storedValue,
      configSource: community.configSource,
      effect:
        '保存后立即对社区安装、URL 更新和社区直传生效，无需重启。未配置时默认开启。不能绕过注册表地址、权限或网络校验。',
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

  app.get('/api/feature-flags', (_req, res) => {
    try {
      const modePacks = resolveRuntimePolicies(kernelContainer.db).modePacks;
      res.json({
        modePacksEnabled: modePacks.enabled,
        modePackShowXueanTab: modePacks.showXueanTab,
      });
    } catch {
      res.json({ modePacksEnabled: false, modePackShowXueanTab: false });
    }
  });

  app.get('/api/admin/runtime-policies', requireAuth('administrator'), (_req, res) => {
    try {
      const snapshot = resolveRuntimePolicies(kernelContainer.db);
      res.json({
        success: true,
        policies: serializePolicies(snapshot, kernelContainer.db),
        reservedEnvBoundaries: RESERVED_ENV_BOUNDARIES,
        retiredFeatureEnv: RETIRED_FEATURE_ENV,
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.put('/api/admin/runtime-policies', requireAuth('administrator'), (req, res) => {
    try {
      const body = req.body || {};
      const runtimePatch = {
        hookTelemetryEnabled: body.hookTelemetryEnabled,
        httpAccessLogMode: body.httpAccessLogMode,
        httpAccessLogIgnore: body.httpAccessLogIgnore,
        httpSlowMs: body.httpSlowMs,
        allowUnsignedByDefault: body.allowUnsignedByDefault,
        modePacksEnabled: body.modePacksEnabled,
        modePackShowXueanTab: body.modePackShowXueanTab,
      };
      const hasRuntimePatch = Object.values(runtimePatch).some((value) => value !== undefined);
      const hasCommunityPatch = Object.prototype.hasOwnProperty.call(body, 'communityInstallEnabled');
      if (!hasRuntimePatch && !hasCommunityPatch) {
        return res.status(400).json({ success: false, error: '缺少要更新的运行时策略字段' });
      }
      if (
        hasCommunityPatch &&
        body.communityInstallEnabled !== null &&
        typeof body.communityInstallEnabled !== 'boolean'
      ) {
        return res.status(400).json({ success: false, error: 'communityInstallEnabled 必须是布尔值或 null' });
      }

      const snapshot = hasRuntimePatch
        ? setRuntimePolicies(kernelContainer.db, runtimePatch)
        : resolveRuntimePolicies(kernelContainer.db);
      const community = hasCommunityPatch
        ? setStoredCommunityInstallEnabled(kernelContainer.db, body.communityInstallEnabled)
        : resolveCommunityInstallConfig(kernelContainer.db);
      recordSecurityAudit('runtime_policy.updated', {
        actorId: getActorId(req),
        hookTelemetry: snapshot.hookTelemetry.enabled,
        hookTelemetrySource: snapshot.hookTelemetry.configSource,
        httpAccessLogMode: snapshot.httpAccessLog.mode,
        allowUnsignedByDefault: snapshot.allowUnsigned.allowByDefault,
        allowUnsignedSource: snapshot.allowUnsigned.configSource,
        modePacksEnabled: snapshot.modePacks.enabled,
        modePackShowXueanTab: snapshot.modePacks.showXueanTab,
        communityInstallEnabled: community.enabled,
        communityInstallSource: community.configSource,
      });
      res.json({
        success: true,
        policies: serializePolicies(snapshot, kernelContainer.db),
        reservedEnvBoundaries: RESERVED_ENV_BOUNDARIES,
        retiredFeatureEnv: RETIRED_FEATURE_ENV,
      });
    } catch (e: any) {
      if (e instanceof RuntimePolicyError) {
        return res.status(400).json({ success: false, error: e.message });
      }
      sendSafeError(res, e);
    }
  });
}
