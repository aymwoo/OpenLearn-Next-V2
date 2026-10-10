import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { afterEach } from 'vitest';

describe('SmartEduConnector (国家智慧教育平台连接器前端组件测试)', () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    // 重置插件宿主 store
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
      dashboardVisibility: new Map(),
    });
    vi.restoreAllMocks();
  });

  it('registerSmartEduExtensions 正确注册全部 9 个关键扩展槽位', () => {
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
    }
  });

  it('SmartEduCourseToolbarAction 弹出导入弹窗并展示国家平台示范课', async () => {
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

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, resources: mockResources }),
    } as any);

    const onRefreshMock = vi.fn();
    render(<SmartEduCourseToolbarAction onRefresh={onRefreshMock} lang="zh" />);

    // 验证工具栏按钮存在
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

  it('SmartEduAlertBanner & SmartEduStageTicker 正确渲染连通状态与跑马灯', () => {
    render(<SmartEduAlertBanner lessonId="lesson-1" />);
    expect(screen.getByText(/双师课堂数据通道已连通/)).toBeTruthy();
    expect(screen.getByText(/延迟: 16ms/)).toBeTruthy();

    render(<SmartEduStageTicker lessonTitle="高中物理示范课" />);
    expect(screen.getByText(/国家教育云·大屏示范广播/)).toBeTruthy();
    expect(screen.getByText(/高中物理示范课/)).toBeTruthy();
  });

  it('SmartEduPostClassExporter 导出 CELTS-3 规范学情包', () => {
    // Mock Blob & URL
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<SmartEduPostClassExporter lessonId="lesson-202" summaryData={{ attendanceRate: '99%' }} />);

    const exportBtn = screen.getByText('国家平台学情包导出');
    expect(exportBtn).toBeTruthy();

    fireEvent.click(exportBtn);

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(screen.getByText('已导出 CELTS-3 报告')).toBeTruthy();
  });

  it('SmartEduHeaderStatusPill & SmartEduAdminCard 正常呈现连通看板', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, rttMs: 16, syncedCoursesCount: 2 }),
    } as any);

    render(<SmartEduHeaderStatusPill currentRole="teacher" lang="zh" />);
    expect(screen.getByText('国家云')).toBeTruthy();
    expect(screen.getByText('已连通')).toBeTruthy();

    // 点击弹出状态框
    fireEvent.click(screen.getByText('国家云'));
    await waitFor(() => {
      expect(screen.getByText(/数据节点：/)).toBeTruthy();
      expect(screen.getByText(/api.smartedu.cn/)).toBeTruthy();
    });

    render(<SmartEduAdminCard siteInfo={{}} lang="zh" />);
    expect(screen.getByText(/国家智慧教育公共服务平台 · 接入看板/)).toBeTruthy();
    expect(screen.getByText(/已直连 \(双向同步\)/)).toBeTruthy();
  });
});
