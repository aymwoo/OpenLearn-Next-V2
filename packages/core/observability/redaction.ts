/**
 * 日志脱敏兜底（redaction fallback）。
 *
 * 背景：本模块此前**完全没有** redact 配置（全仓对 `redact` 零命中），
 * 意味着任何一次 `logger.info(someObject)` 都会把对象里的敏感字段原样写进
 * `logs/openlearn.log`（该文件此前已增长到 11.3 MB 且永不轮转）。
 *
 * 设计原则（重要）：
 * 1. **只按字段名脱敏，不做内容识别**。pino/fast-redact 的工作模型是「按路径替换」，
 *    无法识别字符串内部的秘密（见文件末尾「挡不住什么」）。
 * 2. **宁可漏脱，不可误伤**。`id` / `name` / `studentId` / `lessonId` 这类
 *    排障高频字段一律不脱敏 —— 否则日志会因为"到处都是 ***REDACTED***"而失去价值。
 * 3. **保留"这里有值"的痕迹**。脱敏后写入固定占位符而非删除字段，
 *    排障时能立刻区分「字段不存在」与「字段存在但被脱敏」。
 *
 * 字段清单的每一条都来自全仓 grep 实证（见各条注释中的文件:行号），
 * 不含任何"理论上可能有"的臆测字段。
 */

/** 脱敏占位符。刻意保留一个固定字符串，便于事后 grep 统计哪些字段被命中。 */
export const REDACTION_PLACEHOLDER = '***REDACTED***';

/**
 * 需要脱敏的字段名（不含路径修饰符）。
 *
 * 每条的实证依据：
 *
 * - `apiKey` / `api_key`
 *   `packages/core/db/index.ts:280`  `ai_providers.api_key`（AES-256 加密后落库）
 *   `packages/core/di/ai-service.ts:104` SELECT 出 `api_key` 后在 :114 解密
 *   `packages/plugins/ai-submit-injector.ts:67` 解密后拼成 `Authorization: Bearer ...`
 *   `src/types/app.ts:145`、`src/components/AdminPanel.tsx:201` 走 camelCase
 *   → 两种命名都存在，snake_case 与 camelCase 必须同时覆盖。
 *
 * - `password` / `passwordHash` / `password_hash`
 *   `packages/core/db/index.ts:165`  `users.password`
 *   `packages/core/db/index.ts:580`  `ALTER TABLE students ADD COLUMN password`
 *   `packages/core/db/index.ts:256`  `users.password_hash`
 *   → 密码明文与哈希都算凭据：明文可直接登录，哈希泄露则可离线爆破。
 *
 * - `authorization`
 *   `packages/plugins/ai-submit-injector.ts:67` 唯一的 `Authorization` 出站点，
 *   值形如 `Bearer <解密后的 api key>`，等价于明文密钥。
 *   pino 的路径匹配**大小写敏感**，故两种大小写都要列。
 *
 * - `cookie`
 *   `server.ts:264` 从 `req.headers.cookie` 解析 `edu_os_token`（会话凭据）。
 *   整条 Cookie 头一旦落盘即等同泄露一个可用的登录态。
 *
 * - `sessionToken`
 *   `packages/core/di/__tests__/auth-session-bridge.test.ts:164` 会话桥返回的凭据字段；
 *   `packages/plugin-sdk/openlearn.d.ts:1143`  `createSession(): Promise<{ token: string }>`
 *
 * - `passcode` / `class_passcode`
 *   `packages/core/db/index.ts:155`  `classes.class_passcode`（+ :156 过期时间）
 *   班级加入码 —— 持有者可直接进入班级，属凭据而非普通业务字段。
 *
 * - `requestPayload` / `responsePayload`
 *   `packages/core/ai-capability/logging/capability-logger.ts:103` —— AI 请求/响应正文。
 *   字段名足够具体（非 `content` 这类通用词），脱敏代价可控。
 *
 * - `secret`
 *   `packages/core/plugin-host/__tests__/config-service.test.ts:124` 插件配置以
 *   任意 key 存储凭据，`secret` 是最常见的约定名。词义明确，不属于"过度泛化"。
 *
 * **刻意不脱敏的字段**（避免误伤，见报告「过度脱敏的取舍」）：
 * - `token` —— 全仓 406 处命中，但绝大多数是 **DI 依赖注入 Token** 的概念用法
 *   （`IAIServiceToken`、`{ token, instance }`、`Token.version`），不是凭据。
 *   脱敏它会抹掉 plugin-host / DI 的全部排障信息。真凭据路径已由
 *   `cookie` / `sessionToken` 覆盖。
 * - `id` / `name` / `studentId` / `lessonId` / `content` / `messages`
 *   —— 通用业务字段（`content` 408 处、`messages` 119 处），脱敏会摧毁日志价值。
 */
