/**
 * manifest-utils.ts — manifest 条目解析工具函数。
 *
 * Phase 6: 解析 requires/optional 条目字符串为结构化 { tokenName, versionRange }。
 *
 * 输入格式:
 *   - `@openlearn/core:ICommandBusService`          → { tokenName, versionRange: null }
 *   - `@openlearn/core:ICommandBusService@^1.0.0`   → { tokenName, versionRange: '^1.0.0' }
 *   - `@openlearn/core:ICommandBusService@~1.2.0`   → { tokenName, versionRange: '~1.2.0' }
 *   - `@openlearn/core:ICommandBusService@1.0.0`    → { tokenName, versionRange: '1.0.0' }
 *   - `@openlearn/core:ICommandBusService@>=1.0.0 <2.0.0` → { tokenName, versionRange: '>=1.0.0 <2.0.0' }
 *
 * 解析策略:
 *   - finds the second '@' character (first '@' is the scope prefix)
 *   - everything before the second '@' is tokenName
 *   - everything after the second '@' is versionRange
 *   - if no second '@' exists, versionRange is null (accept any version)
 */

/**
 * 解析 requires/optional 条目字符串为 token 名称和版本范围。
 *
 * @param entry - requires 条目字符串，如 '@openlearn/core:ICommandBusService@^1.0.0'
 * @returns { tokenName: string, versionRange: string | null }
 *   - tokenName: Token 标识符（不含 @version 后缀）
 *   - versionRange: 版本范围字符串（如 '^1.0.0'）或 null（当无 @version 后缀时）
 *
 * @example
 * parseRequiresEntry('@openlearn/core:ICommandBusService')
 *   // → { tokenName: '@openlearn/core:ICommandBusService', versionRange: null }
 *
 * @example
 * parseRequiresEntry('@openlearn/core:ICommandBusService@^1.0.0')
 *   // → { tokenName: '@openlearn/core:ICommandBusService', versionRange: '^1.0.0' }
 */
export function parseRequiresEntry(entry: string): { tokenName: string; versionRange: string | null } {
  // The first '@' is always the scope prefix (e.g., @openlearn).
  // Find the second '@' which indicates the start of the version range.
  const firstAt = entry.indexOf('@');  // scope prefix @
  if (firstAt === -1) {
    // No @ at all — invalid but handle gracefully
    return { tokenName: entry, versionRange: null };
  }

  // Find the second '@' by searching after the '/' which follows the scope
  const slashIndex = entry.indexOf('/');
  if (slashIndex === -1) {
    // No domain separator — invalid format
    return { tokenName: entry, versionRange: null };
  }

  const secondAtIndex = entry.indexOf('@', slashIndex);
  if (secondAtIndex === -1) {
    // No second '@' — no version range
    return { tokenName: entry, versionRange: null };
  }

  return {
    tokenName: entry.slice(0, secondAtIndex),
    versionRange: entry.slice(secondAtIndex + 1),
  };
}
