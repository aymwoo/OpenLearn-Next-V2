/**
 * OpenLearn Presence Engine - Activity Detector
 * Detects interaction signals (mouse, keyboard, code, whiteboard, quiz, discussion) and updates Presence.
 */

import { PresenceStore } from './presence-store.js';

export type ActivitySignalType =
  | 'mouse_move'
  | 'key_input'
  | 'code_execute'
  | 'whiteboard_draw'
  | 'quiz_submit'
  | 'discussion_post'
  | 'plugin_interact';

export interface InteractionSignalData {
  readonly entityId: string;
  readonly type: ActivitySignalType;
  readonly detail?: string;
}

export class ActivityDetector {
  private store: PresenceStore;

  constructor(store: PresenceStore) {
    this.store = store;
  }

  /**
   * Process an incoming interaction signal and auto-update entity's activity and status.
   */
  public reportSignal(signal: InteractionSignalData): void {
    const entity = this.store.getPresence(signal.entityId);
    if (!entity) return;

    let activity = entity.activity;
    let status = entity.status;

    switch (signal.type) {
      case 'code_execute':
        activity = signal.detail || '运行 代码中...';
        if (entity.type === 'student') status = 'Coding';
        break;
      case 'whiteboard_draw':
        activity = signal.detail || '绘制 白板图形中...';
        if (entity.type === 'student') status = 'Writing';
        if (entity.type === 'teacher') status = 'Writing';
        break;
      case 'quiz_submit':
        activity = signal.detail || '提交 随堂测验';
        if (entity.type === 'student') status = 'Answering';
        break;
      case 'discussion_post':
        activity = signal.detail || '参与 课堂讨论';
        if (entity.type === 'student') status = 'Discussing';
        break;
      case 'plugin_interact':
        activity = signal.detail || '使用 插件工具';
        break;
      case 'key_input':
      case 'mouse_move':
      default:
        activity = signal.detail || '正在 课堂交互';
        break;
    }

    this.store.updatePresence(signal.entityId, {
      activity,
      status,
      lastActive: Date.now(),
    });
  }
}
