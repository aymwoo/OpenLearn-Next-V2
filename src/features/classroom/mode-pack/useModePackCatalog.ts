/**
 * 模式包目录（前端缓存）。
 *
 * `GET /api/mode-packs` 的结果在同一次页面生命周期内只拉取一次：课堂顶栏、课程
 * 列表等消费点共用同一份目录，避免每个组件各拉一遍。拉取失败或未配置时返回空
 * 目录，调用方按 `delivery_mode` 回落，旧课行为不变。
 */
import { useEffect, useState } from 'react';
import {
  resolveLessonModePackDeliveryMode,
  type CourseDeliveryMode,
} from '../../../../packages/core/plugin-host/course-delivery-mode';
import type { ModePackContribution } from '../../../../packages/core/plugin-host/mode-pack';

export interface ModePackCatalogEntry extends ModePackContribution {
  source: 'builtin' | 'plugin';
  pluginId?: string;
  pluginName?: string;
  /** 服务端能力诊断：声明了但未注册的 adapter / channel。 */
  warnings?: string[];
}

export interface LessonModeView {
  mode: CourseDeliveryMode;
  /** 徽标展示名：模式包目录优先，缺失时回落「白板 / 学案」。 */
  label: string;
  /** 悬停说明：第三方包 id，或不可用包的提示。 */
  title?: string;
}

let catalogCache: ModePackCatalogEntry[] | null = null;
let inflight: Promise<ModePackCatalogEntry[]> | null = null;

function parseEntry(row: Record<string, unknown>): ModePackCatalogEntry | null {
  if (typeof row.id !== 'string' || typeof row.label !== 'string') return null;
  return {
    id: row.id,
    label: row.label,
    labelEn: typeof row.labelEn === 'string' ? row.labelEn : undefined,
    segmentTypes: Array.isArray(row.segmentTypes)
      ? row.segmentTypes.filter((type): type is string => typeof type === 'string')
      : [],
    isDefault: row.isDefault === true,
    prepContributionId: typeof row.prepContributionId === 'string' ? row.prepContributionId : undefined,
    outlineContributionId: typeof row.outlineContributionId === 'string' ? row.outlineContributionId : undefined,
    teacherWorkspaceId: typeof row.teacherWorkspaceId === 'string' ? row.teacherWorkspaceId : undefined,
    studentWorkspaceId: typeof row.studentWorkspaceId === 'string' ? row.studentWorkspaceId : undefined,
    adapterIds: Array.isArray(row.adapterIds)
      ? row.adapterIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    channels: Array.isArray(row.channels)
      ? row.channels.filter((id): id is string => typeof id === 'string')
      : undefined,
    source: row.source === 'plugin' ? 'plugin' : 'builtin',
    pluginId: typeof row.pluginId === 'string' ? row.pluginId : undefined,
    pluginName: typeof row.pluginName === 'string' ? row.pluginName : undefined,
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined,
  };
}

function parseCatalog(body: unknown): ModePackCatalogEntry[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const entry = parseEntry(row as Record<string, unknown>);
    return entry ? [entry] : [];
  });
}

/** 拉取目录（进程内缓存 + 并发去重）。 */
export function loadModePackCatalog(): Promise<ModePackCatalogEntry[]> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (inflight) return inflight;
  if (typeof fetch !== 'function') {
    catalogCache = [];
    return Promise.resolve(catalogCache);
  }

  inflight = fetch('/api/mode-packs')
    .then(async (res) => (res.ok ? parseCatalog(await res.json()) : []))
    .catch(() => [] as ModePackCatalogEntry[])
    .then((entries) => {
      catalogCache = entries;
      inflight = null;
      return entries;
    });
  return inflight;
}

/** 仅测试使用：清空缓存。 */
export function resetModePackCatalogForTests(): void {
  catalogCache = null;
  inflight = null;
}

export function useModePackCatalog(): readonly ModePackCatalogEntry[] {
  const [entries, setEntries] = useState<ModePackCatalogEntry[]>(catalogCache ?? []);

  useEffect(() => {
    if (catalogCache) return;
    let cancelled = false;
    void loadModePackCatalog().then((list) => {
      if (!cancelled) setEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return entries;
}

/** 课时 → 交付模式（`mode_pack_id` 优先，`delivery_mode` 回落）。 */
export function resolveLessonDeliveryMode(
  lesson: { mode_pack_id?: string | null; delivery_mode?: string | null } | null | undefined,
): CourseDeliveryMode {
  return resolveLessonModePackDeliveryMode(lesson?.mode_pack_id, lesson?.delivery_mode);
}

/** 课时 → 课程卡片徽标（模式包目录优先）。 */
export function resolveLessonModeBadge(
  lesson: { mode_pack_id?: string | null; delivery_mode?: string | null } | null | undefined,
  entries: readonly ModePackCatalogEntry[],
  lang: 'zh' | 'en',
): LessonModeView {
  const mode = resolveLessonDeliveryMode(lesson);
  const requestedId = typeof lesson?.mode_pack_id === 'string' ? lesson.mode_pack_id.trim() : '';
  const pack = requestedId ? entries.find((entry) => entry.id === requestedId) : undefined;

  if (pack) {
    return {
      mode,
      label: lang === 'en' ? (pack.labelEn ?? pack.label) : pack.label,
      title: pack.source === 'plugin' ? pack.id : undefined,
    };
  }

  const fallback = mode === 'xuean' ? (lang === 'en' ? 'Guided study' : '学案') : lang === 'en' ? 'Whiteboard' : '白板';
  return {
    mode,
    label: fallback,
    title: requestedId
      ? lang === 'en'
        ? `Mode pack unavailable: ${requestedId}`
        : `模式包不可用：${requestedId}`
      : undefined,
  };
}
