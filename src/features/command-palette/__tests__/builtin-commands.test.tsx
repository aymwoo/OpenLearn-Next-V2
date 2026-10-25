/**
 * 内置命令清单 + 命令面板宿主
 *
 * 守两件事：
 * 1. 内置命令的**内容** —— 跳转命令必须与侧边栏同源（来自 navigation registry），
 *    语言/角色变化时文案与可见性跟着变；
 * 2. 宿主的**开合行为** —— Cmd/Ctrl + K 开合、Escape 关闭、执行命令后关闭。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { buildBuiltinCommands, registerBuiltinCommands, BUILTIN_COMMAND_PREFIX } from '../builtin-commands';
import { CommandPaletteHost } from '../CommandPaletteHost';
import { globalCommandRegistry } from '../command-palette';
import { CommandRegistry } from '../command-registry';
import type { BuiltinCommandContext } from '../builtin-commands';

function makeCtx(overrides: Partial<BuiltinCommandContext> = {}): BuiltinCommandContext {
  return {
    setTeacherTab: vi.fn(),
    role: 'teacher',
    lang: 'zh',
    toggleSidebar: vi.fn(),
    toggleLanguage: vi.fn(),
    setTheme: vi.fn(),
    openNotifications: vi.fn(),
    openSystemResourceLibrary: vi.fn(),
    openProfile: vi.fn(),
    ...overrides,
  };
}

describe('内置命令清单', () => {
  it('跳转命令与侧边栏入口同源（一条不多、一条不少）', () => {
    const ctx = makeCtx();
    const goto = buildBuiltinCommands(ctx).filter((c) => c.id.startsWith(`${BUILTIN_COMMAND_PREFIX}goto.`));
    // 9 个内置入口 - 1 个仅管理员可见 = 8 个跳转命令
    expect(goto.map((c) => c.id)).toEqual([
      'builtin.goto.courses',
      'builtin.goto.live_class',
      'builtin.goto.classes',
      'builtin.goto.assessments',
      'builtin.goto.timetable',
      'builtin.goto.computer_labs',
      'builtin.goto.plugins',
      'builtin.goto.help',
    ]);
  });

  it('管理员额外看得到「管理后台」跳转命令', () => {
    const goto = buildBuiltinCommands(makeCtx({ role: 'administrator' })).filter((c) =>
      c.id.startsWith(`${BUILTIN_COMMAND_PREFIX}goto.`),
    );
    expect(goto.some((c) => c.id === 'builtin.goto.admin_directory')).toBe(true);
  });

  it('执行跳转命令会切到对应 tab', () => {
    const ctx = makeCtx();
    const cmd = buildBuiltinCommands(ctx).find((c) => c.id === 'builtin.goto.live_class');
    cmd?.execute();
    expect(ctx.setTeacherTab).toHaveBeenCalledWith('live_class');
  });

  it('语言决定命令标题与关键词', () => {
    const zh = buildBuiltinCommands(makeCtx({ lang: 'zh' })).find((c) => c.id === 'builtin.goto.courses');
    const en = buildBuiltinCommands(makeCtx({ lang: 'en' })).find((c) => c.id === 'builtin.goto.courses');
    expect(zh?.title).toBe('前往课程管理');
    expect(en?.title).toBe('Go to Courses');
    expect(en?.keywords).toContain('Courses');
  });

  it('主题切换命令覆盖全部内置主题', () => {
    const ctx = makeCtx();
    const cmds = buildBuiltinCommands(ctx).filter((c) => c.id.startsWith(`${BUILTIN_COMMAND_PREFIX}theme.`));
    expect(cmds.map((c) => c.id.replace(`${BUILTIN_COMMAND_PREFIX}theme.`, '')).sort()).toEqual([
      'chalkboard',
      'dark',
      'eyecare',
      'light',
    ]);
    cmds.find((c) => c.id === 'builtin.theme.dark')?.execute();
    expect(ctx.setTheme).toHaveBeenCalledWith('dark');
  });

  it('登记是幂等的：重复 register 不会累积重复命令', () => {
    const registry = new CommandRegistry();
    const ctx = makeCtx();
    registerBuiltinCommands(registry, ctx);
    const first = registry.listAll().length;
    registerBuiltinCommands(registry, ctx);
    expect(registry.listAll().length).toBe(first);
  });
});

describe('CommandPaletteHost', () => {
  beforeEach(() => {
    globalCommandRegistry.clear();
    // 宿主从 appStore / appData 取状态；这里只需要「面板能开合」，
    // 因此把不依赖外部 store 的部分单独验证。
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Cmd/Ctrl + K 唤起命令面板', async () => {
    render(<CommandPaletteHost />);
    expect(screen.queryByTestId('command-palette-modal')).toBeNull();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await waitFor(() => expect(screen.getByTestId('command-palette-modal')).toBeTruthy());
  });

  it('Escape 关闭命令面板', async () => {
    render(<CommandPaletteHost />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('command-palette-modal')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('command-palette-modal')).toBeNull());
  });

  it('普通按键不会误触发', async () => {
    render(<CommandPaletteHost />);
    fireEvent.keyDown(window, { key: 'k' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('command-palette-modal')).toBeNull();
  });
});
