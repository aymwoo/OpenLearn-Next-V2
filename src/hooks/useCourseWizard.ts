import { useEffect, useState } from 'react';
import {
  resolveCourseDeliveryMode,
  xueanActivityTypeForSegment,
  type CourseDeliveryMode,
} from '../../packages/core/plugin-host/course-delivery-mode';
import {
  BUILTIN_MODE_PACKS,
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  BUILTIN_XUEAN_MODE_PACK_ID,
} from '../../packages/core/plugin-host/mode-pack';

/** 课程向导里可选的一种交付模式（内置包 + 已激活插件包）。 */
export interface WizardModePackChoice {
  id: string;
  label: string;
  labelEn?: string;
  source: 'builtin' | 'plugin';
  /** 包认领的环节类型，用于判断是否走学案流程 */
  segmentTypes: string[];
}

const DEFAULT_MODE_PACK_CHOICES: WizardModePackChoice[] = BUILTIN_MODE_PACKS.map((pack) => ({
  id: pack.id,
  label: pack.label,
  labelEn: pack.labelEn,
  source: 'builtin',
  segmentTypes: pack.segmentTypes,
}));

function isXueanLikeChoice(choice: WizardModePackChoice | undefined): boolean {
  if (!choice) return false;
  if (choice.id === BUILTIN_XUEAN_MODE_PACK_ID) return true;
  return choice.segmentTypes.some((type) => type === 'xuean' || type.startsWith('xuean:'));
}

export interface DefaultWizardSegment {
  id: string;
  title: string;
  type: string;
  duration: string;
  color: string;
  notes: string;
}

export function getDefaultXueanTimeline(
  lang: 'zh' | 'en',
  idPrefix: 'seg-w' | 'seg-preset-' = 'seg-w',
): DefaultWizardSegment[] {
  const zh = lang === 'zh';
  return [
    {
      id: `${idPrefix}1`,
      title: zh ? '预习导读' : 'Preview reading',
      type: 'xuean:preview',
      duration: '8m',
      color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
      notes: zh ? '学生先读材料，标出不懂的地方' : 'Students read ahead and mark questions',
    },
    {
      id: `${idPrefix}2`,
      title: zh ? '学案研读' : 'Guided study',
      type: 'xuean',
      duration: '20m',
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
      notes: zh ? '按学案步骤完成任务并提交' : 'Work through the study guide and submit',
    },
    {
      id: `${idPrefix}3`,
      title: zh ? '巩固练习' : 'Practice',
      type: 'xuean:drill',
      duration: '12m',
      color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
      notes: zh ? '用练习检验是否读懂' : 'Check understanding with practice',
    },
  ];
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
  const [wizardDeliveryMode, setWizardDeliveryModeState] = useState<CourseDeliveryMode>('whiteboard');
  const [wizardModePackId, setWizardModePackIdState] = useState<string>(BUILTIN_WHITEBOARD_MODE_PACK_ID);
  const [modePackChoices, setModePackChoices] = useState<WizardModePackChoice[]>(DEFAULT_MODE_PACK_CHOICES);
  const [wizardIsSubmitting, setWizardIsSubmitting] = useState(false);

  // 打开向导时拉取服务端模式包目录：内置包之外，已激活插件贡献的包也会出现。
  // 拉取失败时保留内置选项，向导仍可用。
  useEffect(() => {
    if (!isCourseWizardOpen || typeof fetch !== 'function') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/mode-packs');
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Array<Record<string, unknown>> } | null;
        const rows = Array.isArray(body?.data) ? body.data : [];
        const choices: WizardModePackChoice[] = [];
        for (const row of rows) {
          if (typeof row?.id !== 'string' || typeof row?.label !== 'string') continue;
          choices.push({
            id: row.id,
            label: row.label,
            labelEn: typeof row.labelEn === 'string' ? row.labelEn : undefined,
            source: row.source === 'plugin' ? 'plugin' : 'builtin',
            segmentTypes: Array.isArray(row.segmentTypes)
              ? row.segmentTypes.filter((type): type is string => typeof type === 'string')
              : [],
          });
        }
        if (!cancelled && choices.length > 0) setModePackChoices(choices);
      } catch {
        // 保留内置选项
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCourseWizardOpen]);

  const setWizardDeliveryMode = (mode: CourseDeliveryMode) => {
    const next = resolveCourseDeliveryMode(mode);
    setWizardModePackIdState(next === 'xuean' ? BUILTIN_XUEAN_MODE_PACK_ID : BUILTIN_WHITEBOARD_MODE_PACK_ID);
    setWizardDeliveryModeState(next);
    setWizardCourseTimeline(next === 'xuean' ? getDefaultXueanTimeline(lang) : getDefaultWizardTimeline(lang));
  };

  /** 选择任意模式包（含第三方）：按包认领的环节类型切换默认时间轴。 */
  const selectWizardModePack = (modePackId: string) => {
    const choice = modePackChoices.find((item) => item.id === modePackId);
    const isXuean = isXueanLikeChoice(choice);
    setWizardModePackIdState(modePackId);
    setWizardDeliveryModeState(isXuean ? 'xuean' : 'whiteboard');
    setWizardCourseTimeline(isXuean ? getDefaultXueanTimeline(lang) : getDefaultWizardTimeline(lang));
  };
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
            ? '请确认「系统管理 -> AI 配置」中已配置可用的模型服务。'
            : 'Please configure a working AI Provider in System Management -> AI Config.'),
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
          deliveryMode: wizardDeliveryMode,
          modePackId: wizardModePackId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const newLessonId = data.result?.lessonId;
        const modeBinding = data.result?.modeBinding;
        if (modeBinding?.fallback) {
          addToast(
            lang === 'zh' ? '模式已回落' : 'Mode fell back',
            (lang === 'zh' ? '所选模式包不可用：' : 'Selected mode pack is unavailable: ') +
              (modeBinding.reason || wizardModePackId),
            'warning',
          );
        }
        if (newLessonId) {
          await fetch(`/api/lessons/${newLessonId}/timeline`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline: wizardCourseTimeline }),
          });
          if (wizardDeliveryMode === 'xuean') {
            for (const segment of wizardCourseTimeline) {
              await fetch(`/api/lessons/${newLessonId}/activities`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  type: xueanActivityTypeForSegment(segment?.type),
                  title: segment?.title || (lang === 'zh' ? '学案活动' : 'Study activity'),
                }),
              });
            }
          }
        }
        await fetchLessons();
        if (newLessonId) {
          setSelectedLesson(newLessonId);
          setTeacherTab(wizardDeliveryMode === 'xuean' ? 'xuean_editor' : 'lesson_editor');
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
        setWizardDeliveryModeState('whiteboard');
        setWizardModePackIdState(BUILTIN_WHITEBOARD_MODE_PACK_ID);
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
    wizardDeliveryMode,
    setWizardDeliveryMode,
    wizardModePackId,
    modePackChoices,
    selectWizardModePack,
    wizardIsSubmitting,
    setWizardIsSubmitting,
    wizardIsGeneratingOutline,
    handleGenerateOutline,
    handleDeployWizardCourse,
  };
}
