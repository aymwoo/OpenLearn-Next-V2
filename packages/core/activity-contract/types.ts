/**
 * OpenLearn Activity Contract — 跨活动体系的共享类型与 ID 命名空间。
 *
 * 该包只允许包含类型与纯函数，禁止 import `server/`、`packages/core/` 的运行时模块，
 * 以免在 kernel / plugin-host / activity-ecosystem 之间形成环。
 */

export type ActivityKind = 'provider' | 'xuean' | 'lesson-engine' | 'classroom-legacy';

/** 形如 `provider:official_quiz` / `xuean:9f3c...` / `lesson-engine:quiz` */
export type ActivityId = `${ActivityKind}:${string}`;

export type ActivityActorRole = 'teacher' | 'student' | 'administrator' | 'assistant';

export type ActivityRunState = 'created' | 'running' | 'paused' | 'interrupted' | 'finished' | 'failed' | 'cancelled';

/** 所有活动体系共享的“定义”元数据。 */
export interface ActivityDescriptorBase {
  readonly kind: ActivityKind;
  readonly activityId: ActivityId;
  readonly title: string;
  readonly category: string;
  readonly icon?: string;
  readonly description?: string;
  readonly roles?: ReadonlyArray<ActivityActorRole>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly deprecated?: {
    readonly since: string;
    readonly removedIn?: string;
    readonly replacement?: string;
  };
}

/** 一次活动运行。定义（Descriptor）与运行（Run）在主键与语义上严格分离。 */
export interface ActivityRunRef {
  readonly runId: string;
  readonly activityId: ActivityId;
  readonly lessonId?: string;
  readonly classId?: string;
  readonly state: ActivityRunState;
  readonly startedAt?: number;
  readonly endedAt?: number;
}

/** 各活动实现可选的统一生命周期。provider 已实现；其余体系按需适配。 */
export interface ActivityLifecycle<TContext> {
  initialize?(ctx: TContext): Promise<void> | void;
  start(ctx: TContext, payload?: Record<string, unknown>): Promise<unknown>;
  pause?(ctx: TContext): Promise<void> | void;
  resume?(ctx: TContext): Promise<void> | void;
  finish?(ctx: TContext): Promise<void> | void;
  dispose?(ctx: TContext): Promise<void> | void;
}

export interface ExtensionSlotRef {
  readonly slot: string;
  readonly pluginId: string;
  readonly id: string;
}

export interface ExtensionHookRef {
  readonly name: string;
  readonly count: number;
}

export interface ExtensionDeprecationRef {
  readonly id: string;
  readonly since: string;
  readonly removedIn?: string;
  readonly replacement?: string;
}

/** 只读扩展目录：聚合 slot / 活动 / hooks / 弃用元数据。 */
export interface IExtensionCatalog {
  listSlots(): ReadonlyArray<ExtensionSlotRef>;
  listActivities(kind?: ActivityKind): ReadonlyArray<ActivityDescriptorBase>;
  listHooks(): ReadonlyArray<ExtensionHookRef>;
  getDeprecations(): ReadonlyArray<ExtensionDeprecationRef>;
}

const ACTIVITY_KINDS: ReadonlySet<string> = new Set<ActivityKind>([
  'provider',
  'xuean',
  'lesson-engine',
  'classroom-legacy',
]);

export function makeActivityId(kind: ActivityKind, localId: string): ActivityId {
  if (!localId) throw new Error('Activity localId must be non-empty');
  return `${kind}:${localId}` as ActivityId;
}

export function parseActivityId(value: string): { kind: ActivityKind; localId: string } | null {
  const idx = value.indexOf(':');
  if (idx <= 0 || idx === value.length - 1) return null;
  const kind = value.slice(0, idx);
  if (!ACTIVITY_KINDS.has(kind)) return null;
  return { kind: kind as ActivityKind, localId: value.slice(idx + 1) };
}

export function isActivityId(value: string): value is ActivityId {
  return parseActivityId(value) !== null;
}
