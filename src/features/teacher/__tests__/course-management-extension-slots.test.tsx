import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

describe('Course & Lesson Extension Slots Integration', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    host = new FrontendPluginHost();
    usePluginHostStore.setState({ activePlugins: [], extensionPoints: new Map() });
  });

  afterEach(() => {
    cleanup();
  });

  it('course.list.toolbar.action 槽位正确挂载并向国家教育平台插件注入上下文', async () => {
    const NationalEduToolbarPlugin: React.FC<{ lang: string; refreshLessons?: () => void }> = ({ lang, refreshLessons }) => (
      <button data-testid="national-edu-sync-btn" onClick={refreshLessons}>
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
          slotProps={{ lang: 'zh', refreshLessons: refreshMock }}
        />
      </PluginHostProvider>,
    );

    const btn = await screen.findByTestId('national-edu-sync-btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('国家智慧教育平台同步');
  });

  it('course.card.badge 槽位正确挂载并展示精品课认证角标', async () => {
    const QualityCourseBadge: React.FC<{ lesson: Lesson }> = ({ lesson }) => (
      <span data-testid="quality-course-badge" className="badge">
        精品课认证 [{lesson.title}]
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
        <ExtensionPointRenderer
          slot="course.card.badge"
          slotProps={{ lesson: mockLesson }}
        />
      </PluginHostProvider>,
    );

    const badge = await screen.findByTestId('quality-course-badge');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('高中信息科技与算法编程');
  });

  it('course.card.action 槽位正确挂载并提供推送到国家平台功能', async () => {
    const PushToPlatformAction: React.FC<{ lesson: Lesson; lang: string }> = ({ lesson }) => (
      <button data-testid="push-to-national-btn">推送到国家智慧教育云平台 ({lesson.id})</button>
    );

    usePluginHostStore.getState().registerExtensionPoint('course.card.action', {
      id: 'ext_push_to_platform',
      pluginId: 'prov_national_edu',
      label: '推送到国家平台',
      component: createLazyComponent(PushToPlatformAction),
    });

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="course.card.action"
          slotProps={{ lesson: mockLesson, lang: 'zh' }}
        />
      </PluginHostProvider>,
    );

    const actionBtn = await screen.findByTestId('push-to-national-btn');
    expect(actionBtn).toBeTruthy();
    expect(actionBtn.textContent).toContain('les_test_01');
  });

  it('editor.segment.action 槽位在 SegmentEditorCard 中正确渲染并注入 segmentId', async () => {
    const CurriculumStandardAligner: React.FC<{ segmentId: string; segment: any; lang: string }> = ({
      segmentId,
      segment,
    }) => (
      <div data-testid="curriculum-standard-tag">
        对齐新课标: {segment?.title} (环节ID: {segmentId})
      </div>
    );

    usePluginHostStore.getState().registerExtensionPoint('editor.segment.action', {
      id: 'ext_curriculum_aligner',
      pluginId: 'prov_standards',
      label: '新课标素养对齐器',
      component: createLazyComponent(CurriculumStandardAligner),
    });

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
          onPatch={vi.fn()}
          onDelete={vi.fn()}
        />
      </PluginHostProvider>,
    );

    const standardTag = await screen.findByTestId('curriculum-standard-tag');
    expect(standardTag).toBeTruthy();
    expect(standardTag.textContent).toContain('导入：经典背包问题情境');
    expect(standardTag.textContent).toContain('seg_intro');
  });
});
