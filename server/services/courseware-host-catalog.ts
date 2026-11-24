/**
 * 课件宿主（`courseware.host`）解析器。
 *
 * 内置 `CoursewareHost` 是默认宿主；插件可通过 manifest 的
 * `contributes['courseware.host']` 声明自己的宿主，并用 `replaces: 'builtin'`
 * 申请接管。接管规则：
 *
 * - 只有 `replaces === 'builtin'` 的条目参与竞选，其余仅出现在目录里；
 * - 多个候选按 `priority` 降序，同优先级按插件 id 字典序稳定决出唯一赢家；
 * - 落选者作为冲突记录返回并打日志，调用方应继续使用内置宿主（安全回落）。
 */
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { manifestSchema } from '../../packages/core/esm-loader/manifest-schema.js';
import type { CoursewareHostConfig } from '../../packages/core/plugin-host/contribution-registry.js';

export interface CoursewareHostCandidate extends CoursewareHostConfig {
  pluginId: string;
  pluginName: string;
}

export interface CoursewareHostDirectory {
  candidates: CoursewareHostCandidate[];
  /** 主动申请接管内置宿主的候选 */
  takeoverCandidates: CoursewareHostCandidate[];
  /** 落选的接管候选（按优先级排序后除第一名） */
  conflicts: string[];
}

export interface CoursewareHostResolution {
  kind: 'builtin' | 'plugin';
  host: CoursewareHostCandidate | null;
  conflicts: string[];
  reason?: string;
}

export interface CoursewareHostPluginRecord {
  id?: string;
  name?: string;
  state?: string;
  status?: string;
  manifest?: string | Record<string, unknown> | null;
}

function parseManifest(record: CoursewareHostPluginRecord): Record<string, unknown> | null {
  if (!record.manifest) return null;
  if (typeof record.manifest === 'object') return record.manifest as Record<string, unknown>;
  try {
    return JSON.parse(record.manifest);
  } catch {
    return null;
  }
}

function isActive(record: CoursewareHostPluginRecord): boolean {
  return record.state === 'active' || record.status === 'active';
}

/** 从插件列表构建宿主目录（纯函数，便于测试）。 */
export function collectCoursewareHosts(plugins: readonly CoursewareHostPluginRecord[]): CoursewareHostDirectory {
  const candidates: CoursewareHostCandidate[] = [];

  for (const plugin of plugins) {
    if (!isActive(plugin)) continue;
    const raw = parseManifest(plugin);
    if (!raw) continue;
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) continue;

    const hosts = parsed.data.contributes?.['courseware.host'] ?? [];
    for (const host of hosts) {
      candidates.push({
        ...(host as CoursewareHostConfig),
        pluginId: parsed.data.id,
        pluginName: parsed.data.name,
      });
    }
  }

  const takeoverCandidates = candidates
    .filter((candidate) => candidate.replaces === 'builtin')
    .sort((a, b) => {
      const priority = (b.priority ?? 0) - (a.priority ?? 0);
      if (priority !== 0) return priority;
      return a.pluginId.localeCompare(b.pluginId);
    });

  return {
    candidates,
    takeoverCandidates,
    conflicts: takeoverCandidates.slice(1).map((candidate) => `${candidate.pluginId}:${candidate.id}`),
  };
}

/** 从目录决出唯一生效宿主；无候选时回落内置。 */
export function pickCoursewareHost(directory: CoursewareHostDirectory): CoursewareHostResolution {
  const [winner] = directory.takeoverCandidates;
  if (!winner) return { kind: 'builtin', host: null, conflicts: [] };
  if (directory.conflicts.length > 0) {
    console.warn(
      `[courseware-host] 多个插件申请接管课件宿主，已选用 ${winner.pluginId}:${winner.id}（priority=${
        winner.priority ?? 0
      }），忽略：${directory.conflicts.join(', ')}`,
    );
  }
  return { kind: 'plugin', host: winner, conflicts: directory.conflicts };
}

function readActivePluginRecords(): readonly CoursewareHostPluginRecord[] {
  try {
    return (kernelContainer.pluginLifecycleManager?.listPlugins() ?? []) as readonly CoursewareHostPluginRecord[];
  } catch {
    return [];
  }
}

/** 读取当前生效的课件宿主（插件宿主不可用时回落内置）。 */
export function resolveCoursewareHost(): CoursewareHostResolution {
  return pickCoursewareHost(collectCoursewareHosts(readActivePluginRecords()));
}

/** 供管理端/健康检查查看完整宿主目录。 */
export function listCoursewareHosts(): CoursewareHostDirectory {
  return collectCoursewareHosts(readActivePluginRecords());
}
