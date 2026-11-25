import { Fragment, Dispatch, SetStateAction } from 'react';
import Markdown from 'react-markdown';
import AccessibleDialog, {
  DialogBody,
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/AccessibleDialog';
import { BookOpen, Sparkles, Activity, Plus, CheckCircle2, ChevronRight, Database, Loader2 } from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import {
  getDefaultWizardTimeline,
  getDefaultXueanTimeline,
  type WizardModePackChoice,
} from '../../hooks/useCourseWizard';
import {
  resolveCourseDeliveryMode,
  type CourseDeliveryMode,
} from '../../../packages/core/plugin-host/course-delivery-mode';
import {
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
  BUILTIN_XUEAN_MODE_PACK_ID,
} from '../../../packages/core/plugin-host/mode-pack';

/** 内置模式的中文展示文案；插件包直接使用 manifest 的 label。 */
const BUILTIN_MODE_CHOICE_META: Record<string, { zh: string; en: string; hintZh: string; hintEn: string }> = {
  [BUILTIN_WHITEBOARD_MODE_PACK_ID]: {
    zh: '白板模式',
    en: 'Whiteboard',
    hintZh: '用课堂时间轴和互动白板备课、上课。',
    hintEn: 'Plan and teach with a timeline and the interactive whiteboard.',
  },
  [BUILTIN_XUEAN_MODE_PACK_ID]: {
    zh: '学案模式',
    en: 'Guided study',
    hintZh: '用学案活动组织预习、研读和练习。开课走学案课堂，不必再开全局 Mode Pack。',
    hintEn:
      'Organize preview, study, and practice. Class uses the guided-study flow without a global Mode Pack switch.',
  },
};

const FALLBACK_MODE_CHOICES: WizardModePackChoice[] = [
  {
    id: BUILTIN_WHITEBOARD_MODE_PACK_ID,
    label: '白板模式',
    labelEn: 'Whiteboard',
    source: 'builtin',
    segmentTypes: ['whiteboard'],
  },
  {
    id: BUILTIN_XUEAN_MODE_PACK_ID,
    label: '学案模式',
    labelEn: 'Guided study',
    source: 'builtin',
    segmentTypes: ['xuean'],
  },
];

export interface WizardSegment {
  id: string;
  title: string;
  type: string;
  duration: string;
  color: string;
  notes: string;
}

export const WIZARD_STEP_META: Record<number, { zh: string; en: string }> = {
  1: { zh: '内容选题', en: 'Background' },
  2: { zh: '课堂脉络', en: 'Timeslots' },
  3: { zh: '编写大纲', en: 'Syllabus' },
  4: { zh: '总览部署', en: 'Deploy' },
};

export interface CourseWizardModalProps {
  isCourseWizardOpen: boolean;
  setIsCourseWizardOpen: (v: boolean) => void;
  lang: 'zh' | 'en';
  wizardStep: number;
  setWizardStep: Dispatch<SetStateAction<number>>;
  wizardIsSubmitting: boolean;
  wizardCourseTitle: string;
  setWizardCourseTitle: (v: string) => void;
  wizardCourseDescription: string;
  setWizardCourseDescription: (v: string) => void;
  wizardCourseCategory: string;
  setWizardCourseCategory: (v: string) => void;
  wizardCourseTimeline: WizardSegment[];
  setWizardCourseTimeline: Dispatch<SetStateAction<WizardSegment[]>>;
  wizardCourseContent: string;
  setWizardCourseContent: (v: string) => void;
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  wizardIsGeneratingOutline: boolean;
  handleGenerateOutline: () => Promise<void>;
  handleDeployWizardCourse: () => void;
  wizardDeliveryMode?: CourseDeliveryMode;
  setWizardDeliveryMode?: (mode: CourseDeliveryMode) => void;
  /** 当前选中的模式包 id（内置或插件）。 */
  wizardModePackId?: string;
  /** 可选模式包列表，来自 `/api/mode-packs`。 */
  modePackChoices?: WizardModePackChoice[];
  /** 选择非内置模式包时调用。 */
  selectWizardModePack?: (modePackId: string) => void;
}

export function CourseWizardModal(props: CourseWizardModalProps) {
  const {
    isCourseWizardOpen,
    setIsCourseWizardOpen,
    lang,
    wizardStep,
    setWizardStep,
    wizardIsSubmitting,
    wizardCourseTitle,
    setWizardCourseTitle,
    wizardCourseDescription,
    setWizardCourseDescription,
    wizardCourseCategory,
    setWizardCourseCategory,
    wizardCourseTimeline,
    setWizardCourseTimeline,
    wizardCourseContent,
    setWizardCourseContent,
    addToast,
    wizardIsGeneratingOutline,
    handleGenerateOutline,
    handleDeployWizardCourse,
    wizardDeliveryMode = 'whiteboard',
    setWizardDeliveryMode = () => {},
    wizardModePackId,
    modePackChoices,
    selectWizardModePack = () => {},
  } = props;
  const deliveryMode = resolveCourseDeliveryMode(wizardDeliveryMode);
  // 选中态以模式包 id 为准；旧调用方只传 deliveryMode 时按包 id 反推。
  const activeModePackId =
    wizardModePackId ?? (deliveryMode === 'xuean' ? BUILTIN_XUEAN_MODE_PACK_ID : BUILTIN_WHITEBOARD_MODE_PACK_ID);
  const modeChoices = (modePackChoices && modePackChoices.length > 0 ? modePackChoices : FALLBACK_MODE_CHOICES).map(
    (pack) => {
      const meta = BUILTIN_MODE_CHOICE_META[pack.id];
      const warningZh = pack.warnings?.length ? `（${pack.warnings.join('；')}）` : '';
      const warningEn = pack.warnings?.length ? ` (${pack.warnings.join('; ')})` : '';
      return {
        id: pack.id,
        zh: meta?.zh ?? pack.label,
        en: meta?.en ?? pack.labelEn ?? pack.label,
        hintZh: meta?.hintZh ?? `由插件提供的教学模式。${warningZh}`,
        hintEn: meta?.hintEn ?? `Teaching mode contributed by a plugin.${warningEn}`,
      };
    },
  );
  const handleModeChange = (id: string) => {
    if (id === BUILTIN_WHITEBOARD_MODE_PACK_ID) setWizardDeliveryMode('whiteboard');
    else if (id === BUILTIN_XUEAN_MODE_PACK_ID) setWizardDeliveryMode('xuean');
    else selectWizardModePack(id);
  };
  const xueanWizard = deliveryMode === 'xuean';
  const wizardSteps = xueanWizard
    ? [
        { step: 1, zh: '1学案选题', en: '1 Study topic' },
        { step: 2, zh: '2学案活动', en: '2 Activities' },
        { step: 3, zh: '3学习说明', en: '3 Guide' },
        { step: 4, zh: '4发布学案', en: '4 Publish' },
      ]
    : [
        { step: 1, zh: '1内容选题', en: '1 Background' },
        { step: 2, zh: '2课堂脉络', en: '2 Timeslots' },
        { step: 3, zh: '3编写大纲', en: '3 Syllabus' },
        { step: 4, zh: '4总览部署', en: '4 Deploy' },
      ];

  return (
    <AccessibleDialog
      open={isCourseWizardOpen}
      onClose={() => {
        if (!wizardIsSubmitting) {
          setIsCourseWizardOpen(false);
        }
      }}
      ariaLabelledBy="course-wizard-dialog-title"
      closedBy={wizardIsSubmitting ? 'none' : 'closerequest'}
      className="max-w-4xl overflow-hidden max-h-[92vh]"
    >
      <DialogHeader>
        <DialogTitle
          id="course-wizard-dialog-title"
          icon={<BookOpen size={20} className="animate-pulse" />}
          description={
            lang === 'zh'
              ? '遵循系统设计法，逐步构建您的学科专属教案与课堂时间轴流程。'
              : 'Follow best practices to define curriculum content, timeline segments, and deploy.'
          }
        >
          {xueanWizard
            ? lang === 'zh'
              ? '⭐ 学案课程向导'
              : '⭐ Guided-study course wizard'
            : lang === 'zh'
              ? '⭐ 互动课程发布与时间轴向导'
              : '⭐ Course Design Guide & Wizard'}
        </DialogTitle>
        <DialogCloseButton
          label={lang === 'zh' ? '关闭弹窗' : 'Close dialog'}
          onClick={() => setIsCourseWizardOpen(false)}
        />
      </DialogHeader>

      {/* Steps Navigation Bar */}
      <div className="px-6 py-4.5 border-b border-theme bg-surface-secondary/50 flex items-center justify-between gap-2 shrink-0 select-none">
        {wizardSteps.map((s, idx) => {
          const isActive = wizardStep === s.step;
          const isCompleted = wizardStep > s.step;
          return (
            <Fragment key={s.step}>
              <div
                onClick={() => !wizardIsSubmitting && setWizardStep(s.step)}
                className={`flex items-center gap-2 cursor-pointer transition-all ${
                  isActive
                    ? 'text-primary-ink font-boldScale'
                    : isCompleted
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-subtle hover:text-muted'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-xs border ${
                    isActive
                      ? 'bg-primary-solid border-primary-theme text-white shadow-xs font-bold'
                      : isCompleted
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                        : 'bg-surface border-theme text-muted'
                  }`}
                >
                  {isCompleted ? '✓' : s.step}
                </div>
                <span className="text-xs font-semibold hidden sm:inline">{lang === 'zh' ? s.zh : s.en}</span>
              </div>
              {idx < 3 && (
                <div
                  className={`flex-1 h-0.5 max-w-[40px] md:max-w-none transition-all ${wizardStep > s.step ? 'bg-emerald-500' : 'bg-surface-secondary'}`}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Step Contents */}
      <DialogBody className="space-y-5">
        {/* STEP 1: Basic Information */}
        {wizardStep === 1 && (
          <div className="space-y-4 animate-in fade-in duration-200 text-left">
            <div className="bg-primary-theme-light/70 py-3.5 px-4.5 rounded-xl border border-primary-theme/30 text-xs text-primary-ink font-sans leading-relaxed flex items-start gap-2">
              <Sparkles size={16} className="text-primary-ink shrink-0 mt-0.5 animate-bounce" />
              <div>
                <strong>{lang === 'zh' ? '设计理念：' : 'Instructional ConceptTip:'}</strong>
                <p className="mt-0.5">
                  {lang === 'zh'
                    ? '一个高品质的课程往往始于明确的选题背景。选择适当的学科科目分类，系统不仅会按您的选择在后续步骤推荐量身定做的教案摸板，还可以一键预装适合该学科的课堂互动时间轴模板。'
                    : 'Selecting a clear title and specific subject category helps pre-populate customized Markdown content outlines and specialized scheduling presets.'}
                </p>
              </div>
            </div>

            <fieldset className="border border-theme rounded-xl p-4" data-testid="course-delivery-mode">
              <legend className="px-1 text-xs font-bold text-muted uppercase tracking-wider">
                {lang === 'zh' ? '课程模式' : 'Course mode'}
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {modeChoices.map((choice) => (
                  <label
                    key={choice.id}
                    className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${
                      activeModePackId === choice.id
                        ? 'border-primary-theme bg-primary-theme-light'
                        : 'border-theme bg-surface'
                    }`}
                  >
                    <input
                      type="radio"
                      name="course-delivery-mode"
                      value={choice.id}
                      checked={activeModePackId === choice.id}
                      onChange={() => handleModeChange(choice.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-main">
                        {lang === 'zh' ? choice.zh : choice.en}
                      </span>
                      <span className="block text-xs text-muted mt-1 leading-relaxed">
                        {lang === 'zh' ? choice.hintZh : choice.hintEn}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
              <div className="md:col-span-2 space-y-4">
                <div>
                  <label
                    htmlFor="wizard-course-title"
                    className="block text-xs font-bold text-muted uppercase tracking-wider mb-2"
                  >
                    {lang === 'zh' ? '📍 课程/课件名称 *' : '📍 Course Title *'}
                  </label>
                  <input
                    id="wizard-course-title"
                    name="course_title"
                    type="text"
                    required
                    value={wizardCourseTitle}
                    onChange={(e) => setWizardCourseTitle(e.target.value)}
                    placeholder={
                      lang === 'zh'
                        ? '例：西方哲学：康德的三大批判、Python编程入门、高中物理电路并联原理'
                        : 'e.g. Introduction to regressions, Western Philosophies, Lever Principles'
                    }
                    className="w-full px-4 py-3 border border-theme rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-theme text-main text-sm shadow-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="wizard-course-description"
                    className="block text-xs font-bold text-muted uppercase tracking-wider mb-2"
                  >
                    {lang === 'zh' ? '🎯 课程设计简介与要点说明 (Objectives)' : '🎯 Description & Lesson Objectives'}
                  </label>
                  <textarea
                    id="wizard-course-description"
                    name="course_description"
                    rows={4}
                    value={wizardCourseDescription}
                    onChange={(e) => setWizardCourseDescription(e.target.value)}
                    placeholder={
                      lang === 'zh'
                        ? '在此处编写您的授课背景、面向学段及最关键的 2-3 个核心教学总目标。'
                        : 'Write a short description stating learning outcomes and student prerequisite goals.'
                    }
                    className="w-full p-4 border border-theme rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-theme text-main text-sm shadow-xs field-sizing-auto"
                  />
                </div>
              </div>

              <div className="col-span-1 border-l border-theme md:pl-6 space-y-4 text-left">
                <div>
                  <label
                    htmlFor="wizard-course-category"
                    className="block text-xs font-bold text-muted uppercase tracking-wider mb-2"
                  >
                    {lang === 'zh' ? '🎨 学部科目分类' : '🎨 Subject Category'}
                  </label>
                  <select
                    id="wizard-course-category"
                    name="course_category"
                    value={wizardCourseCategory}
                    onChange={(e) => {
                      setWizardCourseCategory(e.target.value);
                    }}
                    className="w-full bg-surface border border-theme text-main font-bold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-theme shadow-xs text-sm cursor-pointer"
                  >
                    <option value="Mathematics">{lang === 'zh' ? '📐 基础数学与几何' : '📐 Mathematics'}</option>
                    <option value="ComputerScience">
                      {lang === 'zh' ? '💻 计算机软件与人工智能' : '💻 Computer Science'}
                    </option>
                    <option value="Literature">
                      {lang === 'zh' ? '✍️ 语言文字与阅读理解' : '✍️ Literature & Writing'}
                    </option>
                    <option value="Physics">{lang === 'zh' ? '⚡ 物理实验与自然探索' : '⚡ Physics & Science'}</option>
                    <option value="History">
                      {lang === 'zh' ? '🏛️ 历史脉络与人地分析' : '🏛️ History & Humanities'}
                    </option>
                    <option value="Art">
                      {lang === 'zh' ? '🎨 交互设计与先锋创意艺术' : '🎨 Visual Arts & Design'}
                    </option>
                    <option value="Other">{lang === 'zh' ? '🔮 交叉素养与综合学习' : '🔮 General & Other'}</option>
                  </select>
                </div>

                <div className="bg-surface-secondary p-4 rounded-xl border border-theme space-y-2 select-none text-left">
                  <span className="text-xs font-bold text-subtle uppercase tracking-wider block">
                    {lang === 'zh' ? '科目时间轴专家建议' : 'SUBJECT HEURISTICS'}
                  </span>
                  <div className="text-xs text-muted leading-relaxed font-sans mt-1">
                    {wizardCourseCategory === 'Mathematics' &&
                      (lang === 'zh'
                        ? '💡 数学：偏向理论推演。推荐 15分公式精讲 + 20分黑板实践互动 + 5分随堂检测。'
                        : '💡 Math recommends: 15m Core Lecture + 20m Practice + 5m Check.')}
                    {wizardCourseCategory === 'ComputerScience' &&
                      (lang === 'zh'
                        ? '💡 计算机：偏重编码体验。推荐 15分白板代码推演 + 20分终端实验与分享 + 5分演示。'
                        : '💡 CS recommends: 15m Algorithms + 20m Interactive workshops + 5m Demo.')}
                    {wizardCourseCategory === 'Literature' &&
                      (lang === 'zh'
                        ? '💡 语文文学：注重文本深度。推荐 10分范文研习 + 20分分组思辨 + 10分迁移练笔。'
                        : '💡 Lit recommends: 10m Reading Analysis + 20m Collaborative Discussions + 10m Writing.')}
                    {wizardCourseCategory === 'Physics' &&
                      (lang === 'zh'
                        ? '💡 科学类：逻辑导向。推荐 10分虚拟视频实验 + 20分机理讲解 + 10分钟随堂答卷。'
                        : '💡 Science recommends: 10m virtual showcase + 20m principles + 10m evaluation.')}
                    {wizardCourseCategory === 'History' &&
                      (lang === 'zh'
                        ? '💡 历史人文：情景引入。推荐 10分人文画卷重塑 + 20分史实论驳辩论 + 10分钟史料评析。'
                        : '💡 History recommends: 10m Context Mapping + 20m Interactive Debate + 10m Source Analysis.')}
                    {wizardCourseCategory === 'Art' &&
                      (lang === 'zh'
                        ? '💡 视觉创意：自由度高。推荐 10分美术鉴赏 + 25分白板手绘画布互动体验 + 5分互评。'
                        : '💡 Art recommends: 10m Aesthetics + 25m real-time board drawing + 5m Peer Review.')}
                    {wizardCourseCategory === 'Other' &&
                      (lang === 'zh'
                        ? '💡 其他科目：均分各小节时间，循序渐进，打造完整的教学循环闭环。'
                        : '💡 Generic: Divide evenly into sequential warm-up, core presentation and quiz.')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Timeline Builder / Presets（白板） */}
        {wizardStep === 2 && !xueanWizard && (
          <div className="space-y-5 animate-in fade-in duration-200 text-left font-sans">
            <div className="bg-emerald-500/10 py-3.5 px-4.5 rounded-xl border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed flex items-start gap-2 text-left">
              <Activity size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <strong>{lang === 'zh' ? '专家课堂时间轴预设：' : 'Dynamic Class Presets:'}</strong>
                <p className="mt-0.5">
                  {lang === 'zh'
                    ? '好的教授节奏必须动静相宜。以下提供三种国际领先的精品课件时间节点设计，点击即可一键刷装配置。您也可以在下方自由增删和重新指定每个环节的长短！'
                    : 'Curating temporal context maximizes classroom retention. Load from predefined templates or tweak the active steps on the dynamic table.'}
                </p>
              </div>
            </div>

            {/* Template choices */}
            <div>
              <label className="block text-xs font-bold text-muted uppercase tracking-wider mb-2">
                {lang === 'zh'
                  ? '💡 点击应用典型课堂框架模板 (Quick Apply)'
                  : '💡 Click to Auto-Apply Structure Presets'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'preset_standard',
                    title: lang === 'zh' ? '经典 5-15-15-5 讲授模式' : 'Traditional 5-15-15-5 Lecture Paradigm',
                    desc:
                      lang === 'zh'
                        ? '由浅入深：先通过场景导入，后精讲，接着在白板配合大屏进行演练。'
                        : 'Perfect dynamic for most standard classes.',
                    segments: getDefaultWizardTimeline(lang, 'seg-preset-'),
                  },
                  {
                    id: 'preset_seminar',
                    title: lang === 'zh' ? '主题讨论工作坊模式' : 'Active Discussion Workshop',
                    desc:
                      lang === 'zh'
                        ? '协同探究：教师5分钟破冰，学生13分钟小组演练，12分钟对决汇报，10分钟定级。'
                        : 'Discussion and presentation heavy layout.',
                    segments: [
                      {
                        id: 'seg-preset-5',
                        title: lang === 'zh' ? '讨论导入' : 'Debate Scenario Brief',
                        type: 'intro',
                        duration: '5m',
                        color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
                        notes: lang === 'zh' ? '明确议题与分组评价标准' : 'Define debate metrics',
                      },
                      {
                        id: 'seg-preset-6',
                        title: lang === 'zh' ? '小组白板协作' : 'Cooperative Ideation',
                        type: 'practice',
                        duration: '13m',
                        color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
                        notes: lang === 'zh' ? '分组在协作画板上共同探究推导' : 'Joint workspace analysis',
                      },
                      {
                        id: 'seg-preset-7',
                        title: lang === 'zh' ? '小组交流汇报' : 'Student Team Presentation',
                        type: 'lecture',
                        duration: '12m',
                        color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
                        notes: lang === 'zh' ? '各小组代表展示并交流成果' : 'Group screen sharing',
                      },
                      {
                        id: 'seg-preset-8',
                        title: lang === 'zh' ? '点评与反馈' : 'Review & Grade Feedback',
                        type: 'summary',
                        duration: '10m',
                        color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
                        notes: lang === 'zh' ? '教师集中点评并总结评分维度' : 'Score reviews',
                      },
                    ],
                  },
                  {
                    id: 'preset_flipped',
                    title: lang === 'zh' ? '翻转课堂高强度训练' : 'Targeted Problem-Solving Sprint',
                    desc:
                      lang === 'zh'
                        ? '应试/解惑突破：8分钟温习，14分钟重难盲点攻坚，13分钟专项题演习，5分钟固化。'
                        : 'Perfect for exams and targeted training courses.',
                    segments: [
                      {
                        id: 'seg-preset-9',
                        title: lang === 'zh' ? '自学效果自测' : 'Blind Spot Evaluation',
                        type: 'intro',
                        duration: '8m',
                        color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
                        notes: lang === 'zh' ? '快速诊断前置预习薄弱环节' : 'Scan quiz',
                      },
                      {
                        id: 'seg-preset-10',
                        title: lang === 'zh' ? '重难点拆解' : 'Advanced Principle Explores',
                        type: 'lecture',
                        duration: '14m',
                        color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
                        notes: lang === 'zh' ? '聚焦高频错题与难点深度拆解' : 'Analyse weak metrics',
                      },
                      {
                        id: 'seg-preset-11',
                        title: lang === 'zh' ? '核心习题演练' : 'Mock Solving Battle',
                        type: 'practice',
                        duration: '13m',
                        color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
                        notes: lang === 'zh' ? '限时完成专项梯度训练题' : 'Sprint workout',
                      },
                      {
                        id: 'seg-preset-12',
                        title: lang === 'zh' ? '知识梳理总结' : 'Anchor Recap',
                        type: 'summary',
                        duration: '5m',
                        color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
                        notes: lang === 'zh' ? '总结思维导图与易错清单' : 'Highlight checklist',
                      },
                    ],
                  },
                ].map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setWizardCourseTimeline(preset.segments);
                      addToast(
                        lang === 'zh' ? '预设已刷装' : 'Preset Configured',
                        lang === 'zh'
                          ? `已将《${preset.title}》应用到您当前设计的课程中。`
                          : `Assigned "${preset.title}" timeslots.`,
                        'success',
                      );
                    }}
                    className="bg-surface border rounded-xl p-3 text-left transition-all hover:bg-primary-theme-light/20 hover:border-primary-theme cursor-pointer active:scale-98"
                  >
                    <div className="font-bold text-main text-xs sm:text-sm">{preset.title}</div>
                    <div className="text-xs text-subtle mt-1.5 leading-relaxed">{preset.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 插件贡献的课堂框架模板（Quick Apply 扩展槽） */}
            <div className="mt-1">
              <ExtensionPointRenderer
                slot="course.wizard.quick_apply"
                lang={lang}
                slotProps={{
                  lang,
                  wizardCourseTitle,
                  wizardCourseCategory,
                  wizardCourseTimeline,
                  setWizardCourseTimeline,
                  addToast,
                }}
              />
            </div>

            {/* Customizable Interactive Grid */}
            <div>
              <div className="flex items-center justify-between mb-2 select-none">
                <label className="block text-xs font-bold text-muted uppercase tracking-wider">
                  {lang === 'zh'
                    ? '📌 流程时间卡编辑 (拖拽或直接对表格字段赋值)'
                    : '📌 Custom Timeslot Table (Edit fields directly)'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const newSeg = {
                      id: `seg-w-custom-${Date.now()}`,
                      title:
                        lang === 'zh'
                          ? `自理授课阶段 ${wizardCourseTimeline.length + 1}`
                          : `Interactive Step ${wizardCourseTimeline.length + 1}`,
                      type: 'practice',
                      duration: '10m',
                      color: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                      notes: '',
                    };
                    setWizardCourseTimeline([...wizardCourseTimeline, newSeg]);
                  }}
                  className="flex items-center gap-1 text-xs font-bold text-primary-ink hover:text-primary-solid-hover cursor-pointer"
                >
                  <Plus size={12} /> {lang === 'zh' ? '增设阶段' : 'Append Phase'}
                </button>
              </div>

              <div className="space-y-2 border border-theme rounded-xl p-3.5 bg-surface-secondary">
                {wizardCourseTimeline.map((seg, idx) => (
                  <div
                    key={seg.id}
                    className="flex flex-col sm:flex-row items-center gap-3 bg-surface border border-theme rounded-lg p-2.5 shadow-xs"
                  >
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <span className="w-5 h-5 rounded-full bg-surface-secondary flex items-center justify-center text-xs text-muted font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={seg.title}
                        onChange={(e) => {
                          const updated = [...wizardCourseTimeline];
                          updated[idx].title = e.target.value;
                          setWizardCourseTimeline(updated);
                        }}
                        className="font-bold text-xs text-main bg-transparent border-b border-transparent hover:border-theme focus:border-primary-theme py-0.5 px-1 focus:outline-none focus:bg-surface-secondary/50 rounded flex-1 sm:w-56"
                        placeholder="Phase Title"
                      />
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end sm:ml-auto">
                      <div className="flex items-center gap-1 bg-surface-secondary border border-theme rounded px-2 py-0.5 shrink-0">
                        <span className="text-xs font-bold text-subtle">时长:</span>
                        <input
                          type="text"
                          value={seg.duration}
                          onChange={(e) => {
                            const updated = [...wizardCourseTimeline];
                            updated[idx].duration = e.target.value;
                            setWizardCourseTimeline(updated);
                          }}
                          className="w-8 text-xs text-main font-extrabold bg-transparent text-center focus:outline-none"
                        />
                      </div>

                      <select
                        value={seg.type}
                        onChange={(e) => {
                          const val = e.target.value;
                          const updated = [...wizardCourseTimeline];
                          updated[idx].type = val;
                          if (val === 'intro') {
                            updated[idx].color = 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100';
                          } else if (val === 'lecture') {
                            updated[idx].color = 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100';
                          } else if (val === 'practice') {
                            updated[idx].color = 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100';
                          } else if (val === 'summary') {
                            updated[idx].color = 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100';
                          } else {
                            updated[idx].color = 'bg-gray-50 text-gray-700 border-gray-205 hover:bg-gray-100';
                          }
                          setWizardCourseTimeline(updated);
                        }}
                        className="bg-surface-secondary border border-theme text-xs font-bold text-muted rounded p-1 focus:outline-none cursor-pointer"
                      >
                        <option value="intro">{lang === 'zh' ? '温习 / 导入' : 'Warm-up / Intro'}</option>
                        <option value="lecture">{lang === 'zh' ? '主体 / 精讲' : 'Core Lecture'}</option>
                        <option value="practice">{lang === 'zh' ? '交互白板练习' : 'Practice Workshop'}</option>
                        <option value="summary">{lang === 'zh' ? '总结 / 定级' : 'Wrap-up / Recap'}</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (wizardCourseTimeline.length <= 1) {
                            alert(lang === 'zh' ? '请保留至少一个核心环节！' : 'At least one segment must exist.');
                            return;
                          }
                          const updated = wizardCourseTimeline.filter((_, sIdx) => sIdx !== idx);
                          setWizardCourseTimeline(updated);
                        }}
                        className="text-subtle hover:text-rose-600 dark:hover:text-rose-400 font-bold p-1 cursor-pointer text-sm select-none"
                        title="Delete this segment"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-2 text-xs text-right text-muted font-mono select-none">
                {lang === 'zh' ? '📈 环节累加公式：' : '📈 Dynamic aggregation formula: '}
                <span className="text-main font-semibold">
                  {wizardCourseTimeline.map((s) => s.duration).join(' + ')}
                </span>
              </div>
            </div>
          </div>
        )}

        {wizardStep === 2 && xueanWizard && (
          <div className="space-y-5 text-left font-sans" data-testid="xuean-wizard-activities">
            <div className="bg-emerald-500/10 py-3.5 px-4.5 rounded-xl border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
              {lang === 'zh'
                ? '学案按活动推进：预习、研读、练习。这里的环节会写入课程时间轴，并在发布时生成对应学案活动。上课时走学案课堂，而不是白板中栏。'
                : 'Guided study moves through preview, study, and practice. These steps become the timeline and study activities. Class uses the guided-study flow, not the whiteboard column.'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  id: 'xuean-standard',
                  title: lang === 'zh' ? '预习 · 研读 · 练习' : 'Preview, study, practice',
                  segments: getDefaultXueanTimeline(lang, 'seg-preset-'),
                },
                {
                  id: 'xuean-read',
                  title: lang === 'zh' ? '通读学案' : 'Read-through guide',
                  segments: [
                    {
                      id: 'seg-preset-x1',
                      title: lang === 'zh' ? '通读材料' : 'Read the material',
                      type: 'xuean',
                      duration: '25m',
                      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      notes: '',
                    },
                    {
                      id: 'seg-preset-x2',
                      title: lang === 'zh' ? '提交收获' : 'Submit takeaways',
                      type: 'xuean',
                      duration: '15m',
                      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      notes: '',
                    },
                  ],
                },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setWizardCourseTimeline(preset.segments)}
                  className="bg-surface border rounded-xl p-3 text-left hover:border-emerald-400 cursor-pointer"
                >
                  <div className="font-bold text-main text-sm">{preset.title}</div>
                </button>
              ))}
            </div>
            <div className="space-y-2 border border-theme rounded-xl p-3.5 bg-surface-secondary">
              {wizardCourseTimeline.map((seg, idx) => (
                <div
                  key={seg.id}
                  className="flex flex-col sm:flex-row items-center gap-3 bg-surface border rounded-lg p-2.5"
                >
                  <span className="w-5 h-5 rounded-full bg-surface-secondary flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    aria-label={lang === 'zh' ? `学案活动 ${idx + 1} 标题` : `Activity ${idx + 1} title`}
                    value={seg.title}
                    onChange={(e) => {
                      const updated = [...wizardCourseTimeline];
                      updated[idx] = { ...updated[idx], title: e.target.value };
                      setWizardCourseTimeline(updated);
                    }}
                    className="font-bold text-xs text-main bg-transparent border-b border-transparent focus:border-emerald-500 py-0.5 px-1 flex-1"
                  />
                  <select
                    aria-label={lang === 'zh' ? `学案活动 ${idx + 1} 类型` : `Activity ${idx + 1} type`}
                    value={seg.type}
                    onChange={(e) => {
                      const updated = [...wizardCourseTimeline];
                      updated[idx] = { ...updated[idx], type: e.target.value };
                      setWizardCourseTimeline(updated);
                    }}
                    className="bg-surface-secondary border border-theme text-xs font-bold text-muted rounded p-1"
                  >
                    <option value="xuean:preview">{lang === 'zh' ? '预习' : 'Preview'}</option>
                    <option value="xuean">{lang === 'zh' ? '研读' : 'Study'}</option>
                    <option value="xuean:drill">{lang === 'zh' ? '练习' : 'Practice'}</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: Syllabus and materials */}
        {wizardStep === 3 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200 font-sans text-left">
            <div className="space-y-3 flex flex-col h-full min-h-[360px] text-left">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                <label className="block text-xs font-bold text-muted uppercase tracking-wider select-none shrink-0">
                  {lang === 'zh' ? '✏️ 使用 Markdown 语法编写课时材料' : '✏️ Lesson Materials (Markdown)'}
                </label>
                <button
                  type="button"
                  onClick={() => void handleGenerateOutline()}
                  disabled={wizardIsGeneratingOutline}
                  className="flex items-center gap-1 text-xs bg-primary-theme-light border border-primary-theme/30 text-primary-ink hover:bg-primary-theme-light/70 px-3 py-1 rounded-lg transition-colors font-bold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {wizardIsGeneratingOutline ? (
                    <Loader2 size={13} className="text-primary-ink animate-spin" />
                  ) : (
                    <Sparkles size={13} className="text-primary-ink" />
                  )}
                  {wizardIsGeneratingOutline
                    ? lang === 'zh'
                      ? 'AI 正在生成大纲...'
                      : 'AI is writing your outline...'
                    : lang === 'zh'
                      ? '✨ AI 生成专家级教学大纲'
                      : '✨ AI-Generate Syllabus'}
                </button>
              </div>

              <textarea
                rows={14}
                value={wizardCourseContent}
                onChange={(e) => setWizardCourseContent(e.target.value)}
                placeholder={
                  lang === 'zh'
                    ? '# 西方哲学三大经典原理\n\n在此输入您的具体内容讲解、白板图形绘制节点、以及课后实践任务大纲...'
                    : '# Course curriculum content'
                }
                className="w-full flex-grow p-4 bg-slate-900 text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-theme font-mono text-xs shadow-inner leading-relaxed text-left"
              />
            </div>

            {/* Material Live Preview */}
            <div className="space-y-3 flex flex-col h-full border border-theme rounded-xl bg-surface-secondary/50 p-4 text-left">
              <span className="block text-xs font-bold text-subtle uppercase tracking-wider select-none shrink-0">
                🖥️ {lang === 'zh' ? '大纲资料实时交互渲染' : 'Syllabus Live Context rendering'}
              </span>
              <div className="flex-grow overflow-y-auto bg-surface border border-theme rounded-lg p-4 text-xs font-sans text-main max-h-[380px] overflow-x-hidden text-left select-text">
                {wizardCourseContent.trim() ? (
                  <div className="markdown-body">
                    <Markdown>{wizardCourseContent}</Markdown>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-subtle italic py-16">
                    <BookOpen size={32} className="mb-2 opacity-20 text-primary-ink" />
                    <span>
                      {lang === 'zh' ? '教案空无内容，等待输入或一键填充模板...' : 'Waiting for materials...'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: Success Preview */}
        {wizardStep === 4 && (
          <div className="space-y-6 animate-in fade-in duration-200 text-center font-sans max-w-xl mx-auto py-3">
            <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full">
              <CheckCircle2 size={36} className="animate-pulse text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-extrabold text-main text-base md:text-lg">
                {lang === 'zh' ? '🚀 互动课程已精心筹备成功！' : '🚀 Materials Generated successfully!'}
              </h3>
              <p className="text-xs text-subtle mt-1">
                {lang === 'zh'
                  ? '设计与时间轴逻辑全部检验合格。请在下方核验新课卡片，确认无误一键部署入 SQLite 内核数据库。'
                  : 'Curriculum parameters are ready to boot inside the Secure Host.'}
              </p>
            </div>

            {/* Course card preview */}
            <div className="border border-primary-theme/30 rounded-2xl p-5 bg-linear-to-b from-primary-theme-light/20 to-surface shadow-md text-left space-y-4">
              <div className="flex items-center justify-between border-b border-primary-theme/20 pb-3 gap-2">
                <div className="font-bold text-primary-ink text-base sm:text-lg truncate">
                  {wizardCourseTitle || (lang === 'zh' ? '未指定课程主题' : 'Blank Topic')}
                </div>
                <span
                  data-testid="wizard-delivery-mode-badge"
                  className="inline-flex px-2 py-0.5 rounded text-xs font-extrabold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 tracking-wide border border-emerald-500/20 shrink-0"
                >
                  {xueanWizard
                    ? lang === 'zh'
                      ? '学案模式'
                      : 'Guided study'
                    : lang === 'zh'
                      ? '白板模式'
                      : 'Whiteboard'}
                </span>
                <span className="inline-flex px-2 py-0.5 rounded text-xs font-extrabold bg-primary-theme-light text-primary-ink uppercase tracking-wide border border-primary-theme/30 shrink-0">
                  {wizardCourseCategory}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-subtle block tracking-wider text-xs font-bold">
                    {lang === 'zh' ? '教研环节数' : 'TOTAL STEPS'}
                  </span>
                  <span className="text-main font-extrabold text-sm block mt-1">
                    {wizardCourseTimeline.length} {lang === 'zh' ? '项教学环节' : 'slots'}
                  </span>
                </div>
                <div>
                  <span className="text-subtle block tracking-wider text-xs font-bold">
                    {lang === 'zh' ? '发布载体引擎' : 'STORAGE MEDIUM'}
                  </span>
                  <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-extrabold text-sm mt-1">
                    <Database size={11} className="text-emerald-500" />
                    <span>SQLite DB</span>
                  </div>
                </div>
              </div>

              <div className="bg-surface-secondary border border-theme p-3 rounded-lg text-xs text-muted line-clamp-2 italic leading-relaxed text-left">
                {wizardCourseDescription || (lang === 'zh' ? '无科目描述内容' : 'No description written.')}
              </div>

              {/* Progress map view */}
              <div className="space-y-1.5 select-none">
                <span className="text-xs font-extrabold text-subtle uppercase tracking-wider block">
                  {lang === 'zh' ? '教学时间轴环流预览' : 'TIMELINE PROGRESS OVERVIEW'}
                </span>
                <div className="flex items-center gap-1 w-full overflow-x-auto py-1">
                  {wizardCourseTimeline.map((seg, idx) => (
                    <Fragment key={seg.id}>
                      <div
                        className={`px-2 py-1 text-xs font-bold rounded border truncate max-w-[120px] ${seg.color.split(' ')[0]}`}
                      >
                        {seg.title.split(' / ')[0]} ({seg.duration})
                      </div>
                      {idx < wizardCourseTimeline.length - 1 && <ChevronRight size={11} className="text-subtle" />}
                    </Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogBody>

      {/* Footer controls */}
      <DialogFooter className="justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-muted select-none">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-theme-light text-primary-ink font-bold text-[11px] border border-primary-theme/30">
            {wizardStep}
          </span>
          <span>
            {lang === 'zh'
              ? `第 ${wizardStep} 步 / 共 4 步 · ${WIZARD_STEP_META[wizardStep]?.zh || ''}`
              : `Step ${wizardStep} of 4 · ${WIZARD_STEP_META[wizardStep]?.en || ''}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {wizardStep > 1 && (
            <DialogButton
              variant="secondary"
              onClick={() => setWizardStep((prev) => prev - 1)}
              disabled={wizardIsSubmitting}
            >
              {lang === 'zh' ? '上一步' : 'Back'}
            </DialogButton>
          )}
          {wizardStep < 4 ? (
            <DialogButton
              variant="primary"
              onClick={() => {
                if (wizardStep === 1 && !wizardCourseTitle.trim()) {
                  alert(lang === 'zh' ? '请输入课程课题名称！' : 'Please type course title to proceed.');
                  return;
                }
                setWizardStep((prev) => prev + 1);
              }}
            >
              {lang === 'zh' ? '继续前进' : 'Continue'}
            </DialogButton>
          ) : (
            <DialogButton
              variant="primary"
              onClick={handleDeployWizardCourse}
              disabled={wizardIsSubmitting}
              className="animate-bounce"
            >
              {wizardIsSubmitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>{lang === 'zh' ? '写入底库中...' : 'Deploying...'}</span>
                </>
              ) : (
                <>
                  <Database size={13} />
                  <span>{lang === 'zh' ? '部署并激活新课程' : 'Deploy & Activate'}</span>
                </>
              )}
            </DialogButton>
          )}
        </div>
      </DialogFooter>
    </AccessibleDialog>
  );
}
