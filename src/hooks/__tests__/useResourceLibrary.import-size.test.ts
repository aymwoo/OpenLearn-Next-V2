/**
 * 导入框的统一文件入口（Issue #246）。
 *
 * 承诺是「最大不超过 20MB」，但此前**只校验后缀**——
 * 超限文件被一路送到服务端，被全局 2MB body 上限以裸 413 拒掉。
 * 这里钉住「体积校验发生在前端、且错误文案说清文件多大」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useResourceLibrary } from '../useResourceLibrary';
import { COURSE_PACKAGE_MAX_FILE_BYTES } from '../../services/coursePackageService';

/** 造一个指定体积的假文件（只需要 name / size）。 */
function makeFile(sizeBytes: number, name: string): File {
  return {
    name,
    size: sizeBytes,
    text: async () => '{}',
  } as unknown as File;
}

function renderLibrary() {
  return renderHook(() =>
    useResourceLibrary({
      lang: 'zh',
      session: {},
      fetchClasses: vi.fn(async () => {}),
      fetchStudents: vi.fn(async () => {}),
      fetchLessons: vi.fn(async () => {}),
      addToast: vi.fn(),
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useResourceLibrary · 导入文件体积校验（Issue #246）', () => {
  it('超限的课程包 JSON 在前端就被拦下，并说清上限', async () => {
    const { result } = renderLibrary();

    await act(async () => {
      await result.current.handleImportFileChange(makeFile(COURSE_PACKAGE_MAX_FILE_BYTES + 1, 'package.json'));
    });

    await waitFor(() => expect(result.current.importStatus).toBe('error'));
    expect(result.current.importErrorMsg).toContain('20MB');
    expect(result.current.importErrorMsg).toContain('超过');
  });

  it('超限的 CSV 同样被拦下（承诺对两种格式都成立）', async () => {
    const { result } = renderLibrary();

    await act(async () => {
      await result.current.handleImportFileChange(makeFile(COURSE_PACKAGE_MAX_FILE_BYTES + 1, 'lessons.csv'));
    });

    await waitFor(() => expect(result.current.importStatus).toBe('error'));
    expect(result.current.importErrorMsg).toContain('20MB');
    // CSV 路径没有走到解析（预览数据保持为空）
    expect(result.current.previewImportData).toEqual([]);
  });

  it('未超限的文件不会被体积校验拦下', async () => {
    const { result } = renderLibrary();

    await act(async () => {
      await result.current.handleImportFileChange(makeFile(1024, 'package.json'));
    });

    // 体积校验放行后，失败原因只会来自包内容本身（此处是空 JSON）
    expect(result.current.importErrorMsg).not.toContain('超过');
  });
});
