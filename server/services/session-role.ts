/**
 * 会话角色的**唯一真源**（Issue #226）。
 *
 * ## 为什么需要这个模块
 *
 * 仓库里此前有三套互不一致的「谁是管理员」判定：
 *
 * | 位置 | 读什么 | 管理员判定 |
 * | --- | --- | --- |
 * | `middleware/auth.ts` 的 `requireAuth` | `session.role` | 叠加 `username==='admin'` / `userId==='usr_admin'` 硬编码 |
 * | `middleware/auth.ts` 的 `getActorId` | `session.subRole \|\| session.role` | 同上 |
 * | `services/class-access.ts` 的 `isAdministrator` | `session.role` / `session.subRole` | 同上（外加硬编码） |
 *
 * 而会话本身是这么造的（`server/routes/roster.ts` 的 staff 登录分支）：
 *
 * ```ts
 * sessionData = { role: 'teacher', userId: userObj.id, subRole: userObj.role, ... };
 * ```
 *
 * —— **任何** staff 账号的 `session.role` 都是 `'teacher'`，管理员身份只存在于
 * `subRole` 里。于是通过用户管理创建的 `role='administrator'` 账号：
 *
 * - `requireAuth('administrator')` 读 `session.role` → `'teacher'` → **403**；
 * - `getActorId` 读 `subRole` → `'administrator'` → 能力判定**放行**。
 *
 * 同一个账号在两类接口上权限表现相反 —— 这正是本 issue 要修的。
 *
 * ## 口径
 *
 * 1. **细分角色优先**：`subRole`（staff 账号的真实角色）→ 回退 `role`；
 * 2. `'admin'` 归一为 `'administrator'`；
 * 3. 白名单外一律 `'anonymous'`（含被注入的 `subRole`）——
 *    `session_data` 是持久化数据，注入一个 `subRole:'administrator'` 不应该能提权；
 * 4. **不再**用 `username==='admin'` / `userId==='usr_admin'` 这类硬编码身份兜底：
 *    管理员身份由 `users` 表的 `role` 决定，登录时写进 `session.subRole`。
 *
 * @module
 */

/** 会话角色白名单 —— 与 `getValidSession` 对 `session.role` 的白名单一致。 */
const SESSION_ROLE_WHITELIST = new Set(['administrator', 'teacher', 'student', 'anonymous']);

/** 判定所需的会话字段（结构化兼容 `Session` 与 `AccessSession`）。 */
export interface SessionRoleSource {
  userId?: string;
  studentId?: string;
  username?: string;
  role?: string;
  subRole?: string;
}

/**
 * 会话的**有效角色**。
 *
 * @returns `'administrator' | 'teacher' | 'student' | 'anonymous'`
 */
export function resolveSessionRole(session: SessionRoleSource | null | undefined): string {
  if (!session) return 'anonymous';
  // 先看细分角色，再回退粗粒度角色；两个来源都不合法时降级为 anonymous。
  for (const candidate of [session.subRole, session.role]) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    const normalized = candidate === 'admin' ? 'administrator' : candidate;
    if (SESSION_ROLE_WHITELIST.has(normalized)) return normalized;
  }
  return 'anonymous';
}

/** 是否为管理员（与路由守卫、能力判定共用同一口径）。 */
export function isAdministrator(session: SessionRoleSource | null | undefined): boolean {
  return resolveSessionRole(session) === 'administrator';
}

/**
 * 是否为**普通教师**。
 *
 * 管理员不算教师 —— 面向对象级归属判定（如「是不是该班的任课教师」）时，
 * 管理员走各自独立的旁路，不应被当成任课教师。
 */
export function isTeacher(session: SessionRoleSource | null | undefined): boolean {
  if (!session || isAdministrator(session)) return false;
  return resolveSessionRole(session) === 'teacher';
}
