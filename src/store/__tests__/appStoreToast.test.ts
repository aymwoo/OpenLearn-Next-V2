import { describe, it, expect, beforeEach } from 'vitest';
import { appStore } from '../appStore';
import { uiStore } from '../uiStore';

describe('appStore toast synchronization', () => {
  beforeEach(() => {
    uiStore.setState({ toasts: [] });
    appStore.setState({ toasts: [] });
  });

  it('adds exactly one toast when appStore.addToast is invoked', () => {
    const toast = {
      id: 'test-toast-1',
      title: '插件安装成功',
      message: '三方插件安装并激活！',
      type: 'success' as const,
    };

    appStore.getState().addToast(toast);

    expect(uiStore.getState().toasts).toHaveLength(1);
    expect(uiStore.getState().toasts[0].id).toBe('test-toast-1');

    expect(appStore.getState().toasts).toHaveLength(1);
    expect(appStore.getState().toasts[0].id).toBe('test-toast-1');
  });

  it('removes toast cleanly when appStore.removeToast is invoked', () => {
    const toast = {
      id: 'test-toast-2',
      title: '⭐ 课程发布成功',
      message: '课程已成功保存！',
      type: 'success' as const,
    };

    appStore.getState().addToast(toast);
    expect(appStore.getState().toasts).toHaveLength(1);

    appStore.getState().removeToast('test-toast-2');
    expect(uiStore.getState().toasts).toHaveLength(0);
    expect(appStore.getState().toasts).toHaveLength(0);
  });
});
