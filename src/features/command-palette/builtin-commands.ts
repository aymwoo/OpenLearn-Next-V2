/**
 * OpenLearn — 内置命令清单（命令面板的「跳转 / 开关」来源）
 *
 * ## 设计要点
 *
 * 1. **跳转类命令从 navigation registry 生成** —— 侧边栏与命令面板共享同一份
 *    入口清单（`resolveBuiltinNavigationItems`），新增一个工作区入口只需改一处，
 *    两处同时出现，不会漂移。
 * 2. **命令是纯副作用**：`execute` 只负责改状态 / 调 API，不碰 UI 布局 ——
 *    命令面板关闭后状态照样生效。
 * 3. 插件贡献的命令走另一条路径（`command_palette.item` 扩展槽），
 *    由 `CommandPalette` 组件自己合并，这里不重复实现。
 */
import type { CommandDescriptor, CommandRegistryFacade } from './command-types.js';
import { resolveBuiltinNavigationItems } from '../navigation/navigation-registry.js';

export interface BuiltinCommandContext {
  /** 教师工作区的 hash 路由跳转 */
  setTeacherTab: (tab: string) => void;
  /** 当前角色（决定哪些入口可见） */
  role: 'teacher' | 'administrator';
  lang: 'zh' | 'en';
  /** 折叠 / 展开左侧导航 */
  toggleSidebar: () => void;
  /** 切换界面语言 */
  toggleLanguage: () => void;
  /** 切换主题 */
  setTheme: (themeId: string) => void;
  /** 打开通知中心 */
  openNotifications: () => void;
  /** 打开系统资源库 */
  openSystemResourceLibrary: () => void;
  /** 打开个人资料 */
  openProfile: () => void;
}

const isZh = (lang: 'zh' | 'en') => lang === 'zh';

/** 命令 id 前缀：便于与插件贡献的命令（插件自定义 id）区分。 */
export const BUILTIN_COMMAND_PREFIX = 'builtin.';

/**
 * 生成内置命令清单。
 *
 * 每次调用返回**新数组**：语言/角色变化时命令文案与可见性都要跟着变，
 * 不能复用上一次的描述。
 */
export function buildBuiltinCommands(ctx: BuiltinCommandContext): CommandDescriptor[] {
  const zh = isZh(ctx.lang);
  const commands: CommandDescriptor[] = [];

  // ── 1. 跳转工作区（来自 navigation registry，与侧边栏同源）──────────────
  for (const item of resolveBuiltinNavigationItems(ctx.role, ctx.lang)) {
    commands.push({
      id: `${BUILTIN_COMMAND_PREFIX}goto.${item.id}`,
      title: zh ? `前往${item.labelZh}` : `Go to ${item.labelEn}`,
      description: zh ? '切换到左侧导航中的对应工作区' : 'Switch to the matching workspace',
      category: 'Workspace',
      keywords: zh ? [item.labelZh, '跳转', '导航'] : [item.labelEn, 'go', 'navigate'],
      execute: () => ctx.setTeacherTab(item.tab),
    });
  }

  // ── 2. 界面开关 ─────────────────────────────────────────────────────────
  commands.push({
    id: `${BUILTIN_COMMAND_PREFIX}ui.toggleSidebar`,
    title: zh ? '折叠 / 展开左侧导航' : 'Collapse / expand sidebar',
    description: zh ? '切换左侧导航栏的宽度' : 'Toggle the left navigation width',
    category: 'Workspace',
    keywords: zh ? ['侧边栏', '折叠', '展开'] : ['sidebar', 'collapse', 'expand'],
    execute: () => ctx.toggleSidebar(),
  });

  commands.push({
    id: `${BUILTIN_COMMAND_PREFIX}ui.toggleLanguage`,
    title: zh ? '切换界面语言（中 / 英）' : 'Toggle interface language (ZH / EN)',
    category: 'Workspace',
    keywords: zh ? ['语言', '中英文'] : ['language', 'locale', 'i18n'],
    execute: () => ctx.toggleLanguage(),
  });

  commands.push({
    id: `${BUILTIN_COMMAND_PREFIX}ui.openNotifications`,
    title: zh ? '打开通知中心' : 'Open notifications',
    category: 'Workspace',
    keywords: zh ? ['通知', '消息'] : ['notification', 'inbox'],
    execute: () => ctx.openNotifications(),
  });

  commands.push({
    id: `${BUILTIN_COMMAND_PREFIX}ui.openSystemResourceLibrary`,
    title: zh ? '打开系统资源库' : 'Open system resource library',
    category: 'Resource',
    keywords: zh ? ['资源库', '素材'] : ['resource', 'library', 'material'],
    execute: () => ctx.openSystemResourceLibrary(),
  });

  commands.push({
    id: `${BUILTIN_COMMAND_PREFIX}ui.openProfile`,
    title: zh ? '打开个人资料' : 'Open profile',
    category: 'Workspace',
    keywords: zh ? ['个人', '资料', '头像'] : ['profile', 'account', 'avatar'],
    execute: () => ctx.openProfile(),
  });

  // ── 3. 主题切换 ─────────────────────────────────────────────────────────
  const themes: Array<{ id: string; zh: string; en: string }> = [
    { id: 'light', zh: '浅色', en: 'Light' },
    { id: 'dark', zh: '深色', en: 'Dark' },
    { id: 'eyecare', zh: '护眼', en: 'Eyecare' },
    { id: 'chalkboard', zh: '黑板', en: 'Chalkboard' },
  ];
  for (const theme of themes) {
    commands.push({
      id: `${BUILTIN_COMMAND_PREFIX}theme.${theme.id}`,
      title: zh ? `切换主题：${theme.zh}` : `Switch theme: ${theme.en}`,
      category: 'Workspace',
      keywords: zh ? ['主题', '配色', theme.zh] : ['theme', 'appearance', theme.en],
      execute: () => ctx.setTheme(theme.id),
    });
  }

  return commands;
}

/**
 * 把内置命令登记到注册表。
 *
 * 重复调用是幂等的：`CommandRegistry.register` 按 id 覆盖同名命令，
 * 因此语言/角色变化时直接重跑即可刷新文案与可见性。
 */
export function registerBuiltinCommands(registry: CommandRegistryFacade, ctx: BuiltinCommandContext): void {
  for (const command of buildBuiltinCommands(ctx)) {
    registry.register(command);
  }
}
