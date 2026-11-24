/**
 * Vitest 临时测试库的回收判定（阶段 13.1）。
 *
 * 库文件名为 `openlearn_test_<poolId>_<pid>.db`（WAL/SHM 带后缀）。
 * 回收策略：
 * - 文件里记录的 pid 已不存在 → 该库不可能仍被使用，立即删除；
 * - pid 仍存活 → 一律保留（可能是其他并发 worker）；
 * - 文件名无法解析 pid（历史遗留）→ 仅按 24 小时兜底。
 *
 * 纯函数化是为了让判定可以被单测覆盖，而不依赖真实进程。
 */

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const TEST_DB_FILE_PATTERN = /^openlearn_test_\d+_(\d+)\.db(?:-wal|-shm)?$/;

/** 从测试库文件名解析进程 pid；不符合命名规则返回 null。 */
export function parseTestDbFilePid(entry: string): number | null {
  const match = TEST_DB_FILE_PATTERN.exec(entry);
  return match ? Number(match[1]) : null;
}

export interface ReclaimDecisionInput {
  entry: string;
  mtimeMs: number;
  now: number;
  currentPid: number;
  /** 注入进程存活探测，便于测试。 */
  isAlive: (pid: number) => boolean;
  maxAgeMs?: number;
}

/** 是否应删除该临时库文件。 */
export function shouldReclaimTestDbFile(input: ReclaimDecisionInput): boolean {
  // 旧方案遗留的 pid 哨兵，直接清掉。
  if (input.entry.startsWith('.reset-')) return true;

  const pid = parseTestDbFilePid(input.entry);
  if (pid !== null) {
    if (pid === input.currentPid) return false;
    return !input.isAlive(pid);
  }

  return input.now - input.mtimeMs > (input.maxAgeMs ?? MAX_AGE_MS);
}
