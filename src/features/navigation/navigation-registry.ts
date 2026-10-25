/**
 * OpenLearn V2 — Navigation Registry（教师工作区侧边栏的**唯一数据源**）
 *
 * ## 为什么要有这一层
 *
 * 侧边栏曾经把 9 个入口硬编码在 `NavigationSidebar.tsx` 里：组标题、顺序、图标、
 * 文案、角色可见性全散在 JSX 中。新增/调整一个入口要改组件、而插件贡献的 tab
 * 走的是另一条渲染路径（`ExtensionPointRenderer` + slot `teacher.tab`）——两套机制
 * 各自为政。
 *
 * 本模块把「内置入口」抽成数据：组件只负责按数据渲染，插件贡献仍走
 * `ExtensionPointRenderer`（那条路径要渲染的是插件自带的 React 组件，与内置按钮
 * 不是一回事，不应该硬塞进同一份数据）。
 *
 * ## 口径
 *
 * - `tab` 是教师工作区的 hash 路由值（`#/courses` 等），与 `appStore.setTeacherTab`
 *   的入参一致。
 * - `administratorOnly` 对应会话里的 `subRole === 'administrator'`。
 * - 侧边栏只出现在教师工作区（`TeacherView`），学生端不渲染它，因此这里不按
 *   teacher/student 过滤。
 */
import React from 'react';
import {
  BookOpen,
  Presentation,
  Users,
  ClipboardList,
  Calendar as CalendarIcon,
  LayoutTemplate,
  Puzzle,
  Shield,
  HelpCircle,
} from 'lucide-react';

export type NavigationGroupKey = 'teaching' | 'system' | 'extensions' | 'support';

export interface NavigationGroupMetadata {
  key: NavigationGroupKey;
  label: { zh: string; en: string };
  position: number;
}

export const NAVIGATION_GROUPS: Record<NavigationGroupKey, NavigationGroupMetadata> = {
  teaching: {
    key: 'teaching',
    label: { zh: '教学工具', en: 'TEACHING' },
    position: 10,
  },
  system: {
    key: 'system',
    label: { zh: '系统管理', en: 'SYSTEM MANAGEMENT' },
    position: 20,
  },
  extensions: {
    key: 'extensions',
    label: { zh: '扩展应用', en: 'EXTENSIONS' },
    position: 30,
  },
  support: {
    key: 'support',
    label: { zh: '帮助支持', en: 'HELP & SUPPORT' },
    position: 40,
  },
};

export interface BuiltinNavItem {
  /** 稳定标识（插件贡献的 id 不能与之冲突） */
  id: string;
  /** 教师工作区的 hash 路由值 */
  tab: string;
  label: { zh: string; en: string };
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: NavigationGroupKey;
  position: number;
  /** 仅管理员可见（会话 subRole === 'administrator'） */
  administratorOnly?: boolean;
  /** 图标常驻主题色（未选中时也强调），用于「互动课堂」这类主入口 */
  highlight?: boolean;
}

/**
 * 内置导航入口清单。
 *
 * 顺序即 `position` 升序；组内顺序 + 组间顺序都由 position 决定，
 * 组件不再自行决定「先渲染哪一组」。
 */
export const BUILTIN_NAV_ITEMS: BuiltinNavItem[] = [
  {
    id: 'courses',
    tab: 'courses',
    label: { zh: '课程管理', en: 'Courses' },
    icon: BookOpen,
    group: 'teaching',
    position: 10,
  },
  {
    id: 'live_class',
    tab: 'live_class',
    label: { zh: '互动课堂', en: 'Live Class' },
    icon: Presentation,
    group: 'teaching',
    position: 20,
    highlight: true,
  },
  {
    id: 'classes',
    tab: 'classes',
    label: { zh: '班级管理', en: 'Classes & Students' },
    icon: Users,
    group: 'teaching',
    position: 30,
  },
  {
    id: 'assessments',
    tab: 'assessments',
    label: { zh: '测评中心', en: 'Assessment Center' },
    icon: ClipboardList,
    group: 'teaching',
    position: 40,
  },
  {
    id: 'timetable',
    tab: 'timetable',
    label: { zh: '课表管理', en: 'Timetable Routine' },
    icon: CalendarIcon,
    group: 'system',
    position: 10,
  },
  {
    id: 'computer_labs',
    tab: 'computer_labs',
    label: { zh: '机房管理', en: 'Computer Lab Seating' },
    icon: LayoutTemplate,
    group: 'system',
    position: 20,
  },
  {
    id: 'plugins',
    tab: 'plugins',
    label: { zh: '插件中心', en: 'App Store / Plugins' },
    icon: Puzzle,
    group: 'system',
    position: 30,
  },
  {
    id: 'admin_directory',
    tab: 'admin_directory',
    label: { zh: '管理后台', en: '⭐ Admin Center' },
    icon: Shield,
    group: 'system',
    position: 40,
    administratorOnly: true,
  },
  {
    id: 'help',
    tab: 'help',
    label: { zh: '帮助文档', en: 'System Commands / Help' },
    icon: HelpCircle,
    group: 'support',
    position: 10,
  },
];

export interface ResolvedNavItem {
  id: string;
  tab: string;
  /** 已按语言解析好的展示文案 */
  label: string;
  /** 双语文案（命令面板等需要同时产出两种语言的场合使用） */
  labelZh: string;
  labelEn: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  group: NavigationGroupKey;
  position: number;
  administratorOnly: boolean;
  highlight: boolean;
}

/**
 * 按角色与语言解析内置导航入口。
 *
 * @param role 教师工作区内的角色：'teacher' | 'administrator'
 * @param lang 界面语言
 */
export function resolveBuiltinNavigationItems(role: 'teacher' | 'administrator', lang: 'zh' | 'en'): ResolvedNavItem[] {
  return BUILTIN_NAV_ITEMS.filter((item) => !item.administratorOnly || role === 'administrator')
    .map((item) => ({
      id: item.id,
      tab: item.tab,
      label: item.label[lang] ?? item.label.zh,
      labelZh: item.label.zh,
      labelEn: item.label.en,
      icon: item.icon,
      group: item.group,
      position: item.position,
      administratorOnly: item.administratorOnly ?? false,
      highlight: item.highlight ?? false,
    }))
    .sort((a, b) => {
      const ga = NAVIGATION_GROUPS[a.group].position;
      const gb = NAVIGATION_GROUPS[b.group].position;
      if (ga !== gb) return ga - gb;
      return a.position - b.position;
    });
}

/** 分组标题文案（按语言解析）。 */
export function resolveGroupLabel(group: NavigationGroupKey, lang: 'zh' | 'en'): string {
  return NAVIGATION_GROUPS[group].label[lang] ?? NAVIGATION_GROUPS[group].label.zh;
}
