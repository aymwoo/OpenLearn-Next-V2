import { describe, it, expect } from 'vitest';
import {
  BUILTIN_NAV_ITEMS,
  NAVIGATION_GROUPS,
  resolveUnifiedNavigationItems,
} from '../navigation-registry';
import type { ExtensionPointConfig } from '../../../plugin-host/types';

describe('Navigation System Registry Adapter (PF-02)', () => {
  it('should contain exact 4 navigation groups including "系统管理"', () => {
    expect(NAVIGATION_GROUPS.teaching.label.zh).toBe('教学工具');
    expect(NAVIGATION_GROUPS.management.label.zh).toBe('系统管理');
    expect(NAVIGATION_GROUPS.analytics.label.zh).toBe('数据分析');
    expect(NAVIGATION_GROUPS.extension.label.zh).toBe('扩展应用');
  });

  it('should filter built-in navigation items based on user role', () => {
    const teacherNav = resolveUnifiedNavigationItems('teacher', 'zh', []);
    const studentNav = resolveUnifiedNavigationItems('student', 'zh', []);

    // Teacher should see timetable, lab, and grades under management/analytics
    expect(teacherNav.management.some((i) => i.id === 'timetable')).toBe(true);
    expect(teacherNav.management.some((i) => i.id === 'computer-lab')).toBe(
      true,
    );
    expect(
      teacherNav.analytics.some((i) => i.id === 'semester-grades'),
    ).toBe(true);

    // Student should NOT see timetable or lab in built-in list
    expect(studentNav.management.some((i) => i.id === 'timetable')).toBe(
      false,
    );
    expect(
      studentNav.management.some((i) => i.id === 'computer-lab'),
    ).toBe(false);
  });

  it('should properly categorize plugin contributions into group and handle badge/roles', () => {
    const mockPlugins: ExtensionPointConfig[] = [
      {
        id: 'custom-tool',
        label: '自定义扩展',
        pluginId: 'ext-1',
        group: 'extension',
        badge: 3,
        position: 5,
        component: async () => ({ default: () => null }),
      },
      {
        id: 'admin-only-tool',
        label: '仅管理员可见',
        pluginId: 'ext-2',
        group: 'management',
        rolesAllowed: ['admin'],
        component: async () => ({ default: () => null }),
      },
    ];

    const teacherNav = resolveUnifiedNavigationItems(
      'teacher',
      'zh',
      mockPlugins,
    );
    const adminNav = resolveUnifiedNavigationItems('admin', 'zh', mockPlugins);

    expect(teacherNav.extension.some((i) => i.id === 'custom-tool')).toBe(
      true,
    );
    expect(teacherNav.extension.find((i) => i.id === 'custom-tool')?.badge).toBe(
      3,
    );

    // Teacher should NOT see admin-only tool
    expect(
      teacherNav.management.some((i) => i.id === 'admin-only-tool'),
    ).toBe(false);

    // Admin SHOULD see admin-only tool under management group
    expect(adminNav.management.some((i) => i.id === 'admin-only-tool')).toBe(
      true,
    );
  });
});
