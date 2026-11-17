import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  createCourseLesson,
  attachLesson,
} from '../courseService';

function mockFetch(ok: boolean, body: unknown = {}) {
  const res = { ok, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('courseService', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('getCourses 请求课程列表', async () => {
    const fetchMock = mockFetch(true, [{ id: 'c1', title: '学案A' }]);
    const res = await getCourses();
    expect(fetchMock).toHaveBeenCalledWith('/api/courses');
    expect(res.ok).toBe(true);
    expect(res.data?.[0].title).toBe('学案A');
  });

  it('getCourse 请求课程详情', async () => {
    const fetchMock = mockFetch(true, { id: 'c1', lessons: [] });
    const res = await getCourse('c1');
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1');
    expect(res.data?.lessons).toEqual([]);
  });

  it('createCourse 以 POST + JSON 提交', async () => {
    const fetchMock = mockFetch(true, { id: 'c2' });
    const payload = { title: '学案B', description: 'desc', term: '2026', visibility: 'school' };
    const res = await createCourse(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.data?.id).toBe('c2');
  });

  it('updateCourse 以 PUT + JSON 提交', async () => {
    const fetchMock = mockFetch(true, { id: 'c1', title: '新标题' });
    await updateCourse('c1', { title: '新标题' });
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新标题' }),
    });
  });

  it('deleteCourse 以 DELETE 请求', async () => {
    const fetchMock = mockFetch(true, { success: true });
    await deleteCourse('c1');
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1', { method: 'DELETE' });
  });

  it('createCourseLesson 一步创建并挂到课程', async () => {
    const fetchMock = mockFetch(true, { lessonId: 'l1' });
    const res = await createCourseLesson('c1', '第 1 课时');
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/lessons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '第 1 课时' }),
    });
    expect(res.data?.lessonId).toBe('l1');
  });

  it('attachLesson 挂载既有课时', async () => {
    const fetchMock = mockFetch(true, { success: true });
    await attachLesson('c1', 'l9');
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/lessons/l9', { method: 'PUT' });
  });

  it('非 2xx 返回 ok:false 与后端错误', async () => {
    mockFetch(false, { error: 'title required' });
    const res = await createCourse({ title: '' });
    expect(res.ok).toBe(false);
    expect(res.error?.error).toBe('title required');
  });
});
