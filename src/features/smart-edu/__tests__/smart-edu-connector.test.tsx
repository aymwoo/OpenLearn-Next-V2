import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { registerSmartEduExtensions, SMART_EDU_PLUGIN_ID } from '../smart-edu-plugin';
import { SmartEduCourseToolbarAction } from '../components/SmartEduCourseToolbarAction';
import { SmartEduCourseBadge } from '../components/SmartEduCourseBadge';
import { SmartEduCourseCardAction } from '../components/SmartEduCourseCardAction';
import { SmartEduSegmentAction } from '../components/SmartEduSegmentAction';
import { SmartEduAlertBanner } from '../components/SmartEduAlertBanner';
import { SmartEduStageTicker } from '../components/SmartEduStageTicker';
import { SmartEduPostClassExporter } from '../components/SmartEduPostClassExporter';
import { SmartEduHeaderStatusPill } from '../components/SmartEduHeaderStatusPill';
import { SmartEduAdminCard } from '../components/SmartEduAdminCard';

const CONFIGURED_STATUS = {
  success: true,
  configured: true,
  connected: true,
  endpoint: 'https://gateway.test/smart-edu',
  rttMs: 16,
  channelStatus: 'HEALTHY',
  syncedCoursesCount: 2,
  lastHeartbeat: new Date().toISOString(),
};

const UNCONFIGURED_STATUS = { success: true, configured: false, connected: false };

/** 按 URL 分发 fetch mock：状态接口与资源接口互不干扰 */
function mockFetchByUrl(handler: (url: string) => any) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const body = handler(url);
    return { ok: true, status: 200, json: async () => body } as any;
  });
}

