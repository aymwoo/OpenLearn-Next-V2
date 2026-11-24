/**
 * 测评扩展槽渲染增强（P0）：
 * - 只有 commandType 的数据型 manifest 贡献渲染为按钮（此前静默空白）；
 * - 调用点显式传入的 lessonId 覆盖全局选中课节；
 * - resolveExtensionProps 的结果合并进扩展 props（敏感字段投影通道）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../extension-point-renderer';
import { PluginHostProvider } from '../plugin-host-context';
import { FrontendPluginHost, NullExtensionComponent } from '../plugin-host';
import { usePluginHostStore } from '../plugin-host-store';

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map() });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — assessment slots (P0)', () => {
  it('commandType-only 贡献渲染为按钮（不再静默 return null）', () => {
    usePluginHostStore.getState().registerExtensionPoint('assessment.bank.toolbar.action', {
      id: 'import-btn',
      label: '批量导入',
      pluginId: 'ext-bank',
      component: NullExtensionComponent,
      slotProps: { commandType: 'ext-bank:import' },
    });

    renderWithHost(<ExtensionPointRenderer slot="assessment.bank.toolbar.action" slotProps={{ lang: 'zh' }} />);
    expect(screen.getByRole('button', { name: '批量导入' })).toBeTruthy();
  });

  it('调用点 lessonId 覆盖全局 selectedLesson（含 null）', () => {
    usePluginHostStore.getState().registerExtensionPoint('assessment.list.card', {
      id: 'probe',
      label: 'Probe',
      pluginId: 'ext-probe',
      component: ({ lessonId }: { lessonId?: string | null }) => (
        <span data-testid="probe-lesson">{String(lessonId)}</span>
      ),
    });

    renderWithHost(
      <ExtensionPointRenderer slot="assessment.list.card" slotProps={{ lessonId: 'lesson-9', lang: 'zh' }} />,
    );
    expect(screen.getByTestId('probe-lesson').textContent).toBe('lesson-9');
  });

  it('resolveExtensionProps 合并敏感字段投影结果', () => {
    usePluginHostStore.getState().registerExtensionPoint('assessment.grading.answer.addon', {
      id: 'sensitive-probe',
      label: 'Sensitive',
      pluginId: 'ext-probe',
      component: ({
        sensitiveAccess,
        sensitive,
      }: {
        sensitiveAccess?: boolean;
        sensitive?: Record<string, unknown>;
      }) => (
        <span data-testid="sensitive-probe">
          {String(sensitiveAccess)}:{String(sensitive?.answerKey ?? '')}
        </span>
      ),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="assessment.grading.answer.addon"
        slotProps={{ attemptId: 'att-1', lang: 'zh' }}
        resolveExtensionProps={() => ({ sensitiveAccess: true, sensitive: { answerKey: 'K-1' } })}
      />,
    );
    expect(screen.getByTestId('sensitive-probe').textContent).toBe('true:K-1');
  });
});
