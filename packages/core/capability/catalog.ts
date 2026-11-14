/**
 * 平台能力字符串（`resource:action`）的唯一权威清单（Issue #368）。
 *
 * ## 为什么需要它
 *
 * 这些字符串此前散落在两处：
 * - `capability/guard/capability-guard.ts` 的角色回退列表（资源型：`lesson:*`、`assignment:*` 等）；
 * - `plugin-host/method-policy.ts` 的方法级常量（能力型：`api:write`、`student-data:write` 等）。
 *
 * 插件作者只查到其中一处时，会把另一处的真实权限误判为「捏造串」并删掉 ——
 * 真实事故见 Issue #368：4 个插件的 `pointsLedger.addPoints` 因此全部失效，
 * 而且插件侧 `try/catch` 把异常吞掉后日志里查不到任何痕迹。
 *
 * 现在清单只在这里维护：守卫、方法策略、manifest 校验、SDK 全部从这里取值。
 * 与 `docs/reference/plugin-capability-matrix.md` 的对照关系由 `catalog-parity` 测试守住。
 *
 * ## 口径
 *
 * - 只有这里列出的字符串才可以出现在 `manifest.capabilitiesProposed` 与
 *   `ActionDescriptor.capabilityRequired` 里；
 * - 通配符（`*` / `*:*` / `*:*:*`）是**授权端**的内部语法，插件不得声明，
 *   由 `plugin-grants.isBlockedPluginCapability()` 拒绝；
 * - 运行时权限（`RuntimePermission`：`lesson:control`、`whiteboard:draw` 等）属于另一套机制，
 *   **不是**能力字符串，列进来会让人误以为可声明。
 */

// ── 方法级能力的具名常量 ─────────────────────────────────────────────
//
// 这几个名字是 method-policy 的历史导出面（插件/服务端都在 import）。
// 字面量放在这里、由 `CAP` 引用，方法策略那边只做 re-export —— 生成 d.ts 时
// 才能保留字面量类型，而不是退化成 `any`（会把 lint 预算顶爆，见 #368 CI）。

/** 授予「写操作」所需。 */
export const CAP_API_WRITE = 'api:write';

/** 授予高危路径 / 不可逆操作所需。 */
export const CAP_API_ADMIN = 'api:admin';

/** 授予学期成绩**写入**（`grades:read` 不足以解锁写入）。 */
export const CAP_GRADES_WRITE = 'grades:write';

/** 授予「注册对外暴露给 AI Agent 的 action」所需。 */
export const CAP_AGENT_TOOL = 'agent:tool';

/** 授予「驱动 AI 生成」所需。 */
export const CAP_AI_INVOKE = 'ai:invoke';

/** 授予「注册 AI Persona 角色模板或 AI 上下文切片提供者」所需。 */
export const CAP_AI_PERSONA = 'ai:persona';

/** 授予「注册后台常驻任务」所需。 */
export const CAP_TASK_REGISTER = 'task:register';

/** 授予读取学生个人敏感数据（积分流水、维度汇总等）所需。 */
export const CAP_STUDENT_DATA_READ = 'student-data:read';

/** 授予写入/变更学生个人敏感数据（积分变动等）所需。 */
export const CAP_STUDENT_DATA_WRITE = 'student-data:write';

