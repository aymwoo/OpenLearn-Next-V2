/**
 * 强制改密门（SEC-AUTH-06）的开发豁免开关 —— Issue #197。
 *
 * ## 为什么需要
 *
 * `SEC-AUTH-06` 在用户用**种子默认口令**（`admin`/`admin`，特征是密码等于用户名）登录时，
 * 给会话打 `mustChangePassword: true`：前端渲染全屏改密门，服务端拦截除改密外的所有
 * 写操作。生产环境这个机制必须存在。
 *
 * 但在本地开发、测试调试与插件联调时，开发者常把测试账号密码设成与用户名相同 ——
 * 每次重启或清库登录都被全屏改密门挡住，联调效率极低。
 *
 * ## 硬约束：生产环境绝不放行
 *
 * 豁免只在 `NODE_ENV !== 'production'` 生效。生产环境即便配了该变量也**严格忽略**并
 * 输出告警 —— 一个误配的环境变量不能变成线上弱口令的后门。
 *
 * ## 为什么单独成模块
 *
 * 判定散落在登录（`server/routes/roster.ts`）、HTTP 拦截（`enforcePasswordChanged`）与
 * socket 握手（`socketAuthMiddleware`）三处。三处各写一遍 `process.env` 判断，
 * 迟早会出现"登录放行了但 socket 还在拦"这类半开半关的状态。
 */

/** 规范开关名（Issue #197 指定）。 */
export const PASSWORD_GATE_SKIP_ENV = 'OPENLEARN_SKIP_PASSWORD_CHANGE_GATE';

/** 兼容别名：语义更直白的开发用名。 */
export const PASSWORD_GATE_SKIP_ENV_ALIAS = 'DEV_BYPASS_PASSWORD_CHANGE_GATE';

let productionWarningEmitted = false;

/** 仅测试用：重置"已告警"标记，让断言可以观察告警。 */
export function resetPasswordGateWarningForTests(): void {
  productionWarningEmitted = false;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

/**
 * 当前进程是否应跳过强制改密门。
 *
 * @param env 便于测试注入的环境视图（默认 `process.env`）
 */
export function isPasswordChangeGateSkipped(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = isTruthyFlag(env[PASSWORD_GATE_SKIP_ENV]) || isTruthyFlag(env[PASSWORD_GATE_SKIP_ENV_ALIAS]);
  if (!requested) return false;

  // 生产硬防线：绝不放行。告警只打一次 —— 每次请求都打会把日志刷满，
  // 反而让人看不出真正的问题。
  if ((env.NODE_ENV ?? '') === 'production') {
    if (!productionWarningEmitted) {
      productionWarningEmitted = true;
      console.warn(
        `[SECURITY] ${PASSWORD_GATE_SKIP_ENV}/${PASSWORD_GATE_SKIP_ENV_ALIAS} 已配置，但生产环境（NODE_ENV=production）` +
          '严格忽略该开关：强制改密防线不失效。请立即从生产环境移除该变量。',
      );
    }
    return false;
  }

  return true;
}
