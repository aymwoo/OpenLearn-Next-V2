/**
 * OpenLearn V2 - Navigation System Registry Adapter (PF-02)
 * Decouples built-in tabs and plugin-contributed tabs into a unified,
 * grouped, and permission-guarded Navigation Architecture.
 */

import React from 'react';
import {
  BookOpen,
  Presentation,
  Users,
  Calendar as CalendarIcon,
  Home,
  BarChart2,
} from 'lucide-react';
import type { ExtensionPointConfig } from '../../plugin-host/types';

export type NavigationGroupKey = 'teaching' | 'management' | 'analytics' | 'extension';

export interface NavigationGroupMetadata {
  key: NavigationGroupKey;
  label: { zh: string; en: string };
  position: number;
}

export const NAVIGATION_GROUPS: Record<NavigationGroupKey, NavigationGroupMetadata> = {
  teaching: {
    key: 'teaching',
    label: { zh: '教学工具', en: 'Teaching Tools' },
    position: 10,
  },
  management: {
    key: 'management',
    label: { zh: '系统管理', en: 'System Management' },
    position: 20,
  },
  analytics: {
    key: 'analytics',
    label: { zh: '数据分析', en: 'Analytics & Reports' },
    position: 30,
  },
  extension: {
    key: 'extension',
    label: { zh: '扩展应用', en: 'Extensions' },
    position: 40,
  },
};

export interface BuiltinNavItem {
  id: string;
  label: { zh: string; en: string };
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: NavigationGroupKey;
  rolesAllowed: ('admin' | 'teacher' | 'student')[];
  position: number;
  badge?: number | string;
  lazyComponent?: () => Promise<{ default: React.ComponentType<any> }>;
}

/**
 * Registry catalog of all built-in platform navigation entries.
 */
export const BUILTIN_NAV_ITEMS: BuiltinNavItem[] = [
  {
    id: 'courseware',
    label: { zh: '课件库', en: 'Courseware' },
    icon: BookOpen,
    group: 'teaching',
    rolesAllowed: ['admin', 'teacher', 'student'],
    position: 10,
  },
  {
    id: 'whiteboard',
    label: { zh: '互动白板', en: 'Whiteboard' },
    icon: Presentation,
    group: 'teaching',
    rolesAllowed: ['admin', 'teacher', 'student'],
    position: 20,
  },
  {
    id: 'class',
    label: { zh: '课堂监控', en: 'Live Class' },
    icon: Users,
    group: 'teaching',
    rolesAllowed: ['admin', 'teacher'],
    position: 30,
  },
  {
    id: 'timetable',
    label: { zh: '课程表', en: 'Timetable' },
    icon: CalendarIcon,
    group: 'management',
    rolesAllowed: ['admin', 'teacher'],
    position: 10,
    lazyComponent: () => import('../../components/TimetableManager').then(m => ({ default: m.TimetableManager })),
  },
  {
    id: 'computer-lab',
    label: { zh: '电子机房', en: 'Computer Lab' },
    icon: Home,
    group: 'management',
    rolesAllowed: ['admin', 'teacher'],
    position: 20,
    lazyComponent: () => import('../../components/ComputerLabManager').then(m => ({ default: m.ComputerLabManager })),
  },
  {
    id: 'semester-grades',
    label: { zh: '成绩管理', en: 'Semester Grades' },
    icon: BarChart2,
    group: 'analytics',
    rolesAllowed: ['admin', 'teacher'],
    position: 10,
    lazyComponent: () => import('../../components/SemesterGradeManager').then(m => ({ default: m.SemesterGradeManager })),
  },
];

/**
 * Unified Navigation Entry Item (Builtin or Plugin-contributed)
 */
export interface UnifiedNavItem {
  id: string;
  pluginId?: string;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }> | string;
  group: NavigationGroupKey;
  position: number;
  rolesAllowed?: ('admin' | 'teacher' | 'student')[];
  badge?: number | string;
  isPlugin: boolean;
  rawPluginConfig?: ExtensionPointConfig;
  lazyComponent?: () => Promise<{ default: React.ComponentType<any> }>;
}

/**
 * Filter and resolve navigation items by current user role and active plugins.
 */
export function resolveUnifiedNavigationItems(
  role: 'admin' | 'teacher' | 'student',
  lang: 'zh' | 'en',
  pluginExtensionPoints: ExtensionPointConfig[],
): Record<NavigationGroupKey, UnifiedNavItem[]> {
  const groups: Record<NavigationGroupKey, UnifiedNavItem[]> = {
    teaching: [],
    management: [],
    analytics: [],
    extension: [],
  };

  // 1. Process Built-in Items
  for (const item of BUILTIN_NAV_ITEMS) {
    if (!item.rolesAllowed.includes(role)) continue;

    groups[item.group].push({
      id: item.id,
      label: item.label[lang] || item.label.zh,
      icon: item.icon,
      group: item.group,
      position: item.position,
      rolesAllowed: item.rolesAllowed,
      badge: item.badge,
      isPlugin: false,
      lazyComponent: item.lazyComponent,
    });
  }

  // 2. Process Plugin Contributions (Slot: teacher.tab)
  for (const pluginItem of pluginExtensionPoints) {
    if (pluginItem.rolesAllowed && !pluginItem.rolesAllowed.includes(role)) {
      continue;
    }

    const targetGroup: NavigationGroupKey = (pluginItem.group as NavigationGroupKey) || 'extension';
    const groupKey: NavigationGroupKey = groups[targetGroup] ? targetGroup : 'extension';

    groups[groupKey].push({
      id: pluginItem.id,
      pluginId: pluginItem.pluginId,
      label: pluginItem.label,
      icon: pluginItem.icon,
      group: groupKey,
      position: pluginItem.position ?? 100,
      rolesAllowed: pluginItem.rolesAllowed,
      badge: pluginItem.badge,
      isPlugin: true,
      rawPluginConfig: pluginItem,
      lazyComponent: pluginItem.component,
    });
  }

  // 3. Sort items inside each group by position ascending
  for (const key of Object.keys(groups) as NavigationGroupKey[]) {
    groups[key].sort((a, b) => a.position - b.position);
  }

  return groups;
}
