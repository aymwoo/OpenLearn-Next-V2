import { describe, it, expect, afterEach, vi } from 'vitest';
import { rememberActiveLesson, readRememberedActiveLesson } from '../live-class-resume-memory';

describe('live-class-resume-memory（Issue #91 刷新/切标签页后不重复选课）', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('记住后可以读回，传 null 时清除', () => {
    expect(readRememberedActiveLesson()).toBeNull();
    rememberActiveLesson('lesson-101');
    expect(readRememberedActiveLesson()).toBe('lesson-101');
    rememberActiveLesson(null);
    expect(readRememberedActiveLesson()).toBeNull();
  });

  it('只写 sessionStorage（按标签页隔离，关掉标签页即失效），不写 localStorage', () => {
    rememberActiveLesson('lesson-202');
    expect(window.sessionStorage.getItem('openlearn.liveClass.activeLessonId')).toBe('lesson-202');
    expect(window.localStorage.getItem('openlearn.liveClass.activeLessonId')).toBeNull();
  });

  it('sessionStorage 不可用时不抛错（隐私模式退化为每次都要重选）', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => rememberActiveLesson('lesson-303')).not.toThrow();
    expect(readRememberedActiveLesson()).toBeNull();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
