/**
 * 大屏展台 · 同页模态框（降级路径 / 兼容旧调用方）
 *
 * 主路径已改为「独立窗口」（见 StageDisplayView）：大屏展台要投到副屏/投影上，
 * 覆盖在授课界面上等于教师自己被挡在屏幕外。
 * 本组件保留用于两种情况：
 *   1. 浏览器拦截了 window.open（教师手动允许后可用）
 *   2. 既有调用方 / 测试仍按模态框使用
 *
 * 展示层已抽到 StageDisplayPanel，两条路径共用同一份 UI，不会文案漂移。
 */
import React from 'react';
import { StageDisplayPanel } from './stage-display/StageDisplayPanel';
import { useStageDisplayFeed } from './stage-display/useStageDisplayFeed';

export interface StageDisplayModalProps {
  isOpen: boolean;
  onClose: () => void;
  lessonId: string;
  lessonTitle?: string;
  lang?: 'zh' | 'en';
}

export function StageDisplayModal({ isOpen, onClose, lessonId, lessonTitle, lang = 'zh' }: StageDisplayModalProps) {
  const { data, health, lastSyncedAt } = useStageDisplayFeed(lessonId, { enabled: isOpen });

  if (!isOpen) return null;

  return (
    <StageDisplayPanel
      lessonId={lessonId}
      lessonTitle={lessonTitle}
      data={data}
      lang={lang}
      health={health}
      lastSyncedAt={lastSyncedAt}
      onClose={onClose}
    />
  );
}
