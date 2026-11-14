import { useState } from 'react';

export interface DefaultWizardSegment {
  id: string;
  title: string;
  type: 'intro' | 'lecture' | 'practice' | 'summary';
  duration: string;
  color: string;
  notes: string;
}

export function getDefaultWizardTimeline(
  lang: 'zh' | 'en',
  idPrefix: 'seg-w' | 'seg-preset-' = 'seg-w',
): DefaultWizardSegment[] {
  const zh = lang === 'zh';
  return [
    {
      id: `${idPrefix}1`,
      title: zh ? '课堂导入' : 'Course Orientation',
      type: 'intro',
      duration: '5m',
      color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
      notes: zh ? '明确本课学习目标与情境导入' : 'Introduce basic goals',
    },
    {
      id: `${idPrefix}2`,
      title: zh ? '核心精讲' : 'Subject Core Lecture',
      type: 'lecture',
      duration: '15m',
      color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
      notes: zh ? '讲解核心概念与重点内容' : 'Present major content frameworks',
    },
    {
      id: `${idPrefix}3`,
      title: zh ? '互动演练' : 'Interactive Lab Work',
      type: 'practice',
      duration: '15m',
      color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
      notes: zh ? '开展随堂练习与协作实践' : 'Provide collaborative assignments on terminal or board',
    },
    {
      id: `${idPrefix}4`,
      title: zh ? '课堂总结' : 'Lesson Wrap-up',
      type: 'summary',
      duration: '5m',
      color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
      notes: zh ? '回顾重点知识并安排课后任务' : 'Reflect and assign task',
    },
  ];
}

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
  const [wizardCourseTimeline, setWizardCourseTimeline] = useState<any[]>(() => getDefaultWizardTimeline(lang));
  const [wizardIsSubmitting, setWizardIsSubmitting] = useState(false);
  const [wizardIsGeneratingOutline, setWizardIsGeneratingOutline] = useState(false);

  /**
   * 依据课题调用后端 AI Provider 真实生成 Markdown 教学大纲。
   * （原先此处调用的是前端硬编码的 `generateTemplateContent` 静态模板，与课题无关。）
   */
  const handleGenerateOutline = async () => {
    if (wizardIsGeneratingOutline) return;

    if (!wizardCourseTitle.trim()) {
      addToast(
        lang === 'zh' ? '请先填写课程课题' : 'Course Title Required',
        lang === 'zh' ? 'AI 需要课题名称才能生成大纲。' : 'AI needs a course title to generate the outline.',
        'warning',
      );
      return;
    }

    setWizardIsGeneratingOutline(true);
    try {
      const res = await fetch('/api/lessons/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: wizardCourseTitle,
          category: wizardCourseCategory,
          description: wizardCourseDescription,
          timeline: wizardCourseTimeline,
          lang,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }

      const content = (data.content || '').trim();
      if (!content) throw new Error(lang === 'zh' ? 'AI 返回了空内容' : 'AI returned empty content');

      setWizardCourseContent(content);
      addToast(
        lang === 'zh' ? '✨ AI 大纲生成成功' : '✨ AI Outline Generated',
        lang === 'zh'
          ? `已根据《${wizardCourseTitle}》生成 ${content.length} 字的专家级教学大纲。`
          : `Generated a ${content.length}-character outline for "${wizardCourseTitle}".`,
        'success',
      );
    } catch (err: any) {
      console.error(err);
      addToast(
        lang === 'zh' ? 'AI 大纲生成失败' : 'AI Outline Generation Failed',
        err?.message ||
          (lang === 'zh'
            ? '请确认「系统管理 -> AI 提供商管理」中已配置可用的模型服务。'
            : 'Please configure a working AI Provider in System Management.'),
        'error',
      );
    } finally {
      setWizardIsGeneratingOutline(false);
    }
  };

  const handleDeployWizardCourse = async () => {
    if (!wizardCourseTitle.trim()) {
      alert(lang === 'zh' ? '请输入课程标题！' : 'Please provide a course title!');
      return;
    }
    setWizardIsSubmitting(true);
    try {
      const displayContent =
        wizardCourseContent.trim() || `Course outline for ${wizardCourseTitle} (${wizardCourseCategory})`;
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
        setWizardCourseTimeline(getDefaultWizardTimeline(lang));
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
    wizardIsGeneratingOutline,
    handleGenerateOutline,
    handleDeployWizardCourse,
  };
}
