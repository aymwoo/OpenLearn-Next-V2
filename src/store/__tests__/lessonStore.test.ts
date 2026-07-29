import { describe, it, expect, beforeEach } from 'vitest';
import { lessonStore } from '../lessonStore';

describe('lessonStore', () => {
  beforeEach(() => {
    lessonStore.setState({
      lessons: [],
      selectedLesson: null,
      elements: [],
      vfsNodes: [],
    });
  });

  it('updates lessons using value or function updater', () => {
    const mockLesson1 = { id: 'l1', title: 'Lesson 1' } as any;
    const mockLesson2 = { id: 'l2', title: 'Lesson 2' } as any;

    lessonStore.getState().setLessons([mockLesson1]);
    expect(lessonStore.getState().lessons).toHaveLength(1);

    lessonStore.getState().setLessons((prev) => [...prev, mockLesson2]);
    expect(lessonStore.getState().lessons).toHaveLength(2);
  });

  it('updates selected lesson and elements', () => {
    lessonStore.getState().setSelectedLesson('l1');
    expect(lessonStore.getState().selectedLesson).toBe('l1');

    lessonStore.getState().setElements([{ id: 'e1', type: 'rect' } as any]);
    expect(lessonStore.getState().elements).toHaveLength(1);
  });
});
