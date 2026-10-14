/** 与 server/services/classroom-class-lock.ts 同一组「进行中」阶段。 */
const LOCKED_STAGES = new Set(['IN_CLASS_TEACHING', 'WRAP_UP_EXIT_TICKET']);

export function isInProgressClassLocked(stage: string | null | undefined): boolean {
  return !!stage && LOCKED_STAGES.has(stage);
}

export function classLockHint(lang: string): string {
  return lang === 'zh' ? '需结束本节课才能换班' : 'End this lesson before switching classes';
}
