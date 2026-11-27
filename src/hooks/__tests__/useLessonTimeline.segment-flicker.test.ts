// @vitest-environment jsdom
/**
 * 回归：学生 live_class 中学案/白板课时闪动（activeSegmentId ping-pong）。
 *
 * 服务端课堂会话的 current_segment_id 是权威环节指针，可能指向备课 timeline
 * 之外的新环节（如 mode pack 的 xuean:study 等自定义环节类型）。此前
 * useLessonTimeline 在每次 lessons 刷新（2s 轮询）时，只要发现当前环节 id
 * 不在本地 timeline 里就重置为 segments[0].id，与 2.5s 会话轮询互相回写，
 * 形成约 2s 的确定性振荡；经 useSegmentAccess 的 loading 态放大为整块内容
 * 在「尚未解锁」占位与实际学案工作区之间反复闪动。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Lesson } from '../../types/app';
import { useLessonTimeline } from '../useLessonTimeline';

function makeLesson(timeline: unknown): Lesson {
  return {
    id: 'lesson-1',
    title: '学案课',
    timeline: JSON.stringify(timeline),
  } as Lesson;
}

const LOCAL_SEGMENTS = [
  { id: 'seg-1', title: '开场', type: 'intro' },
  { id: 'seg-2', title: '讲授', type: 'lecture' },
];
const SERVER_SEGMENT_ID = 'xuean:study';

describe('useLessonTimeline —— 服务端环节指针不被 lessons 刷新覆盖', () => {
  let setLessons: (updater: (prev: Lesson[]) => Lesson[]) => void;

  beforeEach(() => {
    setLessons = vi.fn() as unknown as (updater: (prev: Lesson[]) => Lesson[]) => void;
  });

  it('lessons 周期性刷新时保留会话设置的环节 id，不重置为 timeline 第一段', () => {
    const { result, rerender } = renderHook(
      ({ lessons }) =>
        useLessonTimeline({
          selectedLesson: 'lesson-1',
          lessons,
          setLessons,
        }),
      { initialProps: { lessons: [makeLesson(LOCAL_SEGMENTS)] } },
    );

    // 模拟服务端会话把当前环节推进到备课 timeline 之外的 mode pack 环节。
    act(() => {
      result.current.setActiveSegmentId(SERVER_SEGMENT_ID);
    });
    expect(result.current.activeSegmentId).toBe(SERVER_SEGMENT_ID);

    // 2s 轮询返回新的 lessons 数组（内容未变，仅引用更新）——不应回退环节。
    rerender({ lessons: [makeLesson(LOCAL_SEGMENTS)] });
    expect(result.current.activeSegmentId).toBe(SERVER_SEGMENT_ID);

    // 再刷新几轮，确保振荡不会在后续 tick 出现。
    for (let i = 0; i < 3; i += 1) {
      rerender({ lessons: [makeLesson(LOCAL_SEGMENTS)] });
      expect(result.current.activeSegmentId).toBe(SERVER_SEGMENT_ID);
    }
  });

  it('切换到新课时仍然重置到第一段', () => {
    const { result, rerender } = renderHook(
      ({ selectedLesson, lessons }) =>
        useLessonTimeline({
          selectedLesson,
          lessons,
          setLessons,
        }),
      {
        initialProps: {
          selectedLesson: 'lesson-1',
          lessons: [makeLesson(LOCAL_SEGMENTS), makeLesson(LOCAL_SEGMENTS)],
        },
      },
    );
    // 上一课时把 id 改成 timline 之外的服务端环节
    const twoLessons = [makeLesson(LOCAL_SEGMENTS), { ...makeLesson(LOCAL_SEGMENTS), id: 'lesson-2' }];
    rerender({ selectedLesson: 'lesson-1', lessons: twoLessons });
    act(() => {
      result.current.setActiveSegmentId(SERVER_SEGMENT_ID);
    });

    rerender({ selectedLesson: 'lesson-2', lessons: twoLessons });
    expect(result.current.activeSegmentId).toBe('seg-1');
  });
});
