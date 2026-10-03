/**
 * 前端 Worker 插件的方法 / 路径级调用策略 —— ServiceHost 的 Security Barrier 3。
 *
 * ## 为什么需要这一层（背景）
 *
 * `allowed-tokens.ts`（Barrier 1）管的是 **Token 粒度**，`service-host.ts` 的
 * Barrier 2 管的是 **"manifest 是否声明过任意能力"**。两者都不够：
 *
 * 1. Barrier 2 在 `capabilitiesProposed` 数据链打通后，变成了"按插件自己写的
 *    manifest 声明判定" —— 声明方与被判定方是同一个人。
 * 2. 基础白名单含 `IFrontendAPI`，而它是**对任意 path 的同源 fetch**
 *    （`src/services/frontend-api.ts`，`credentials: 'same-origin'`），
 *    且提供 `post(path, body)` / `del(path)`。
 *
 * 合起来的效果是：插件只要在**自己的 manifest** 里写一条 `["ui:fancy"]` 之类的
 * 任意字符串，就能对当前登录用户的**整个 REST 面**发 POST / DELETE，包括
 * `DELETE /api/plugins/:id`（无确认、无回滚）与 `/api/agent/chat`（驱动 AI agent）。
 *
 * ## 本层的定位：纵深防御，不是访问控制
 *
 * **真正的权限边界在服务端** —— 每个 REST 端点各自校验 session cookie 与角色，
 * 插件无法绕过。因此本层不试图"正确判定"一个请求是否合法（那需要逐端点的
 * 业务语义），只做一件事：**把"任意一条声明 = 全部写能力"这个爆炸半径收窄**。
 *
 * 已知挡不住的情况见文件末尾「残余风险」。
 *
 * @module
 */

import {
  FRONTEND_API_TOKEN,
  SOCKET_SERVICE_TOKEN,
  UI_SERVICE_TOKEN,
  STORAGE_SERVICE_TOKEN,
  SEMESTER_GRADE_SERVICE_TOKEN,
} from './types';

// ── capability 名称 ───────────────────────────────────────────────────────────

/** 授予 IFrontendAPI 写操作（POST/PUT/PATCH/DELETE）到普通路径所需。 */
export const CAP_API_WRITE = 'api:write';

/** 授予高危路径写操作所需。 */
export const CAP_API_ADMIN = 'api:admin';

/** 授予学期成绩**写入**（`grades:read` 不足以解锁写入）。 */
export const CAP_GRADES_WRITE = 'grades:write';

// ── 高危路径前缀 ──────────────────────────────────────────────────────────────

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

// ── 策略判定 ──────────────────────────────────────────────────────────────────

/** 判断 manifest 声明里是否出现了某个 capability（含 `name:*` 与通配 `*`）。 */
function hasCapability(caps: readonly string[], name: string): boolean {
  return caps.some(
    (c) => typeof c === 'string' && (c === name || c === '*' || c.startsWith(`${name}:`)),
  );
}

/**
 * 对一次服务调用做方法 / 路径级判定。
 *
 * @param token - 被调用的服务 Token
 * @param method - 被调用的方法名
 * @param args - 调用参数（IFrontendAPI 的首个参数会被当作路径解析）
 * @param caps - 插件 manifest 声明的 capabilitiesProposed
 * @returns 允许时返回 `null`；拒绝时返回**面向人的原因说明**
 */
export function checkMethodPolicy(
  token: string,
  method: string,
  args: unknown,
  caps: readonly string[] = [],
): string | null {
  switch (token) {
    // ── IFrontendAPI：默认只读，写操作需专门 capability ──────────────
    case FRONTEND_API_TOKEN: {
      const isRead = method === 'get' || method.startsWith('get');
      if (isRead) return null;

      // 少数无副作用的辅助方法不视为写操作
      if (method === 'request' && !Array.isArray(args)) return null;

      const path = extractPathArg(args);
      const isHighRisk = HIGH_RISK_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
      // 不可逆子路径（与命名空间无关），如 GDPR 数据抹除
      const isIrreversible = IRREVERSIBLE_PATH_SUFFIXES.some((s) => path.endsWith(s));
      // 实体级删除：/api/<ns>/<id> 恰好三段，且方法为 del
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

    // ── ISocketService：禁止插件断开课堂 socket ──────────────────────
    case SOCKET_SERVICE_TOKEN: {
      if (method === 'disconnect' || method === 'destroy') {
        return `插件无权调用 ${method}()——断开课堂实时通道会中断正在进行的教学`;
      }
      return null;
    }

    // ── ISemesterGradeService：写入需 grades:write ────────────────────
    case SEMESTER_GRADE_SERVICE_TOKEN: {
      if (method.startsWith('save') || method.startsWith('write') || method.startsWith('set')) {
        return hasCapability(caps, CAP_GRADES_WRITE)
          ? null
          : `写入学期成绩需要 manifest 声明 '${CAP_GRADES_WRITE}' 能力（'grades' 或 'grades:read' 不足以解锁写入）`;
      }
      return null;
    }

    // ── IUIService / IStorageService：允许，保留给 UI 与本地状态用途 ──
    case UI_SERVICE_TOKEN:
    case STORAGE_SERVICE_TOKEN:
      return null;

    // 未列入本策略的 Token：不在此处裁决，交由 Barrier 1 白名单负责。
    default:
      return null;
  }
}

/**
 * ## 残余风险（诚实说明）
 *
 * 1. **本层挡不住服务端鉴权绕过之外的一切**。它只看方法名与路径前缀，
 *    无法理解业务语义。`post('/api/lessons')`（建课时）被判为普通写入并放行，
 *    但它同样是数据变更。
 * 2. **路径前缀表是静态的**，新增高危端点时若忘记登记，新端点会以"普通路径"
 *    被放行。因此新增写端点时应同步检查本表。
 * 3. **capability 字符串仍由插件自填**。声明 `api:admin` 就真的拿到了它 ——
 *    本层只要求"声明得更具体"，不构成独立于 manifest 的授权。
 * 4. **只读路径同样可被用于信息聚合**：插件可以连续 `get` 任意路径收集数据后外传。
 * 5. 真正的兜底是服务端每个端点自己的 `requireAuth` / `requireAuth(role)` 与
 *    CapabilityGuard。本层只是降低失误与被植入逻辑时的爆炸半径。
 *
 * ## 为什么命名空间表刻意不收录教学核心路径
 *
 * `/api/classes`（24 个写端点）、`/api/students`、`/api/lessons` 这些命名空间里
 * 既有 `POST`（建课时、导入名单）也有 `DELETE`（删班级、删学生）。整段列为高危会
 * 挡住大量正当插件行为（如插件代记考勤），全放行又会漏掉不可逆删除。
 * 因此改用下方两条**按路径形状**的规则兜底，比整段拦截更精准。
 */
