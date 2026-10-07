/**
 * Worker / inline 插件的**方法级**调用策略 —— ServiceHost 的 Security Barrier 3。
 *
 * ## 为什么抽成共享模块（审计项 B-4）
 *
 * 此前策略只存在于浏览器侧 `src/plugin-host/method-policy.ts`，后端
 * `packages/core/worker-runtime/service-host.ts` 只有 Barrier 1（Token 白名单）
 * 与 Barrier 2（空 manifest 降级只读），**没有 Barrier 3**。两端对「插件能做什么」
 * 的判定各写一套，规则漂移无从察觉。
 *
 * 本模块是**纯数据 + 纯函数**，不依赖任何一侧的运行时（不 import DI Token、
 * 不 import zustand、不碰 DOM），因此浏览器与 Node 共用同一份策略常量与判定逻辑。
 * 两侧各自传入自己的 Token 名集合 —— 前端是 `@openlearn/frontend:*`，
 * 后端是 `@openlearn/core:*`，命名空间不同但**规则结构相同**。
 *
 * ## 定位：纵深防御，不是访问控制
 *
 * 真正的权限边界在服务端 —— 每个 REST 端点各自校验 session cookie 与角色，
 * 插件无法绕过。本层不试图「正确判定」一次调用是否合法（那需要逐端点的业务语义），
 * 只做一件事：**收窄「拿到句柄 = 想调什么都行」的爆炸半径**。
 *
 * @module
 */

// ── capability 名称 ───────────────────────────────────────────────────────────

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

/** 授予「注册后台常驻任务」所需。 */
export const CAP_TASK_REGISTER = 'task:register';

// ── 高危 API 路径前缀（浏览器侧 IFrontendAPI 使用）────────────────────────────

/**
 * 高危 API 路径前缀 —— 命中即需要 {@link CAP_API_ADMIN}。
 *
 * 选取依据：对 `server/routes/*.ts` 中全部写端点做前缀统计后，挑出
 * 「改权限 / 删数据 / 改配置 / 驱动 AI」这几类不可逆或高影响命名空间。
 * 列表刻意保守：宁可就多挡，不可漏挡。
 */
export const HIGH_RISK_PATH_PREFIXES: readonly string[] = Object.freeze([
  '/api/plugins', // 插件增删改、一键更新（可执行任意第三方代码）
  '/api/users', // 用户与角色
  '/api/auth', // 会话与密码
  '/api/ai-providers', // AI 提供商配置（含加密凭据）
  '/api/agent', // 驱动 AI Agent（可触发工具调用链）
  '/api/grade-sync', // 成绩回写，无回滚 API
  '/api/site-settings', // 站点级配置
  '/api/approvals', // 高危操作审批流
]);

/**
 * 不可逆子路径 —— 命中即需 {@link CAP_API_ADMIN}，**与命名空间无关**。
 *
 * 例：`DELETE /api/students/:id/gdpr-delete` 会不可逆地抹除学生个人数据
 * （见 `server/routes/roster.ts`）。这类路径散落在各命名空间下，用整段命名空间
 * 拦截代价太大，故按末段形状匹配。
 */
export const IRREVERSIBLE_PATH_SUFFIXES: readonly string[] = Object.freeze(['/gdpr-delete']);

/**
 * 实体级删除的路径形状：`/api/<命名空间>/<id>`（恰好 3 段，无更深子路径）。
 *
 * 命中且方法为 `del` 时需 {@link CAP_API_ADMIN}。这样 `del('/api/students/123')`
 * 会被拦下，而 `del('/api/classes/123/students/456')`（从班级里移除某学生，
 * 影响面小得多）不因形状而被误伤。
 */
const ENTITY_DELETE_RE = /^\/api\/[^/]+\/[^/]+$/;

/** 归一化路径：去掉查询串与末尾斜杠，便于前缀比对。 */
function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  const withoutQuery = raw.split('?')[0] ?? '';
  return withoutQuery.length > 1 && withoutQuery.endsWith('/') ? withoutQuery.slice(0, -1) : withoutQuery;
}

/** 从 `post('/api/x', body)` / `del('/api/x')` / `post(pathVar)` 里取出路径实参。 */
function extractPathArg(args: unknown): string {
  if (!Array.isArray(args) || args.length === 0) return '';
  return normalizePath(args[0]);
}

