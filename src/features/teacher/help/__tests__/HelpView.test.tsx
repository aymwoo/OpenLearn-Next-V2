import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CommandBusPlayground } from '../CommandBusPlayground';
import { SdkGuideViewer } from '../SdkGuideViewer';
import { UserGuideViewer } from '../UserGuideViewer';
import { PluginDocsViewer } from '../PluginDocsViewer';

vi.mock('../../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: () => <div data-testid="extension-point">Mock Extension Point</div>
}));

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
              inputSchema: { type: 'OBJECT', properties: { title: { type: 'STRING' } } }
            }
          ]}
          onRefresh={vi.fn()}
        />
      );

      expect(screen.getByPlaceholderText('通过命令类型、描述或 Action ID 搜索活跃指令...')).toBeDefined();
      expect(screen.getByText('lesson.create')).toBeDefined();
      expect(screen.getByText('创建新课时')).toBeDefined();
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
        />
      );

      expect(screen.getByText('Edu-OS 插件开发指南 & API 参考')).toBeDefined();
      expect(screen.getByText('示例 1：思维导图插件 — 注册 Action + 处理器 + 发布事件')).toBeDefined();
    });
  });

  describe('UserGuideViewer', () => {
    it('should render system user guide sections', () => {
      render(
        <UserGuideViewer
          copiedId={null}
          handleCopy={vi.fn()}
        />
      );

      expect(screen.getByText('Edu-OS 核心系统主要特性使用教程')).toBeDefined();
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