describe('SmartEduConnector (国家智慧教育平台连接器前端组件测试)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    // 重置插件宿主 store
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      dashboardVisibility: new Map(),
    });
  });

  it('显式启用后 registerSmartEduExtensions 以直接组件注册全部 9 个关键扩展槽位', () => {
    // v0.6.1 用户决策：内置包默认停用 —— 测试先在 Plugin Center 语义下启用
    usePluginHostStore.getState().setBuiltinBundleEnabled(SMART_EDU_PLUGIN_ID, true);
    registerSmartEduExtensions();
    const store = usePluginHostStore.getState();

    const expectedSlots = [
      'course.list.toolbar.action',
      'course.card.badge',
      'course.card.action',
      'editor.segment.action',
      'classroom.alert.banner',
      'classroom.stage.display.ticker',
      'classroom.post_class.exporter',
      'header.status_pill',
      'admin.dashboard.card',
    ];

    for (const slot of expectedSlots) {
      const exts = store.extensionPoints.get(slot as any);
      expect(exts, `扩展槽 ${slot} 必须有注册项`).toBeTruthy();
      expect(exts!.length).toBeGreaterThanOrEqual(1);
      expect(exts![0].pluginId).toBe(SMART_EDU_PLUGIN_ID);
      // 契约：同 bundle 组件必须是直接组件（不是未打标的 lazy 工厂），
      // 否则 renderer 会把工厂当组件渲染 → Suspense 永久悬挂（v0.6.0 C-1 事故）
      const comp = exts![0].component as any;
      expect(comp.__isLazyFactory).toBeUndefined();
    }
  });

  it('SmartEduCourseToolbarAction 弹出导入弹窗并展示网关检索到的资源', async () => {
    const mockResources = [
      {
        id: 'sed-01',
        code: 'SED-2026-IT-0089',
        title: '算法与程序设计：贪心策略在资源排程中的应用',
        subject: 'information_tech',
        grade: 'high_1',
        edition: 'zhejiang',
        awardLevel: 'national_gold',
        teacherName: '张敏 老师',
        schoolName: '杭州高级中学',
        summary: '基于机房排程冲突问题的计算思维课例',
        tags: ['计算思维', '国家一等奖精品课'],
        timeline: [{ id: 's1', title: '环节1', type: 'lecture', duration: 10, description: '介绍' }],
      },
    ];

    mockFetchByUrl((url) =>
      url.includes('/resources?') ? { success: true, total: 1, resources: mockResources } : CONFIGURED_STATUS,
    );

    const onRefreshMock = vi.fn();
    render(<SmartEduCourseToolbarAction onRefresh={onRefreshMock} lang="zh" />);

    // 等状态探测完成（弹窗打开前 useSmartEduStatus 已在后台取数）
    const btn = screen.getByText('国家平台导入');
    expect(btn).toBeTruthy();

    // 点击打开弹窗
    fireEvent.click(btn);
    expect(screen.getByText(/国家智慧教育公共服务平台/)).toBeTruthy();

    // 等待资源列表加载完成
    await waitFor(() => {
      expect(screen.getByText('算法与程序设计：贪心策略在资源排程中的应用')).toBeTruthy();
      expect(screen.getByText(/杭州高级中学/)).toBeTruthy();
      expect(screen.getByText('一键导入本地')).toBeTruthy();
    });
  });

  it('网关未配置时导入弹窗如实显示未配置态而非空资源列表', async () => {
    mockFetchByUrl(() => UNCONFIGURED_STATUS);

    render(<SmartEduCourseToolbarAction onRefresh={vi.fn()} lang="zh" />);
    fireEvent.click(screen.getByText('国家平台导入'));

    await waitFor(() => {
      expect(screen.getByText('国家平台网关未配置')).toBeTruthy();
      expect(screen.queryByText('一键导入本地')).toBeNull();
    });
  });

  it('SmartEduCourseBadge 正确识别并呈现国家精品课徽标', () => {
    // 带有国家平台认证元数据的课程
    const certifiedCourse = {
      id: 'lesson-c1',
      title: '算法与程序设计',
      content: JSON.stringify({
        smartEduMetadata: {
          certified: true,
          code: 'SED-2026-IT-0089',
          awardLevel: 'national_gold',
        },
      }),
    };

    const { rerender } = render(<SmartEduCourseBadge course={certifiedCourse} />);
    expect(screen.getByText('国家精品课')).toBeTruthy();

    // 带有【国家精品课】标题前缀的课程
    const titleCourse = {
      id: 'lesson-c2',
      title: '【国家精品课】数字化物理传感探究',
      content: '',
    };
    rerender(<SmartEduCourseBadge course={titleCourse} />);
    expect(screen.getByText('国家精品课')).toBeTruthy();

    // 未认证的普通课程，应当返回 null (空内容)
    const normalCourse = {
      id: 'lesson-c3',
      title: '常规随堂测验',
      content: '纯文本描述',
    };
    rerender(<SmartEduCourseBadge course={normalCourse} />);
    expect(screen.queryByText('国家精品课')).toBeNull();
  });

  it('SmartEduCourseCardAction 执行上报国家云动作', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, receiptId: 'CELTS-123' }),
    } as any);

    const onRefresh = vi.fn();
    const course = { id: 'lesson-1', title: '测试课程' };
    render(<SmartEduCourseCardAction course={course} onRefresh={onRefresh} />);

    const reportBtn = screen.getByTitle(/同步本课教案与元数据至国家智慧教育公共服务平台/);
    expect(reportBtn).toBeTruthy();

    fireEvent.click(reportBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/external/smart-edu/report', expect.anything());
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('SmartEduSegmentAction 步骤卡片关联国家微课切片', () => {
    const onPatch = vi.fn();
    const segment = { id: 'seg-101', title: '探究环节', description: '原有环节设计' };

    render(<SmartEduSegmentAction segment={segment} onPatch={onPatch} readOnly={false} />);

    const btn = screen.getByText('国家微课');
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('国家智慧教育平台·资源切片'),
      }),
    );
  });

  it('网关在线时 AlertBanner 渲染真实状态；未配置时不渲染', async () => {
    // 未配置 → 横幅不渲染（绝不展示虚构的连通状态）
    mockFetchByUrl(() => UNCONFIGURED_STATUS);
    render(<SmartEduAlertBanner lessonId="lesson-1" />);
    await waitFor(() => {
      expect(screen.queryByText(/双师课堂数据通道已连通/)).toBeNull();
    });

    cleanup();

    // 在线 → 渲染且不含编造的固定延迟
    mockFetchByUrl(() => CONFIGURED_STATUS);
    render(<SmartEduAlertBanner lessonId="lesson-1" />);
    await waitFor(() => {
      expect(screen.getByText(/双师课堂数据通道已连通/)).toBeTruthy();
    });
    expect(screen.queryByText(/延迟: 16ms/)).toBeNull();
  });

  it('SmartEduStageTicker 只播报课程信息，不做连通性断言', () => {
    render(<SmartEduStageTicker lessonTitle="高中物理示范课" />);
    expect(screen.getByText(/国家教育云·大屏示范广播/)).toBeTruthy();
    expect(screen.getByText(/高中物理示范课/)).toBeTruthy();
    // 跑马灯不再虚构“● 连通正常”
    expect(screen.queryByText(/连通正常/)).toBeNull();
  });

  it('SmartEduPostClassExporter 导出真实统计，缺失维度显式置 null', () => {
    // Mock Blob & URL
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.fn();
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === 'a') (el as any).click = clickSpy;
      return el;
    }) as any);

    render(
      <SmartEduPostClassExporter
        lessonId="lesson-202"
        summaryData={{
          lessonTitle: '贪心策略探究课',
          className: '高一(3)班',
          attemptsCount: 12,
          exitTicketStats: { avgRating: 4.5, count: 10, topConcepts: ['区间贪心'] },
        }}
      />,
    );

    const exportBtn = screen.getByText('国家平台学情包导出');
    expect(exportBtn).toBeTruthy();

    fireEvent.click(exportBtn);

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(screen.getByText('已导出 CELTS-3 报告')).toBeTruthy();

    // 导出的 JSON 必须携带真实统计与完整性标注
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    void (blobArg && 'text' in blobArg ? blobArg.text() : Promise.resolve(''));
  });

  it('SmartEduHeaderStatusPill 三态呈现：在线显示真实端点与延迟', async () => {
    mockFetchByUrl(() => CONFIGURED_STATUS);

    render(<SmartEduHeaderStatusPill lang="zh" />);
    await waitFor(() => {
      expect(screen.getByText('已连通')).toBeTruthy();
    });

    // 点击弹出状态框
    fireEvent.click(screen.getByText('国家云'));
    await waitFor(() => {
      expect(screen.getByText(/网关地址：/)).toBeTruthy();
      expect(screen.getByText('https://gateway.test/smart-edu')).toBeTruthy();
      expect(screen.getByText('16 ms')).toBeTruthy();
    });
  });

  it('SmartEduHeaderStatusPill 未配置态如实提示，不显示已连通', async () => {
    mockFetchByUrl(() => UNCONFIGURED_STATUS);

    render(<SmartEduHeaderStatusPill lang="zh" />);
    await waitFor(() => {
      expect(screen.getByText('未配置')).toBeTruthy();
    });
    expect(screen.queryByText('已连通')).toBeNull();
  });

  it('SmartEduAdminCard 呈现真实网关状态与本地库信息', async () => {
    mockFetchByUrl(() => CONFIGURED_STATUS);

    render(
      <SmartEduAdminCard
        sqliteStats={{
          status: 'connected',
          type: 'sqlite',
          pageSize: 4096,
          pageCount: 100,
          diskUsageBytes: 409600,
          diskUsageFriendly: '400 KB',
        }}
        lang="zh"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('已连通')).toBeTruthy();
      expect(screen.getByText('2 门')).toBeTruthy();
      expect(screen.getByText('400 KB')).toBeTruthy();
    });
    // 假数据必须消失
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByText(/已直连 \(双向同步\)/)).toBeNull();
  });
});
