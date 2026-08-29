import { useState } from 'react';

export interface UseCourseWizardOptions {
  lang: 'zh' | 'en';
  addToast: (title: string, msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  fetchLessons: () => Promise<void>;
  setSelectedLesson: (id: string | null) => void;
  setTeacherTab: (tab: string) => void;
}

export function useCourseWizard(options: UseCourseWizardOptions) {
  const { lang, addToast, fetchLessons, setSelectedLesson, setTeacherTab } = options;

  const [isCourseWizardOpen, setIsCourseWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardCourseTitle, setWizardCourseTitle] = useState('');
  const [wizardCourseCategory, setWizardCourseCategory] = useState('Mathematics');
  const [wizardCourseDescription, setWizardCourseDescription] = useState('');
  const [wizardCourseContent, setWizardCourseContent] = useState('');
  const [wizardCourseTimeline, setWizardCourseTimeline] = useState<any[]>([
    { id: 'seg-w1', title: 'Course Orientation / 课堂导入', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Introduce basic goals' },
    { id: 'seg-w2', title: 'Subject Core Lecture / 核心精讲', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Present major content frameworks' },
    { id: 'seg-w3', title: 'Interactive Lab Work / 实践演练', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Provide collaborative assignments on terminal or board' },
    { id: 'seg-w4', title: 'Wrap up / 随堂总结与答疑', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Reflect and assign task' },
  ]);
  const [wizardIsSubmitting, setWizardIsSubmitting] = useState(false);

  const handleDeployWizardCourse = async () => {
    if (!wizardCourseTitle.trim()) {
      alert(lang === 'zh' ? '请输入课程标题！' : 'Please provide a course title!');
      return;
    }
    setWizardIsSubmitting(true);
    try {
      const displayContent =
        wizardCourseContent.trim() ||
        `Course outline for ${wizardCourseTitle} (${wizardCourseCategory})`;
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wizardCourseTitle,
          content: displayContent,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newLessonId = data.result?.lessonId;
        if (newLessonId) {
          await fetch(`/api/lessons/${newLessonId}/timeline`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline: wizardCourseTimeline }),
          });
        }
        await fetchLessons();
        if (newLessonId) {
          setSelectedLesson(newLessonId);
          setTeacherTab('lesson_editor');
        }
        addToast(
          lang === 'zh' ? '⭐ 课程发布成功' : '⭐ Course Deployed Successfully',
          lang === 'zh'
            ? `课程《${wizardCourseTitle}》已成功保存到核心SQLite并已自动激活！`
            : `Course "${wizardCourseTitle}" is now live in SQLite and auto-activated.`,
          'success',
        );
        setIsCourseWizardOpen(false);
        setWizardCourseTitle('');
        setWizardCourseCategory('Mathematics');
        setWizardCourseDescription('');
        setWizardCourseContent('');
        setWizardStep(1);
      } else {
        addToast('Error', 'SQLite save failed', 'warning');
      }
    } catch (err) {
      console.error(err);
      addToast('Error', 'Launch Exception', 'warning');
    } finally {
      setWizardIsSubmitting(false);
    }
  };

  return {
    isCourseWizardOpen,
    setIsCourseWizardOpen,
    wizardStep,
    setWizardStep,
    wizardCourseTitle,
    setWizardCourseTitle,
    wizardCourseCategory,
    setWizardCourseCategory,
    wizardCourseDescription,
    setWizardCourseDescription,
    wizardCourseContent,
    setWizardCourseContent,
    wizardCourseTimeline,
    setWizardCourseTimeline,
    wizardIsSubmitting,
    setWizardIsSubmitting,
    handleDeployWizardCourse,
  };
}