/** 判断 manifest 声明里是否出现了某个 capability（含 `name:*` 与通配 `*`）。 */
export function hasCapability(caps: readonly string[], name: string): boolean {
  return caps.some((c) => typeof c === 'string' && (c === name || c === '*' || c.startsWith(`${name}:`)));
}

/** 只读方法判定：`get` 或 `get*` 前缀。Barrier 2 与 Barrier 3 共用同一口径。 */
export function isReadOnlyMethod(method: string): boolean {
  return method === 'get' || method.startsWith('get');
}

/**
 * 策略上下文：把「这次调用涉及哪些 Token」交给判定函数。
 *
 * 两端 Token 命名空间不同，故用集合传入而非硬编码常量 ——
 * 硬编码会让共享模块反向依赖某一侧的 `./types`。
 */
export interface MethodPolicyTokens {
  /** 浏览器侧：任意 path 同源 fetch */
  frontendApi?: string;
  /** 浏览器侧：课堂 socket */
  socketService?: string;
  /** 浏览器侧：UI 扩展点 */
  uiService?: string;
  /** 浏览器侧 / 后端共用的本地存储 */
  storageService?: string;
  /** 浏览器侧：学期成绩 */
  semesterGradeService?: string;
  /** 后端：AI 生成 */
  aiService?: string;
  /** 后端：后台进程 / 常驻任务 */
  processService?: string;
  /** 后端：action 注册（可 exposeToAgent） */
  actionRegistry?: string;
}

export interface MethodPolicyInput {
  token: string;
  method: string;
  args: unknown;
  /** 插件 manifest 声明的 capabilitiesProposed */
  caps?: readonly string[];
  /** 各端自己的 Token 名集合 */
  tokens: MethodPolicyTokens;
}

/**
 * 对一次服务调用做方法 / 路径级判定。
 *
 * @returns 允许时返回 `null`；拒绝时返回**面向人的原因说明**。
 */
