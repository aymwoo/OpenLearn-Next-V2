/**
 * Navigation Registry —— 教师工作区侧边栏的数据源
 *
 * 这组用例守的是**已上线**的模型（之前这里测的是一套从未被任何组件使用过的
 * 草案模型：'admin'/'student' 角色、management/analytics 分组、插件合并函数）。
 * 侧边栏改为从 registry 渲染后，registry 成了 SSOT —— 组标题、顺序、图标、
 * 文案、角色可见性全在这里定，用例必须盯住这些。
 */
import { describe, it, expect } from 'vitest';
import {
  BUILTIN_NAV_ITEMS,
  NAVIGATION_GROUPS,
  resolveBuiltinNavigationItems,
  resolveGroupLabel,
} from '../navigation-registry';

describe('Navigation Registry（教师工作区侧边栏 SSOT）', () => {
  it('四个分组的标题与顺序固定', () => {
    expect(NAVIGATION_GROUPS.teaching.label.zh).toBe('教学工具');
    expect(NAVIGATION_GROUPS.system.label.zh).toBe('系统管理');
    expect(NAVIGATION_GROUPS.extensions.label.zh).toBe('扩展应用');
    expect(NAVIGATION_GROUPS.support.label.zh).toBe('帮助支持');

    // 组顺序由 position 决定：教学工具 → 系统管理 → 扩展应用 → 帮助支持
    const positions = [
      NAVIGATION_GROUPS.teaching.position,
      NAVIGATION_GROUPS.system.position,
      NAVIGATION_GROUPS.extensions.position,
      NAVIGATION_GROUPS.support.position,
    ];
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('内置入口覆盖教师工作区的全部 9 个 tab', () => {
    const tabs = BUILTIN_NAV_ITEMS.map((i) => i.tab);
    expect(tabs).toEqual([
      'courses',
      'live_class',
      'classes',
      'assessments',
      'timetable',
      'computer_labs',
      'plugins',
      'admin_directory',
      'help',
    ]);
  });

  it('每个内置入口的 tab 与 id 一一对应且不重复', () => {
    const ids = BUILTIN_NAV_ITEMS.map((i) => i.id);
    const tabs = BUILTIN_NAV_ITEMS.map((i) => i.tab);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(tabs).size).toBe(tabs.length);
    for (const item of BUILTIN_NAV_ITEMS) {
      expect(item.id).toBe(item.tab);
    }
  });

  it('教师看不到管理后台，管理员能看到', () => {
    const teacher = resolveBuiltinNavigationItems('teacher', 'zh');
    const admin = resolveBuiltinNavigationItems('administrator', 'zh');

    expect(teacher.some((i) => i.tab === 'admin_directory')).toBe(false);
    expect(admin.some((i) => i.tab === 'admin_directory')).toBe(true);
  });

  it('解析结果按「组顺序 → 组内 position」排序', () => {
    const items = resolveBuiltinNavigationItems('administrator', 'zh');
    const groupOrder = ['teaching', 'system', 'extensions', 'support'];
    const seen = items.map((i) => groupOrder.indexOf(i.group));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);

    // 组内 position 递增
    for (const group of groupOrder) {
      const positions = items.filter((i) => i.group === group).map((i) => i.position);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it('文案按语言解析，且双语原文可同时取用', () => {
    const zh = resolveBuiltinNavigationItems('teacher', 'zh');
    const en = resolveBuiltinNavigationItems('teacher', 'en');

    const coursesZh = zh.find((i) => i.tab === 'courses');
    const coursesEn = en.find((i) => i.tab === 'courses');
    expect(coursesZh?.label).toBe('课程管理');
    expect(coursesEn?.label).toBe('Courses');
    // 双语原文不受当前语言影响
    expect(coursesZh?.labelEn).toBe('Courses');
    expect(coursesEn?.labelZh).toBe('课程管理');
  });

  it('分组标题可按语言解析', () => {
    expect(resolveGroupLabel('teaching', 'zh')).toBe('教学工具');
    expect(resolveGroupLabel('teaching', 'en')).toBe('TEACHING');
    expect(resolveGroupLabel('support', 'zh')).toBe('帮助支持');
  });

  it('互动课堂带 highlight 标记（主入口常驻强调）', () => {
    const items = resolveBuiltinNavigationItems('teacher', 'zh');
    expect(items.find((i) => i.tab === 'live_class')?.highlight).toBe(true);
    expect(items.find((i) => i.tab === 'courses')?.highlight).toBe(false);
  });
});
