import { describe, it, expect, beforeEach } from 'vitest';
import {
  errorStore,
  formatSingleErrorReport,
  formatBatchErrorReport,
  registerErrorListener,
} from '../errorStore';
import type { SystemErrorItem } from '../../types/error';

describe('errorStore', () => {
  beforeEach(() => {
    errorStore.getState().clearErrors();
  });

  /** 未读计数必须始终满足 0 <= unreadCount <= errors.length */
  const expectUnreadInvariant = () => {
    const { unreadCount, errors } = errorStore.getState();
    expect(unreadCount).toBeGreaterThanOrEqual(0);
    expect(unreadCount).toBeLessThanOrEqual(errors.length);
  };

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
    // 被删除的那条还是未读的，角标必须随之减一
    expect(errorStore.getState().unreadCount).toBe(1);
    expectUnreadInvariant();
  });

  it('keeps unreadCount in step with the list when errors are removed', () => {
    const itemA = errorStore.getState().addError({ type: 'runtime', title: 'A', message: 'msg-A' });
    errorStore.getState().addError({ type: 'runtime', title: 'B', message: 'msg-B' });
    errorStore.getState().addError({ type: 'runtime', title: 'C', message: 'msg-C' });
    expect(errorStore.getState().unreadCount).toBe(3);

    errorStore.getState().removeError(itemA.id);
    expect(errorStore.getState().unreadCount).toBe(2);
    expectUnreadInvariant();

    // 逐条删空后角标必须归零，不能残留正数
    for (const err of [...errorStore.getState().errors]) {
      errorStore.getState().removeError(err.id);
    }
    expect(errorStore.getState().errors).toHaveLength(0);
    expect(errorStore.getState().unreadCount).toBe(0);
    expectUnreadInvariant();
  });

  it('keeps unreadCount within the list length when the stored-error cap truncates entries', () => {
    // 超过 MAX_STORED_ERRORS 后每次 addError 都会截断最旧的一条；
    // 计数若仍无条件 +1 就会超出实际错误总数。
    for (let i = 0; i < 40; i += 1) {
      errorStore.getState().addError({ type: 'runtime', title: `E${i}`, message: `message-${i}` });
    }

    const { errors, unreadCount } = errorStore.getState();
    expect(errors.length).toBeLessThan(40); // 确实发生了截断
    expectUnreadInvariant();
    expect(unreadCount).toBe(errors.length); // 此刻每一条都还是未读
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

  it('manages student errors and formats student error reports', () => {
    errorStore.getState().clearStudentErrors();
    expect(errorStore.getState().studentErrors).toEqual([]);

    errorStore.getState().addStudentError({
      id: 'st-err-1',
      studentId: 'stu-101',
      studentName: '张小明',
      lessonId: 'lesson-88',
      classId: 'class-1',
      type: 'runtime',
      title: '课件交互脚本异常',
      message: 'Cannot read properties of undefined',
      timestamp: 1774000001000,
      url: 'http://localhost:9000/student_live',
    });

    const state = errorStore.getState();
    expect(state.studentErrors).toHaveLength(1);
    expect(state.studentErrors[0].studentName).toBe('张小明');

    // Deduplication check
    errorStore.getState().addStudentError({
      id: 'st-err-2',
      studentId: 'stu-101',
      type: 'runtime',
      title: '课件交互脚本异常',
      message: 'Cannot read properties of undefined',
      timestamp: 1774000001500,
      url: 'http://localhost:9000/student_live',
    });
    expect(errorStore.getState().studentErrors).toHaveLength(1);

    // Batch report includes student errors
    const report = formatBatchErrorReport(state.errors, state.studentErrors);
    expect(report).toContain('学生端异常数**: 1 项');
    expect(report).toContain('张小明');
    expect(report).toContain('Cannot read properties of undefined');

    // Remove student error
    errorStore.getState().removeStudentError('st-err-1');
    expect(errorStore.getState().studentErrors).toHaveLength(0);
  });

  it('invokes registered error listeners on addError', () => {
    let captured: any = null;
    const unregister = registerErrorListener((err: any) => {
      captured = err;
    });

    const item = errorStore.getState().addError({
      type: 'api',
      title: 'API Fail',
      message: 'Server down',
    });

    expect(captured).not.toBeNull();
    expect(captured.id).toBe(item.id);
    expect(captured.message).toBe('Server down');

    unregister();
    captured = null;

    errorStore.getState().addError({
      type: 'api',
      title: 'Another Fail',
      message: 'Server timeout',
    });
    expect(captured).toBeNull();
  });
});

