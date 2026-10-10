/**
 * Phase B4: 内存泄漏治理测试。
 *
 * 覆盖 lessonActiveSegments 语义（课程结束/删除清理钩子）。
 *
 * NOTE: MF_REMOTE_CACHE（MFE 边界）已随 v0.5.0 彻底移除，相关 TTL/容量用例同步删除。
 */
import { describe, it, expect } from 'vitest';

import { lessonActiveSegments } from '../shared-state.js';

describe('B4: lessonActiveSegments 清理钩子', () => {
  it('课程结束/删除清理后条目不存在（供 classroom.ts / lessons.ts 钩子使用的语义验证）', () => {
    lessonActiveSegments.set('lesson-mem-1', 'seg-1');
    expect(lessonActiveSegments.get('lesson-mem-1')).toBe('seg-1');
    lessonActiveSegments.delete('lesson-mem-1');
    expect(lessonActiveSegments.has('lesson-mem-1')).toBe(false);
  });
});
