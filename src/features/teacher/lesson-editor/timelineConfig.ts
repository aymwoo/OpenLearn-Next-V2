import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { PlayCircle, Presentation, Wrench, HelpCircle, CheckCircle2, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

export interface SegmentTypeMeta {
  id: string;
  labelZh: string;
  labelEn: string;
  icon: LucideIcon;
  /** Owning plugin id when contributed by a third-party plugin */
  pluginId?: string;
}

export interface SegmentColorMeta {
  name: string;
  /** 浅色，用于 seg.color / 未选中节点 */
  color: string;
  /** 实心填充，用于选中节点（含 ring） */
  solid: string;
  /** 进度轨道着色 */
  rail: string;
}

export const SEGMENT_TYPES: SegmentTypeMeta[] = [
  { id: 'intro', labelZh: '准备环节', labelEn: 'Intro', icon: PlayCircle },
  { id: 'lecture', labelZh: '讲授新课', labelEn: 'Lecture', icon: Presentation },
  { id: 'practice', labelZh: '互动练习', labelEn: 'Practice', icon: Wrench },
  { id: 'quiz', labelZh: '随堂测试', labelEn: 'Quiz', icon: HelpCircle },
  { id: 'summary', labelZh: '要点总结', labelEn: 'Summary', icon: CheckCircle2 },
];

interface CustomSegmentEntry {
  meta: SegmentTypeMeta;
  pluginId?: string;
}

const customSegmentStore = createStore<{
  items: Map<string, CustomSegmentEntry>;
}>(() => ({
  items: new Map(),
}));

/**
 * Resolve a Lucide icon from a component or string name (PascalCase / kebab-case).
 * Falls back to Layers when the name cannot be resolved.
 */
export function resolveSegmentIcon(icon?: LucideIcon | string | null): LucideIcon {
  // Lucide icons may be function components or forwardRef objects
  if (icon && typeof icon !== 'string') return icon;
  if (typeof icon === 'string' && icon.trim()) {
    const icons = LucideIcons as unknown as Record<string, LucideIcon>;
    if (icons[icon]) return icons[icon];
    const pascalName = icon
      .split(/[-_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    if (icons[pascalName]) return icons[pascalName];
  }
  return Layers;
}

/**
 * Register a plugin-contributed teaching segment type.
 * @param type segment metadata (icon may be a Lucide component)
 * @param pluginId owning plugin id for lifecycle cleanup / ownership checks
 */
export function registerCustomSegmentType(type: SegmentTypeMeta, pluginId?: string): void {
  const resolvedPluginId = pluginId || type.pluginId;
  customSegmentStore.setState((state) => {
    const next = new Map(state.items);
    next.set(type.id, {
      meta: { ...type, icon: resolveSegmentIcon(type.icon), pluginId: resolvedPluginId },
      pluginId: resolvedPluginId,
    });
    return { items: next };
  });
}

/**
 * Unregister a custom segment type.
 * When `pluginId` is provided, only the owning plugin may remove the entry.
 */
export function unregisterCustomSegmentType(id: string, pluginId?: string): void {
  customSegmentStore.setState((state) => {
    const entry = state.items.get(id);
    if (!entry) return state;
    if (pluginId && entry.pluginId !== pluginId) return state;
    const next = new Map(state.items);
    next.delete(id);
    return { items: next };
  });
}

/** Remove every segment type owned by the given plugin (deactivate / uninstall). */
export function unregisterPluginSegmentTypes(pluginId: string): void {
  customSegmentStore.setState((state) => {
    let changed = false;
    const next = new Map(state.items);
    for (const [id, entry] of state.items) {
      if (entry.pluginId === pluginId) {
        next.delete(id);
        changed = true;
      }
    }
    return changed ? { items: next } : state;
  });
}

export function getAllSegmentTypes(): SegmentTypeMeta[] {
  return [...SEGMENT_TYPES, ...Array.from(customSegmentStore.getState().items.values()).map((e) => e.meta)];
}

/**
 * React Hook: built-in + plugin segment types (reference-stable via useShallow).
 */
export function useAllSegmentTypes(): SegmentTypeMeta[] {
  return useStore(
    customSegmentStore,
    useShallow((state) => [...SEGMENT_TYPES, ...Array.from(state.items.values()).map((e) => e.meta)]),
  );
}

export const SEGMENT_COLORS: SegmentColorMeta[] = [
  {
    name: 'Blue',
    color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    solid: 'bg-blue-500 text-white border-blue-500 shadow-md ring-2 ring-blue-200',
    rail: 'bg-blue-400',
  },
  {
    name: 'Indigo',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
    solid: 'bg-indigo-500 text-white border-indigo-500 shadow-md ring-2 ring-indigo-200',
    rail: 'bg-indigo-400',
  },
  {
    name: 'Green',
    color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
    solid: 'bg-green-500 text-white border-green-500 shadow-md ring-2 ring-green-200',
    rail: 'bg-green-400',
  },
  {
    name: 'Purple',
    color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
    solid: 'bg-purple-500 text-white border-purple-500 shadow-md ring-2 ring-purple-200',
    rail: 'bg-purple-400',
  },
  {
    name: 'Amber',
    color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
    solid: 'bg-amber-500 text-white border-amber-500 shadow-md ring-2 ring-amber-200',
    rail: 'bg-amber-400',
  },
];

export const DEFAULT_SEGMENT_COLOR = SEGMENT_COLORS[1].color; // Indigo

export function getSegmentType(type?: string): SegmentTypeMeta {
  return getAllSegmentTypes().find((t) => t.id === type) || SEGMENT_TYPES[1];
}

export function getSegmentColor(color?: string): SegmentColorMeta {
  return SEGMENT_COLORS.find((c) => c.color === color) || SEGMENT_COLORS[1];
}
