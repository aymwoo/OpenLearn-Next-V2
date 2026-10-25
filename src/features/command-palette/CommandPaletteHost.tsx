/**
 * OpenLearn — 命令面板宿主
 *
 * 负责三件事：
 * 1. 监听 `Cmd/Ctrl + K` 开合命令面板；
 * 2. 随语言 / 角色变化刷新内置命令；
 * 3. 把面板挂到全局（放在 App 根部，任何工作区都能唤起）。
 *
 * 为什么单独做一个宿主组件：命令面板是一个**全局**表面，它需要拿到
 * 「当前教师工作区状态」（角色、语言、主题、各类开关）。把这些塞进
 * `CommandPalette` 组件内部会让它依赖 AppDataContext —— 而插件贡献的命令
 * 面板用法（`command_palette.item` 扩展槽）并不需要这些上下文。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CommandPalette, globalCommandRegistry } from './command-palette.js';
import { registerBuiltinCommands } from './builtin-commands.js';
import { useAppStore } from '../../store/appStore.js';
import { useThemeStore } from '../../store/themeStore.js';
import { useOptionalAppData } from '../../context/AppDataContext.js';

export function CommandPaletteHost(): React.ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);

  const appData = useOptionalAppData();
  const lang = useAppStore((s) => s.lang);
  const setTeacherTab = useAppStore((s) => s.setTeacherTab);
  const setTheme = useThemeStore((s) => s.setTheme);

  const role: 'teacher' | 'administrator' = appData?.session?.subRole === 'administrator' ? 'administrator' : 'teacher';

  // 语言 / 角色 / 主题变化时刷新内置命令的文案与可见性。
  useEffect(() => {
    registerBuiltinCommands(globalCommandRegistry, {
      setTeacherTab,
      role,
      lang,
      toggleSidebar: () => {
        const current = appData?.mainNavCollapsed;
        if (current === undefined) return;
        appData?.setMainNavCollapsed?.(!current);
      },
      toggleLanguage: () => appData?.toggleLanguage?.(),
      setTheme,
      openNotifications: () => appData?.setIsNotificationsOpen?.(true),
      openSystemResourceLibrary: () => appData?.setIsSystemResourceLibraryOpen?.(true),
      openProfile: () => appData?.setProfileOpen?.(true),
    });
  }, [appData, lang, role, setTeacherTab, setTheme]);

  const close = useCallback(() => setIsOpen(false), []);

  // Cmd/Ctrl + K 开合。输入框聚焦时同样允许唤起（命令面板自己接管焦点）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setIsOpen((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 面板打开时把焦点交给它（组件内部 autoFocus），关闭时焦点归还浏览器。
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;
  return <CommandPalette isOpen={isOpen} onClose={close} registry={globalCommandRegistry} />;
}

/** 面板是否可用（当前是否有可执行的内置命令）—— 供测试与调试读取。 */
export function isCommandPaletteMounted(): boolean {
  return globalCommandRegistry.listAll().length > 0;
}

/** 当前主题 id 的可读标签（调试用）。 */
export function currentThemeId(): string {
  return useThemeStore.getState().theme;
}
