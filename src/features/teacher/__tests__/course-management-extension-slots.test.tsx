import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { SegmentEditorCard } from '../lesson-editor/SegmentEditorCard';
import type { Lesson } from '../../../types/app';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockLesson: Lesson = {
  id: 'les_test_01',
  title: '高中信息科技与算法编程',
  content: '贪心算法与动态规划',
  created_at: 1712000000000,
};

/**
 * 契约断言（v0.6.0 审计 R-1/R-2 整改基线）：
 * 宿主传参必须与 SlotProps 声明一致 —— course.card.* 传 `course`、
 * course.list.toolbar.action 传 `onRefresh`、editor.segment.action 补传
 * `readOnly`/`onPatch`。此前 lesson/refreshLessons 错位导致插件组件
 * 出生即死或假成功。
 */
describe('Course & Lesson Extension Slots Integration', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    host = new FrontendPluginHost();
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });
  });

  afterEach(() => {
    cleanup();
  });

  it('course.list.toolbar.action 槽位向插件注入 lang 与 onRefresh', async () => {
    const NationalEduToolbarPlugin: React.FC<{ lang?: string; onRefresh?: () => void }> = ({
      lang,
      onRefresh,
    }) => (
      <button data-testid="national-edu-sync-btn" onClick={() => onRefresh?.()}>
        {lang === 'zh' ? '国家智慧教育平台同步' : 'Sync National Platform'}
      </button>
    );

    usePluginHostStore.getState().registerExtensionPoint('course.list.toolbar.action', {
      id: 'ext_national_edu_sync',
      pluginId: 'prov_national_edu',
      label: '国家智慧教育平台同步',
      component: createLazyComponent(NationalEduToolbarPlugin),
    });

    const refreshMock = vi.fn();
    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="course.list.toolbar.action"
          slotProps={{ lang: 'zh', onRefresh: refreshMock }}
        />
      </PluginHostProvider>,
    );

    const btn = await screen.findByTestId('national-edu-sync-btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('国家智慧教育平台同步');

    // onRefresh 契约：点击按钮必须触达宿主刷新回调
    fireEvent.click(btn);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('course.card.badge 槽位以 course 字段注入课程对象', async () => {
    const QualityCourseBadge: React.FC<{ course?: Lesson }> = ({ course }) => (
      <span data-testid="quality-course-badge" className="badge">
        精品课认证 [{course?.title}]
      </span>
    );

    usePluginHostStore.getState().registerExtensionPoint('course.card.badge', {
      id: 'ext_quality_badge',
      pluginId: 'prov_certification',
      label: '精品课认证徽章',
      component: createLazyComponent(QualityCourseBadge),
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="course.card.badge" slotProps={{ course: mockLesson }} />
      </PluginHostProvider>,
    );

    const badge = await screen.findByTestId('quality-course-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('高中信息科技与算法编程');
  });

  it('course.card.action 槽位以 course 字段注入课程对象', async () => {
    const PushToPlatformAction: React.FC<{ course?: Lesson; lang?: string }> = ({ course }) => (
      <button data-testid="push-to-national-btn">推送到国家智慧教育云平台 ({course?.id})</button>
    );

    usePluginHostStore.getState().registerExtensionPoint('course.card.action', {
      id: 'ext_push_to_platform',
      pluginId: 'prov_national_edu',
      label: '推送到国家平台',
      component: createLazyComponent(PushToPlatformAction),
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer slot="course.card.action" slotProps={{ course: mockLesson, lang: 'zh' }} />
      </PluginHostProvider>,
    );

    const actionBtn = await screen.findByTestId('push-to-national-btn');
    expect(actionBtn).toBeTruthy();
    expect(actionBtn.textContent).toContain('les_test_01');
  });

  it('editor.segment.action 槽位注入 segmentId / readOnly / onPatch', async () => {
    const CurriculumStandardAligner: React.FC<{
      segmentId?: string;
      segment?: any;
      lang?: string;
      readOnly?: boolean;
      onPatch?: (patch: any) => void;
    }> = ({ segmentId, segment, readOnly, onPatch }) => (
      <div data-testid="curriculum-standard-tag">
        对齐新课标: {segment?.title} (环节ID: {segmentId}) [readOnly: {String(!!readOnly)}]
        <button data-testid="apply-align-btn" onClick={() => onPatch?.({ notes: 'aligned' })}>
          apply
        </button>
      </div>
    );

    usePluginHostStore.getState().registerExtensionPoint('editor.segment.action', {
      id: 'ext_curriculum_aligner',
      pluginId: 'prov_standards',
      label: '新课标素养对齐器',
      component: createLazyComponent(CurriculumStandardAligner),
    });

    const patchMock = vi.fn();
    const mockSegment = {
      id: 'seg_intro',
      title: '导入：经典背包问题情境',
      type: 'lecture',
      durationMinutes: 10,
    };

    render(
      <PluginHostProvider host={host}>
        <SegmentEditorCard
          lang="zh"
          segment={mockSegment}
          onPatch={patchMock}
          onDelete={vi.fn()}
        />
      </PluginHostProvider>,
    );

    const standardTag = await screen.findByTestId('curriculum-standard-tag');
    expect(standardTag).toBeTruthy();
    expect(standardTag.textContent).toContain('导入：经典背包问题情境');
    expect(standardTag.textContent).toContain('seg_intro');

    // onPatch 契约：插件补丁必须抵达宿主回调（SegmentEditorCard 未传 readOnly，默认可编辑）
    fireEvent.click(screen.getByTestId('apply-align-btn'));
    expect(patchMock).toHaveBeenCalledWith({ notes: 'aligned' });
  });
});
