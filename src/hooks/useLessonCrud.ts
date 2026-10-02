/**
 * useLessonCrud — 课时 CRUD 与白板元素拉取（C1-R2c）。
 *
 * 原 App.tsx 内联函数迁入；列表数据本体在 appStore（loadLessons），
 * selectedLesson/setElements 直接读 store，减少 props 透传。
 */
import { useRef } from 'react';
import { appStore, useAppStore } from '../store/appStore';
import { postLesson, deleteLesson, postCloneLesson, getLessonWhiteboard } from '../services/lessonService.js';
import type { AddToast } from './useToast';

export function useLessonCrud(deps: { lang: 'zh' | 'en'; addToast: AddToast; setCopyingLessonId: (id: string | null) => void }) {
  const { lang, addToast, setCopyingLessonId } = deps;
  const selectedLesson = useAppStore((s) => s.selectedLesson);
  const setSelectedLesson = useAppStore((s) => s.setSelectedLesson);
  const setElements = useAppStore((s) => s.setElements);

  const lastElementsJsonRef = useRef<string>('');

  const fetchLessons = async () => {
    await appStore.getState().loadLessons();
  };

  const handleQuickCreateLesson = async (title: string, content: string): Promise<string> => {
    try {
      const { ok, data } = await postLesson({ title, content });
      if (ok) {
        await fetchLessons();
        return data.id || 'lesson-created';
      }
    } catch (e) {
      console.error('Quick create lesson failed', e);
    }
    return '';
  };

  const handleDeleteCourse = async (lessonId: string) => {
    const { ok, data } = await deleteLesson(lessonId);
    if (!ok) {
      throw new Error(data.error || 'Failed to delete course');
    }
    await fetchLessons();
    if (selectedLesson === lessonId) {
      setSelectedLesson(null);
    }
    addToast(
      lang === 'zh' ? '课程已删除' : 'Course Deleted',
      lang === 'zh' ? '课程及其所有关联数据已被删除。' : 'The course and all associated data have been deleted.',
      'success',
    );
  };

  const handleCopyCourse = async (lessonId: string) => {
    setCopyingLessonId(lessonId);
    try {
      const { ok, data } = await postCloneLesson(lessonId);
      if (!ok) {
        throw new Error(data.error || 'Failed to copy course');
      }
      await fetchLessons();
      addToast(
        lang === 'zh' ? '复制成功' : 'Course Copied',
        lang === 'zh' ? '课程已成功复制。' : 'Course has been copied successfully.',
        'success',
      );
    } catch (e: any) {
      addToast(
        lang === 'zh' ? '复制失败' : 'Copy Failed',
        e.message || (lang === 'zh' ? '复制课程时发生错误。' : 'An error occurred while copying the course.'),
        'error',
      );
    } finally {
      setCopyingLessonId(null);
    }
  };

  const fetchElements = async (lessonId: string) => {
    try {
      const { ok, data } = await getLessonWhiteboard(lessonId);
      if (!ok) return;
      const jsonStr = JSON.stringify(data);
      if (jsonStr !== lastElementsJsonRef.current) {
        lastElementsJsonRef.current = jsonStr;
        setElements(data);
      }
    } catch {
      // ignore
    }
  };

  return {
    fetchLessons,
    handleQuickCreateLesson,
    handleDeleteCourse,
    handleCopyCourse,
    fetchElements,
    lastElementsJsonRef,
  };
}
