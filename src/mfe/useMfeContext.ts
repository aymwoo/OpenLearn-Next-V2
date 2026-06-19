/**
 * useMfeContext — Consumer convenience hook combining MfeConfig + MfeInfraContext.
 *
 * D-02: Remote components consume platform capabilities through useMfeContext()
 *       without manual prop drilling.
 *
 * Usage:
 *   // In any descendant of both MfeConfigProvider and MfeContextProvider:
 *   const { config, infra } = useMfeContext();
 *   console.log(config.defaultTimeout);  // 30000
 *   infra.eventBus?.emit('lesson.created', lessonId);
 */

import { useMfeConfig } from './MfeConfigProvider';
import { useMfeInfraContext } from './MfeContextProvider';
import type { MfeConfigDefaults } from './MfeConfigProvider';
import type { MfeContext } from './MfeContextProvider';

export interface UseMfeContextResult {
  config: MfeConfigDefaults;
  infra: MfeContext;
}

/**
 * Combined convenience hook for consuming MFE context.
 *
 * Returns both configuration defaults and platform infrastructure.
 * Requires that both MfeConfigProvider and MfeContextProvider are
 * ancestors in the React tree — throws with descriptive errors otherwise.
 */
export function useMfeContext(): UseMfeContextResult {
  const config = useMfeConfig();
  const infra = useMfeInfraContext();
  return { config, infra };
}
