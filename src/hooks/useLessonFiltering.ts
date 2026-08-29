import { useState, useMemo } from 'react';
import type { Lesson } from '../types/app';

export function useLessonFiltering(lessons: Lesson[]) {
  const [lessonsSearchQuery, setLessonsSearchQuery] = useState('');
  const [lessonsSortOrder, setLessonsSortOrder] = useState<'recent' | 'alphabetical' | 'enrollment'>('recent');
  const [filterEnrollment, setFilterEnrollment] = useState(false);
  const [filterHasContent, setFilterHasContent] = useState(false);
  const [filterThisMonth, setFilterThisMonth] = useState(false);
  const [copyingLessonId, setCopyingLessonId] = useState<string | null>(null);

  const filteredAndSortedLessons = useMemo(() => {
    let result = [...lessons];
    if (lessonsSearchQuery.trim()) {
      const q = lessonsSearchQuery.toLowerCase();
      result = result.filter(
        (lesson) =>
          lesson.title.toLowerCase().includes(q) ||
          lesson.content.toLowerCase().includes(q),
      );
    }

    if (filterEnrollment) {
      result = result.filter((lesson) => (lesson.enrollment_count || 0) > 0);
    }
    if (filterHasContent) {
      result = result.filter((lesson) => lesson.content && lesson.content.trim().length > 0);
    }
    if (filterThisMonth) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
      result = result.filter((lesson) => (lesson.created_at || 0) >= monthStart);
    }

    if (lessonsSortOrder === 'recent') {
      result.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } else if (lessonsSortOrder === 'alphabetical') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lessonsSortOrder === 'enrollment') {
      result.sort((a, b) => (b.enrollment_count || 0) - (a.enrollment_count || 0));
    }

    return result;
  }, [lessons, lessonsSearchQuery, lessonsSortOrder, filterEnrollment, filterHasContent, filterThisMonth]);

  return {
    lessonsSearchQuery,
    setLessonsSearchQuery,
    lessonsSortOrder,
    setLessonsSortOrder,
    filterEnrollment,
    setFilterEnrollment,
    filterHasContent,
    setFilterHasContent,
    filterThisMonth,
    setFilterThisMonth,
    copyingLessonId,
    setCopyingLessonId,
    filteredAndSortedLessons,
  };
}
