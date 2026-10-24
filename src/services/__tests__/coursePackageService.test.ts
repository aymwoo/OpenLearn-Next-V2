/**
 * 课程包导入的前端体积校验（Issue #246）。
 *
 * 病根：导入框承诺「最大不超过 20MB」，但客户端**只校验后缀**——
 * 超限文件被一路送到服务端，又被全局 2MB body 上限以裸 413 拒掉，
 * 教师既不知道自己文件多大，也不知道该怎么改。
 */
import { describe, it, expect } from 'vitest';
import {
  readCoursePackageFile,
  formatMegabytes,
  COURSE_PACKAGE_MAX_FILE_BYTES,
  COURSE_PACKAGE_MAX_FILE_MB,
  COURSE_PACKAGE_FORMAT,
} from '../coursePackageService';

/** 造一个指定体积的假文件（只需要 size 与 text）。 */
function makeFile(sizeBytes: number, name = 'openlearn-course-template.json'): File {
  const file = {
    name,
    size: sizeBytes,
    text: async () => JSON.stringify({ format: COURSE_PACKAGE_FORMAT, lesson: { title: 'x' } }),
  };
  return file as unknown as File;
}

describe('课程包导入 · 体积校验（Issue #246）', () => {
  it('超限文件在读取前就被拦下，并说清文件多大、上限是多少', async () => {
    const result = await readCoursePackageFile(makeFile(COURSE_PACKAGE_MAX_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain(`${COURSE_PACKAGE_MAX_FILE_MB}MB`);
    expect(result.error).toContain(formatMegabytes(COURSE_PACKAGE_MAX_FILE_BYTES + 1));
  });

  it('超限时不会去读文件内容（避免把几十 MB 读进内存）', async () => {
    let read = false;
    const file = {
      name: 'big.json',
      size: COURSE_PACKAGE_MAX_FILE_BYTES + 1,
      text: async () => {
        read = true;
        return '{}';
      },
    } as unknown as File;

    const result = await readCoursePackageFile(file);
    expect(result.ok).toBe(false);
    expect(read).toBe(false);
  });

  it('未超限的文件照常走解析流程', async () => {
    const result = await readCoursePackageFile(makeFile(1024));
    expect(result.ok).toBe(true);
  });

  it('上限常量与产品承诺一致（20MB）', () => {
    expect(COURSE_PACKAGE_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });
});
