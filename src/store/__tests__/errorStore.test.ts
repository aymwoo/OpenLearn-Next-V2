import { describe, it, expect, beforeEach } from 'vitest';
import { errorStore, formatSingleErrorReport, formatBatchErrorReport } from '../errorStore';
import type { SystemErrorItem } from '../../types/error';

describe('errorStore', () => {
  beforeEach(() => {
    errorStore.getState().clearErrors();
  });

  it('starts with empty errors array and closed modal', () => {
    const state = errorStore.getState();
    expect(state.errors).toEqual([]);
    expect(state.isErrorCenterOpen).toBe(false);
    expect(state.unreadCount).toBe(0);
  });

  it('adds an error and increments unreadCount', () => {
    const item = errorStore.getState().addError({
      type: 'runtime',
      title: '测试运行时异常',
      message: 'Uncaught TypeError: test is not a function',
      stack: 'Error: test\n    at Object.<anonymous>',
    });

    const state = errorStore.getState();
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].id).toBe(item.id);
    expect(state.errors[0].title).toBe('测试运行时异常');
    expect(state.unreadCount).toBe(1);
  });

  it('deduplicates identical errors occurring within 2 seconds', () => {
    const item1 = errorStore.getState().addError({
      type: 'api',
      title: 'API 500 Error',
      message: 'Worker activation timed out',
    });

    const item2 = errorStore.getState().addError({
      type: 'api',
      title: 'API 500 Error',
      message: 'Worker activation timed out',
    });

    expect(item1.id).toBe(item2.id);
    expect(errorStore.getState().errors).toHaveLength(1);
  });

  it('removes an error by id', () => {
    const item1 = errorStore.getState().addError({
      type: 'react',
      title: 'Error 1',
      message: 'Msg 1',
    });
    const item2 = errorStore.getState().addError({
      type: 'promise',
      title: 'Error 2',
      message: 'Msg 2',
    });

    expect(errorStore.getState().errors).toHaveLength(2);

    errorStore.getState().removeError(item1.id);
    expect(errorStore.getState().errors).toHaveLength(1);
    expect(errorStore.getState().errors[0].id).toBe(item2.id);
  });

  it('clears all errors and resets unread count', () => {
    errorStore.getState().addError({ type: 'runtime', title: 'E1', message: 'M1' });
    errorStore.getState().addError({ type: 'api', title: 'E2', message: 'M2' });

    errorStore.getState().clearErrors();

    const state = errorStore.getState();
    expect(state.errors).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    expect(state.isErrorCenterOpen).toBe(false);
  });

  it('formats single error report as markdown', () => {
    const errorItem: SystemErrorItem = {
      id: 'test-1',
      type: 'api',
      title: '服务端接口异常',
      message: 'Worker timeout after 60000ms',
      endpoint: '/api/plugins/toggle',
      status: 500,
      stack: 'WorkerTimeoutError: timeout\n    at worker-manager.ts:10',
      componentStack: '    in MyComponent',
      timestamp: 1774000000000,
      url: 'http://localhost:9000/#/plugins',
    };

    const md = formatSingleErrorReport(errorItem);
    expect(md).toContain('### [API] 服务端接口异常');
    expect(md).toContain('Worker timeout after 60000ms');
    expect(md).toContain('/api/plugins/toggle');
    expect(md).toContain('HTTP 500');
    expect(md).toContain('worker-manager.ts:10');
    expect(md).toContain('MyComponent');
  });

  it('formats batch error report with header and summary', () => {
    const errorItem: SystemErrorItem = {
      id: 'test-batch',
      type: 'promise',
      title: 'Promise Rejection',
      message: 'Network disconnected',
      timestamp: 1774000000000,
      url: 'http://localhost:9000/',
    };

    const batchMd = formatBatchErrorReport([errorItem]);
    expect(batchMd).toContain('# 🛠️ OpenLearn 系统异常诊断报告');
    expect(batchMd).toContain('**异常总数**: 1 项');
    expect(batchMd).toContain('#### 错误 #1 (PROMISE)');
    expect(batchMd).toContain('Network disconnected');
  });
});
