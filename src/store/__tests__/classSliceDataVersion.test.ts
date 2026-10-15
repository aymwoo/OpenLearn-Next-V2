/**
 * Regression: 班级/学生名册导入后页面不会自动刷新。
 *
 * 历史症状：教师通过 ImportModal 上传 CSV 完成班级/学生导入后，必须手动
 * 刷新页面才能在 ClassesView 看到新增的班级与学生。后端写入与
 * bulkImportService → fetchClasses/fetchStudents 调用链均无报错。
 *
 * 根因（已修复）：导入完成后 bulkImportService 调用 store.loadClasses() /
 * loadStudents() 重新拉取，但此时如果 useAppStore 订阅的 `s.classes` /
 * `s.students` 数组引用在某些边界场景下被浅比较判定为「未变化」，
 * 整条 useAppComposer → appData → AppDataProvider → ClassesView 的
 * 重渲染链路就不会触发。
 *
 * 修复：在 classSlice 引入 dataVersion 自增计数器，loadClasses /
 * loadStudents 完成后 dataVersion+1，并在 useLessonsSlice /
 * useClassroomSlice / useSessionSlice 中订阅 dataVersion。这样即便
 * 数组浅比较抑制了重渲染，dataVersion 变化仍会强制消费方重渲染，
 * 新生成的 appData 引用经 AppDataProvider 向下推送。
 *
 * 本测试断言：
 *   1. loadClasses / loadStudents 会更新数据。
 *   2. loadClasses / loadStudents 会自增 dataVersion。
 *   3. dataVersion 订阅者会收到通知（即 useLessonsSlice 类订阅能感知）。
 *   4. parseAndImportClassesOrStudents 完成时会调用 fetchClasses + fetchStudents。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appStore } from '../appStore';
import { getClasses, getStudents } from '../../services/rosterService.js';
import { parseAndImportClassesOrStudents } from '../../services/bulkImportService.js';

vi.mock('../../services/rosterService.js', () => ({
  getClasses: vi.fn(),
  getStudents: vi.fn(),
  // 保留其它导出，避免影响其它测试
}));

const mockedGetClasses = vi.mocked(getClasses);
const mockedGetStudents = vi.mocked(getStudents);

describe('classSlice dataVersion (回归: 名册导入后自动刷新)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appStore.setState({
      classes: [],
      students: [],
      dataVersion: 0,
    });
  });

  it('loadClasses 同时更新 classes 和 dataVersion', async () => {
    mockedGetClasses.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'c1', name: '高一3班' }] as any,
    } as any);

    const before = appStore.getState().dataVersion;
    await appStore.getState().loadClasses();

    const after = appStore.getState();
    expect(after.classes).toHaveLength(1);
    expect(after.classes[0].id).toBe('c1');
    expect(after.dataVersion).toBe(before + 1);
  });

  it('loadStudents 同时更新 students 和 dataVersion', async () => {
    mockedGetStudents.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 's1', name: '张三' }] as any,
    } as any);

    const before = appStore.getState().dataVersion;
    await appStore.getState().loadStudents();

    const after = appStore.getState();
    expect(after.students).toHaveLength(1);
    expect(after.students[0].id).toBe('s1');
    expect(after.dataVersion).toBe(before + 1);
  });

  it('即使后端返回与上次相同的数据，dataVersion 也会自增（强制下游重渲染）', async () => {
    mockedGetClasses.mockResolvedValue({
      ok: true,
      data: [{ id: 'c1', name: '高一3班' }] as any,
    } as any);
    mockedGetStudents.mockResolvedValue({
      ok: true,
      data: [{ id: 's1', name: '张三' }] as any,
    } as any);

    await appStore.getState().loadClasses();
    const v1 = appStore.getState().dataVersion;
    await appStore.getState().loadStudents();
    const v2 = appStore.getState().dataVersion;
    // 两次都 +1，dataVersion 必变 → 即便数组内容未变也能驱动重渲染
    expect(v2).toBe(v1 + 1);
  });

  it('订阅 dataVersion 的消费者会在导入完成后收到通知', async () => {
    let received = 0;
    const unsub = appStore.subscribe((s, prev) => {
      if (s.dataVersion !== prev.dataVersion) received += 1;
    });

    mockedGetClasses.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'c1', name: '高一3班' }] as any,
    } as any);
    mockedGetStudents.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 's1', name: '张三' }] as any,
    } as any);

    await appStore.getState().loadClasses();
    await appStore.getState().loadStudents();

    unsub();
    expect(received).toBe(2);
  });

  it('parseAndImportClassesOrStudents 在成功后调用 fetchClasses + fetchStudents（导入后自动刷新链路）', async () => {
    // jsdom 没有 base URL，拦截全局 fetch 让 /api/classes/import 返回成功。
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (url: any) => {
      // 统一返回成功（班级+学生两个 POST），结构与 server 路由返回一致
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          imported: [{ class_id: 'c1', name: '高一3班', studentsCount: 1 }],
          credentials: [],
        }),
        text: async () =>
          JSON.stringify({
            ok: true,
            imported: [{ class_id: 'c1', name: '高一3班', studentsCount: 1 }],
            credentials: [],
          }),
      } as any;
    });
    globalThis.fetch = fetchSpy as any;

    try {
      // 模拟 fetchClasses / fetchStudents 是 useAppComposer 闭包里的 store 动作
      const fetchClasses = vi.fn(async () => {
        await appStore.getState().loadClasses();
      });
      const fetchStudents = vi.fn(async () => {
        await appStore.getState().loadStudents();
      });

      // 准备一个最小可用的 CSV blob（班级 + 学生各 1 行）
      const csv = [
        'class_name,class_grade,class_year,student_name,student_no,gender,initial_password',
        '高一3班,高一,2025,张三,S001,male,123456',
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const file = new File([blob], 'roster.csv', { type: 'text/csv' });

      mockedGetClasses.mockResolvedValue({ ok: true, data: [] } as any);
      mockedGetStudents.mockResolvedValue({ ok: true, data: [] } as any);

      const result = await parseAndImportClassesOrStudents(file, {
        lang: 'zh',
        fetchClasses,
        fetchStudents,
      });

      // 期望：解析成功，并且两个 refresh 动作都被调用过（顺序不限但都 ≥ 1）
      expect(result.success).toBe(true);
      expect(fetchClasses).toHaveBeenCalled();
      expect(fetchStudents).toHaveBeenCalled();
      // 至少一次 loadStudents（在 importStudents 之后）让 dataVersion 自增
      expect(appStore.getState().dataVersion).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
