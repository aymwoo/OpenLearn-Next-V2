import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { registerSmartEduExtensions, SMART_EDU_PLUGIN_ID } from '../smart-edu-plugin';

/**
 * 端到端集成测试 —— 注册路径与渲染路径必须在这条测试里会合。
 *
 * v0.6.0 审计的教训：四条 Critical（未打标 lazy 工厂 / prop 错位 / 能力未授予 /
 * 假数据）全部被"组件直测 + store 直塞"的测试模式漏过。本测试走真实
 * registerSmartEduExtensions() → 真实 ExtensionPointRenderer 解析与渲染，
 * 任何把 component 注册回未打标 lazy 工厂、或让插件组件抛错的回归都会在这里变红。
 */

const CERTIFIED_COURSE = {
  id: 'lesson-e2e-1',
  title: '算法与程序设计',
  content: JSON.stringify({
    smartEduMetadata: { certified: true, code: 'SED-2026-IT-0089', awardLevel: 'national_gold' },
  }),
};

const CONFIGURED_STATUS = {
  success: true,
  configured: true,
  connected: true,
  endpoint: 'https://gateway.test/smart-edu',
  rttMs: 12,
  syncedCoursesCount: 1,
  lastHeartbeat: new Date().toISOString(),
};

function mockStatusFetch(status: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => status,
  }) as any);
}

describe('SmartEdu 槽位端到端（真实注册 → 真实 ExtensionPointRenderer 渲染）', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    host = new FrontendPluginHost();
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });
    // v0.6.1 用户决策：默认停用 —— 端到端测试显式启用后再注册
    usePluginHostStore.getState().setBuiltinBundleEnabled(SMART_EDU_PLUGIN_ID, true);
    registerSmartEduExtensions();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('course.card.badge：经真实渲染器渲染认证徽标（拦截未打标 lazy 工厂回归）', async () => {
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="course.card.badge" slotProps={{ course: CERTIFIED_COURSE }} />
      </PluginHostProvider>,
    );

    // 若组件被注册为未打标 lazy 工厂，React 会永久悬挂 Suspense，此断言超时失败
    const badge = await screen.findByText('国家精品课', undefined, { timeout: 3000 });
    expect(badge).toBeTruthy();
  });

  it('editor.segment.action：经真实渲染器渲染并携带宿主补丁回调', async () => {
    const onPatch = vi.fn();
    const segment = { id: 'seg-e2e', title: '探究环节', description: '' };

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="editor.segment.action"
          slotProps={{ segmentId: segment.id, segment, lang: 'zh', readOnly: false, onPatch }}
        />
      </PluginHostProvider>,
    );

    const btn = await screen.findByText('国家微课', undefined, { timeout: 3000 });
    btn.click();
    await waitFor(() => {
      expect(onPatch).toHaveBeenCalled();
    });
  });

  it('header.status_pill：经真实渲染器渲染三态胶囊（网关在线态）', async () => {
    mockStatusFetch(CONFIGURED_STATUS);

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="header.status_pill" slotProps={{ lang: 'zh' }} />
      </PluginHostProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText('已连通')).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it('classroom.alert.banner：网关未配置时经真实渲染器也不得渲染任何横幅', async () => {
    mockStatusFetch({ success: true, configured: false, connected: false });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="classroom.alert.banner" slotProps={{ lessonId: 'l-1' }} />
      </PluginHostProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryByText(/双师课堂数据通道已连通/)).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  it('classroom.stage.display.ticker：经真实渲染器渲染且不虚构连通状态', async () => {
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="classroom.stage.display.ticker"
          slotProps={{ lessonId: 'l-1', lessonTitle: '贪心策略探究', lang: 'zh' }}
        />
      </PluginHostProvider>,
    );

    await waitFor(
      () => {
        expect(screen.getByText(/贪心策略探究/)).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(screen.queryByText(/连通正常/)).toBeNull();
  });
});