const SENSITIVE_FIELD_NAMES: string[] = [
  'apiKey',
  'api_key',
  'password',
  'passwordHash',
  'password_hash',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'sessionToken',
  'passcode',
  'class_passcode',
  'requestPayload',
  'responsePayload',
  'secret',
];

/**
 * 递归脱敏的最大嵌套深度。
 *
 * 为什么要枚举深度：本仓库 pino 10.x 内置的 fast-redact **不支持 `**` 递归通配符**。
 * 实测（pino 10.x，`pino({redact:{paths:['**.api_key']}})`）：
 * `**.api_key` 无论前置还是内嵌都**静默匹配不到任何东西**，不报错、不警告 ——
 * 即「看起来配了递归脱敏，实际一条都没脱」。`*.a.b` 里的 `*` 才是「恰好一层」。
 *
 * 因此这里用 `*` 逐层展开到 {@link MAX_REDACT_DEPTH} 层，并保留裸字段名覆盖顶层。
 * 代价是路径数 = 字段数 × (1 + 深度) = 15 × 11 = 165 条，对 fast-redact 而言
 * 是一次性的编译期展开，运行期无额外开销。
 *
 * 上限取 10：日志载荷嵌套超过 10 层已属病态；更深的嵌套会漏脱（见报告「挡不住什么」）。
 */
export const MAX_REDACT_DEPTH = 10;

/**
 * 展开为 fast-redact 路径。
 *
 * 每个字段名生成 1 + MAX_REDACT_DEPTH 条路径：
 * - `<name>`                 顶层字段（`logger.info({ password })`，最常见的直接落盘形式）
 * - `*.<name>` … `*.*…*.<name>` 逐层递进，`*` 恰好一层，数组下标也算一层
 */
export const SENSITIVE_PATHS: string[] = SENSITIVE_FIELD_NAMES.flatMap((name) => [
  name,
  ...Array.from({ length: MAX_REDACT_DEPTH }, (_, i) => `${'*.'.repeat(i + 1)}${name}`),
]);

/**
 * 是否启用脱敏。
 *
 * 开关：`LOG_REDACT`（默认开启）。
 *   LOG_REDACT=false|0|off|no   → 关闭脱敏
 *
 * ⚠️ **生产环境不建议关闭**。关闭后明文 AI Provider 密钥、学生密码、
 *    会话 Cookie 都会直接写进 `logs/openlearn.log`，且该文件无访问控制。
 *    这个开关存在的唯一目的是"线上止血排障"——例如怀疑是脱敏把关键字段吃掉了，
 *    需要临时看一眼原始值。排障完请立刻去掉该环境变量并重启。
 */
export function isRedactionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LOG_REDACT;
  if (raw === undefined) return true;
  const normalized = String(raw).trim().toLowerCase();
  return !(normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no');
}

/**
 * 构造 pino 的 `redact` 选项。
 *
 * 返回 `false` 表示不配置脱敏（pino 接受 `redact: false`）。
 * 单独抽成纯函数是为了让测试能在**不创建真实 logger、不写 `logs/`** 的前提下
 * 直接验证这份配置本身的行为。
 */
export function buildRedactOptions(
  env: NodeJS.ProcessEnv = process.env,
): { paths: string[]; censor: string } | false {
  if (!isRedactionEnabled(env)) return false;
  return { paths: SENSITIVE_PATHS, censor: REDACTION_PLACEHOLDER };
}

/*
 * ---------------------------------------------------------------------------
 * 这套兜底挡不住什么（务必知悉）
 * ---------------------------------------------------------------------------
 * 1. **字符串内部的秘密**。fast-redact 的工作模型是「按路径替换整个值」，
 *    没有内容识别能力。`logger.info(\`failed with key ${apiKey}\`)`、
 *    `logger.info({ error: err.message })`（错误信息里带 URL/query token）、
 *    `console.error` 整段字符串 —— 这些一律**脱不掉**。
 *    尤其 `packages/core` 仍有 203 处裸 `console.*` 绕过 pino，压根不经过 redact。
 * 2. **超出 {@link MAX_REDACT_DEPTH} 层的嵌套**。
 * 3. **非 pino 载体**。`packages/core/ai-capability/logging/capability-logger.ts`
 *    的 `requestPayload` / `responsePayload` 走的是进程内存数组，
 *    EventBus 审计事件走的是 SQLite `events` 表 —— 二者都不经过本模块的 redact。
 * 4. **未列入清单的字段**。新增敏感字段必须同步补进
 *    {@link SENSITIVE_FIELD_NAMES}；清单外的字段一律原样落盘。
 * 5. **非字段名形态的凭据**。例如把密钥拼进 URL（`?key=xxx`）或
 *    放在数组裸字符串里（`tags: ['sk-xxx']`），按路径脱敏无从下手。
 */
