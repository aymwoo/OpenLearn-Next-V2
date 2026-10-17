import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandBusPlayground } from '../CommandBusPlayground';
import { SdkGuideViewer } from '../SdkGuideViewer';
import { UserGuideViewer } from '../UserGuideViewer';
import { PluginDocsViewer } from '../PluginDocsViewer';

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="extension-point">Mock Extension Point</div>,
}));

// 同一文件里多次 render（含同 testid 的卡片），必须逐例清理 DOM，否则查询会命中多份
afterEach(() => {
  cleanup();
});

describe('HelpView Sub-components', () => {
  describe('CommandBusPlayground', () => {
    it('should render command playground search and command list', () => {
      render(
        <CommandBusPlayground
          registeredCommands={[
            {
              id: 'cmd-1',
              commandType: 'lesson.create',
              description: '创建新课时',
              capabilityRequired: 'lesson:write',
              isHighRisk: false,
              inputSchema: { type: 'OBJECT', properties: { title: { type: 'STRING' } } },
            },
          ]}
          onRefresh={vi.fn()}
        />,
      );

      expect(screen.getByPlaceholderText('通过命令类型、描述或 Action ID 搜索活跃指令...')).toBeDefined();
      expect(screen.getByText('lesson.create')).toBeDefined();
      expect(screen.getByText('创建新课时')).toBeDefined();
    });
  });

  describe('CommandBusPlayground · Issue #117 响应式多列网格', () => {
    const commands = [
      {
        id: 'cmd-1',
        commandType: 'lesson.create',
        description: '创建新课时',
        capabilityRequired: 'lesson:write',
        isHighRisk: false,
        inputSchema: { type: 'OBJECT', properties: { title: { type: 'STRING' } } },
      },
      {
        id: 'cmd-2',
        commandType: 'vfs.write_file_with_a_very_long_command_type_name_that_should_not_break_the_grid_layout',
        description: '一段很长的描述，用来确认卡片不会因为文案过长而撑破网格布局，也不会把同一行的其它卡片挤成一条线。',
        capabilityRequired: 'vfs:write',
        isHighRisk: true,
        inputSchema: { type: 'OBJECT', properties: {} },
      },
      {
        id: 'cmd-3',
        commandType: 'class.list',
        description: '列出班级',
        capabilityRequired: 'class:read',
        isHighRisk: false,
        inputSchema: { type: 'OBJECT', properties: {} },
      },
    ];

    it('列表容器使用响应式多列网格（窄屏 1 列 → md 2 列 → xl 3 列），并放宽 max-w-5xl 窄栏', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      const grid = screen.getByTestId('command-grid');
      expect(grid.className).toContain('grid');
      expect(grid.className).toContain('grid-cols-1');
      expect(grid.className).toContain('md:grid-cols-2');
      expect(grid.className).toContain('xl:grid-cols-3');
      // 原来的 space-y-4 单列堆叠与 max-w-5xl 窄栏都应消失
      expect(grid.className).not.toContain('space-y-4');
      expect(grid.className).not.toContain('max-w-5xl');
    });

    it('卡片是真正的按钮：可聚焦、aria-expanded 随展开切换、面板由 aria-controls 关联', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      // 可访问名由卡片内容自然生成（含 commandType / 权限 / 描述 / ID / 交互调试 Shell），
      // 自定义 aria-label 会触发 axe 的 label-content-name-mismatch（#117 已修）
      const cardButton = screen.getByRole('button', { name: /lesson\.create/ });
      expect(cardButton.tagName).toBe('BUTTON');
      expect(cardButton.getAttribute('aria-expanded')).toBe('false');
      expect(cardButton.getAttribute('aria-controls')).toBe('command-panel-cmd-1');

      // 键盘可达：聚焦后 Enter 展开
      cardButton.focus();
      expect(document.activeElement).toBe(cardButton);
      fireEvent.click(cardButton);

      const expandedButton = screen.getByRole('button', { name: /lesson\.create/ });
      expect(expandedButton.getAttribute('aria-expanded')).toBe('true');
      const panel = document.getElementById('command-panel-cmd-1');
      expect(panel).toBeTruthy();
      expect(panel!.textContent).toContain('Payload 调试区');
    });

    it('展开的卡片占满整行（col-span-full），折叠时不占', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      expect(screen.getByTestId('command-card-cmd-1').getAttribute('data-expanded')).toBe('false');
      expect(screen.getByTestId('command-card-cmd-1').className).not.toContain('col-span-full');

      fireEvent.click(screen.getByRole('button', { name: /lesson\.create/ }));

      const card = screen.getByTestId('command-card-cmd-1');
      expect(card.getAttribute('data-expanded')).toBe('true');
      expect(card.className).toContain('col-span-full');
    });

    it('长 commandType 与长描述不撑破布局（换行 + 截断类名）', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      const longType = screen.getByText(commands[1].commandType);
      expect(longType.className).toContain('break-all');
      const longDesc = screen.getByText(/一段很长的描述/);
      expect(longDesc.className).toContain('line-clamp-2');
      // ID 行用 truncate 而不是无限撑宽
      expect(screen.getByTitle('ID: cmd-2').className).toContain('truncate');
    });

    it('搜索过滤后网格仍然存在并只保留命中的卡片', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText('通过命令类型、描述或 Action ID 搜索活跃指令...'), {
        target: { value: 'class.list' },
      });

      expect(screen.getByTestId('command-grid')).toBeTruthy();
      expect(screen.getByTestId('command-card-cmd-3')).toBeTruthy();
      expect(screen.queryByTestId('command-card-cmd-1')).toBeNull();
    });

    it('渲染期不再写入 payload state：展开面板时 textarea 回落到默认模板而非空值', () => {
      render(<CommandBusPlayground registeredCommands={commands} onRefresh={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /lesson\.create/ }));
      const textarea = screen.getByDisplayValue(/"title"/) as HTMLTextAreaElement;
      expect(textarea.value).toContain('title');

      // 用户编辑后不被默认模板覆盖
      fireEvent.change(textarea, { target: { value: '{"title":"自定义"}' } });
      expect((screen.getByDisplayValue('{"title":"自定义"}') as HTMLTextAreaElement).value).toBe('{"title":"自定义"}');

      // 「恢复默认模版」写回默认值
      fireEvent.click(screen.getByText('恢复默认模版'));
      expect((screen.getByDisplayValue(/"title"/) as HTMLTextAreaElement).value).toContain('title');
    });
  });

  describe('SdkGuideViewer', () => {
    it('should render sdk guide banner and code example headers', () => {
      render(
        <SdkGuideViewer
          pluginGuideMd=""
          loadingMd={false}
          copiedId={null}
          handleCopy={vi.fn()}
          pluginBoilerplateCode="const hello = true;"
          pluginInteractiveCode="const interactive = true;"
          pluginExamCode="const exam = true;"
        />,
      );

      expect(screen.getByText('Openlearn Next 插件开发指南 & API 参考')).toBeDefined();
      expect(screen.getByText('示例 1：思维导图插件 — 注册 Action + 处理器 + 发布事件')).toBeDefined();
    });
  });

  describe('UserGuideViewer', () => {
    it('should render system user guide sections', () => {
      render(<UserGuideViewer copiedId={null} handleCopy={vi.fn()} />);

      expect(screen.getByText('Openlearn Next 核心系统主要特性使用教程')).toBeDefined();
      expect(screen.getByText('1. 使用核心指令管理班级与学生')).toBeDefined();
    });
  });

  describe('PluginDocsViewer', () => {
    it('should render plugin docs container and extension point', () => {
      render(<PluginDocsViewer />);

      expect(screen.getByText('已安装插件的使用文档')).toBeDefined();
      expect(screen.getByTestId('extension-point')).toBeDefined();
    });
  });
});