/** 具名常量：代码里引用能力时应使用它，避免字符串字面量再次分叉。 */
export const CAP = {
  // ── 资源型（ActionDescriptor.capabilityRequired）──────────────────────
  ASSIGNMENT_MANAGE: 'assignment:manage',
  ASSIGNMENT_READ: 'assignment:read',
  ASSIGNMENT_REVIEW: 'assignment:review',
  ASSIGNMENT_SUBMIT: 'assignment:submit',
  ASSIGNMENT_WRITE: 'assignment:write',
  LESSON_DELETE: 'lesson:delete',
  LESSON_READ: 'lesson:read',
  LESSON_WRITE: 'lesson:write',
  MANAGEMENT_READ: 'management:read',
  MANAGEMENT_WRITE: 'management:write',
  PLUGIN_READ: 'plugin:read',
  PLUGIN_WRITE: 'plugin:write',
  PROCESS_READ: 'process:read',
  PROCESS_WRITE: 'process:write',
  STUDENT_WRITE: 'student:write',
  VFS_READ: 'vfs:read',
  VFS_WRITE: 'vfs:write',
  WHITEBOARD_READ: 'whiteboard:read',
  WHITEBOARD_WRITE: 'whiteboard:write',

  // ── 历史上只出现在 capabilitiesProposed、从未作为 capabilityRequired ──
  // 保留是为了不让内置 management 插件在升级后突然被标成「未知串」。
  CLASS_READ: 'class:read',
  CLASS_WRITE: 'class:write',
  STUDENT_READ: 'student:read',

  // ── 方法级（method-policy / 服务代理的 Security Barrier 3）───────────
  API_WRITE: CAP_API_WRITE,
  API_ADMIN: CAP_API_ADMIN,
  GRADES_WRITE: CAP_GRADES_WRITE,
  AGENT_TOOL: CAP_AGENT_TOOL,
  AI_INVOKE: CAP_AI_INVOKE,
  AI_PERSONA: CAP_AI_PERSONA,
  TASK_REGISTER: CAP_TASK_REGISTER,
  STUDENT_DATA_READ: CAP_STUDENT_DATA_READ,
  STUDENT_DATA_WRITE: CAP_STUDENT_DATA_WRITE,

  // ── 平台内部 ─────────────────────────────────────────────────────────
  // 片段命令（segment gate）用，插件片段可声明；不在 AI 工具箱里。
  SEGMENT_GATE_EVAL: 'segment:gate_eval',
} as const;

export type Capability = (typeof CAP)[keyof typeof CAP];

/** 全部合法能力字符串（去重、冻结）。 */
export const CAPABILITIES: readonly Capability[] = Object.freeze(
  Array.from(new Set(Object.values(CAP))) as Capability[],
);

/** 合法能力集合，供 O(1) 判定。 */
export const KNOWN_CAPABILITIES: ReadonlySet<string> = new Set(CAPABILITIES);

/** 是否是可声明的合法能力字符串。 */
export function isKnownCapability(value: unknown): value is Capability {
  return typeof value === 'string' && KNOWN_CAPABILITIES.has(value);
}

/**
 * 校验一组 manifest 能力声明，返回未知项（不抛错）。
 *
 * 未知项不会获得任何约束力：守卫只按 `ActionDescriptor.capabilityRequired` 判定，
 * 而那个字段同样取自本清单。所以「捏造串」的代价是白声明 + 静默无效果。
 */
export function validateManifestCapabilities(capabilities: readonly unknown[]): {
  valid: boolean;
  unknown: string[];
} {
  const unknown: string[] = [];
  for (const cap of capabilities) {
    if (typeof cap !== 'string' || !KNOWN_CAPABILITIES.has(cap)) {
      unknown.push(typeof cap === 'string' ? cap : String(cap));
    }
  }
  return { valid: unknown.length === 0, unknown };
}

/**
 * 校验并在出现未知能力时抛错 —— 给插件构建脚本 / smoke test 用。
 *
 * @throws Error 列出全部未知串与合法清单，便于直接照着改。
 */
export function assertValidManifestCapabilities(capabilities: readonly unknown[], pluginId?: string): void {
  const { valid, unknown } = validateManifestCapabilities(capabilities);
  if (valid) return;
  const who = pluginId ? `插件 "${pluginId}" ` : '';
  throw new Error(
    `${who}声明了未知能力：${unknown.join(', ')}。` +
      `合法值只能取自 docs/reference/plugin-capability-matrix.md：${CAPABILITIES.join(', ')}。`,
  );
}