export function checkMethodPolicy(input: MethodPolicyInput): string | null {
  const { token, method, args, tokens } = input;
  const caps = input.caps ?? [];

  // ── 浏览器侧：IFrontendAPI —— 默认只读，写操作需专门 capability ────────
  if (tokens.frontendApi && token === tokens.frontendApi) {
    if (isReadOnlyMethod(method)) return null;
    // 少数无副作用的辅助方法不视为写操作
    if (method === 'request' && !Array.isArray(args)) return null;

    const path = extractPathArg(args);
    const isHighRisk = HIGH_RISK_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    const isIrreversible = IRREVERSIBLE_PATH_SUFFIXES.some((s) => path.endsWith(s));
    const isEntityDelete = method === 'del' && ENTITY_DELETE_RE.test(path);

    if (isHighRisk || isIrreversible || isEntityDelete) {
      if (hasCapability(caps, CAP_API_ADMIN)) return null;
      const why = isIrreversible
        ? `不可逆操作 '${path}'`
        : isEntityDelete
          ? `实体级删除 '${path}'`
          : `写入高危路径 '${path || '<未提供路径>'}'`;
      return `${why} 需要 manifest 声明 '${CAP_API_ADMIN}' 能力`;
    }
    return hasCapability(caps, CAP_API_WRITE)
      ? null
      : `写操作（${method}）需要 manifest 声明 '${CAP_API_WRITE}' 能力（普通只读调用请用 get）`;
  }

  // ── 浏览器侧：ISocketService —— 禁止插件断开课堂 socket ────────────────
  if (tokens.socketService && token === tokens.socketService) {
    if (method === 'disconnect' || method === 'destroy') {
      return `插件无权调用 ${method}()——断开课堂实时通道会中断正在进行的教学`;
    }
    return null;
  }

  // ── 浏览器侧：ISemesterGradeService —— 写入需 grades:write ─────────────
  if (tokens.semesterGradeService && token === tokens.semesterGradeService) {
    if (method.startsWith('save') || method.startsWith('write') || method.startsWith('set')) {
      return hasCapability(caps, CAP_GRADES_WRITE)
        ? null
        : `写入学期成绩需要 manifest 声明 '${CAP_GRADES_WRITE}' 能力（'grades' 或 'grades:read' 不足以解锁写入）`;
    }
    return null;
  }

  // ── 后端：IProcessService —— 注册常驻任务需 capability ────────────────
  //
  // 注意这里**只管能力门禁，不管归属**。归属校验（kill 别人进程、handler 被顶掉）
  // 不属于「方法策略」，而在 `context-builder.wrapProcessManager` 里做 ——
  // 放错层会导致 ServiceHost 与 inline 两条路径判定不一致。
  if (tokens.processService && token === tokens.processService) {
    if (method === 'registerHandler' || method === 'registerInterval') {
      return hasCapability(caps, CAP_TASK_REGISTER)
        ? null
        : `注册后台任务（${method}）需要 manifest 声明 '${CAP_TASK_REGISTER}' 能力`;
    }
    if (method === 'restore') {
      // restore 会把所有 status='running' 的进程重新 resume，其中包括**其他插件**
      // 的进程（`SELECT * FROM processes WHERE status='running'` 无 owner 过滤）。
      return hasCapability(caps, CAP_TASK_REGISTER)
        ? null
        : `恢复后台任务（restore）会重放全部插件的 running 进程，需要 manifest 声明 '${CAP_TASK_REGISTER}' 能力`;
    }
    return null;
  }

  // ── 后端：IAIService —— 驱动 AI 生成需 capability ─────────────────────
  if (tokens.aiService && token === tokens.aiService) {
    if (method === 'generateText' || method === 'chat' || method === 'complete') {
      return hasCapability(caps, CAP_AI_INVOKE)
        ? null
        : `调用 AI 生成（${method}）需要 manifest 声明 '${CAP_AI_INVOKE}' 能力`;
    }
    return null;
  }

  // ── 后端：IActionRegistryService —— 对外暴露 action 给 AI Agent 需 capability ──
  //
  // ActionDescriptor.exposeToAgent（默认 true，见 packages/core/registry）决定了
  // 该 action 是否进入 `getAgentTools()`，也就是**是否成为 AI 可调用的工具**。
  // 未声明能力的插件可以通过反复 register/unregister 把自己的 action 塞进 Agent
  // 工具列表，让 AI 代为执行 —— 这是能力边界的放大器，故单独设门。
  if (tokens.actionRegistry && token === tokens.actionRegistry) {
    if (method === 'register') {
      const descriptor = Array.isArray(args) ? args[0] : undefined;
      const exposed = (descriptor as { exposeToAgent?: boolean } | undefined)?.exposeToAgent;
      // 未显式声明 exposeToAgent 时按默认 true 处理（与 registry 的默认值一致）
      if (exposed === undefined || exposed !== false) {
        return hasCapability(caps, CAP_AGENT_TOOL)
          ? null
          : `注册对外暴露的 action 需要 manifest 声明 '${CAP_AGENT_TOOL}' 能力` +
              `（如不希望进入 AI Agent 工具列表，请设置 exposeToAgent: false）`;
      }
    }
    return null;
  }

  // ── 两端共用：IStorageService —— 允许（已在 DB 层按 plugin_id 隔离）────
  if (tokens.storageService && token === tokens.storageService) return null;
  // ── 浏览器侧：IUIService —— 允许 ─────────────────────────────────────
  if (tokens.uiService && token === tokens.uiService) return null;

  // 未列入本策略的 Token：不在此处裁决，交由 Barrier 1 白名单负责。
  return null;
}

/**
 * ## 残余风险（诚实说明）
 *
 * 1. **本层挡不住服务端鉴权之外的一切**。它只看方法名与路径形状，
 *    无法理解业务语义。`post('/api/lessons')`（建课时）被判为普通写入并放行，
 *    但它同样是数据变更。
 * 2. **路径前缀表是静态的**，新增高危端点时若忘记登记，新端点会以「普通路径」
 *    被放行。因此新增写端点时应同步检查本表。
 * 3. **capability 字符串仍由插件自填**。声明 `api:admin` 就真的拿到了它 ——
 *    本层只要求「声明得更具体」，不构成独立于 manifest 的授权。
 * 4. **只读路径同样可被用于信息聚合**：插件可以连续 `get` 任意路径收集数据后外传。
 * 5. 真正的兜底是服务端每个端点自己的 `requireAuth` / `requireAuth(role)` 与
 *    CapabilityGuard。本层只是降低失误与被植入逻辑时的爆炸半径。
 *
 * ## 为什么命名空间表刻意不收录教学核心路径
 *
 * `/api/classes`、`/api/students`、`/api/lessons` 这些命名空间里既有 `POST`
 * （建课时、导入名单）也有 `DELETE`（删班级、删学生）。整段列为高危会挡住大量
 * 正当插件行为（如插件代记考勤），全放行又会漏掉不可逆删除。
 * 因此改用下方两条**按路径形状**的规则兜底，比整段拦截更精准。
 */
