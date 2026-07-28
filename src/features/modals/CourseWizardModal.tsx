import { Fragment, Dispatch, SetStateAction } from 'react';
import { motion } from 'motion/react';
import Markdown from 'react-markdown';
import {
  BookOpen,
  Sparkles,
  Activity,
  Plus,
  CheckCircle2,
  ChevronRight,
  Database,
  Loader2,
} from 'lucide-react';
import { generateTemplateContent } from '../teacher/HelpView';

export interface WizardSegment {
  id: string;
  title: string;
  type: string;
  duration: string;
  color: string;
  notes: string;
}

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
  addToast: (title: string, message: string, type: 'info' | 'success' | 'warning') => void;
  generateTemplateContent: (title: string, category: string) => string;
  handleDeployWizardCourse: () => void;
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
    generateTemplateContent,
    handleDeployWizardCourse,
  } = props;

  return (
    <>
      {isCourseWizardOpen && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 md:p-6 z-50 overflow-y-auto text-gray-850">
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="bg-white border text-gray-900 border-gray-250 rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden max-h-[92vh] font-sans text-left"
          >
            {/* Wizard Header */}
            <div className="p-4 md:p-5 border-b border-gray-100 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-650">
                  <BookOpen size={20} className="animate-pulse" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-850 text-base md:text-lg">
                    {lang === 'zh' ? '⭐ 互动课程发布与时间轴向导' : '⭐ Course Design Guide & Wizard'}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {lang === 'zh' ? '遵循系统设计法，逐步构建您的学科专属教案与课堂时间轴流程。' : 'Follow best practices to define curriculum content, timeline segments, and deploy.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsCourseWizardOpen(false)}
                className="text-gray-400 hover:text-gray-650 font-bold p-1 rounded-lg hover:bg-gray-150 transition-all text-xl leading-none"
              >
                &times;
              </button>
            </div>

            {/* Steps Navigation Bar */}
            <div className="px-6 py-4.5 border-b border-gray-50 bg-slate-50/50 flex items-center justify-between gap-2 shrink-0 select-none">
              {[
                { step: 1, zh: '1内容选题', en: '1 Background' },
                { step: 2, zh: '2课堂脉络', en: '2 Timeslots' },
                { step: 3, zh: '3编写大纲', en: '3 Syllabus' },
                { step: 4, zh: '4总览部署', en: '4 Deploy' }
              ].map((s, idx) => {
                const isActive = wizardStep === s.step;
                const isCompleted = wizardStep > s.step;
                return (
                  <Fragment key={s.step}>
                    <div 
                      onClick={() => !wizardIsSubmitting && setWizardStep(s.step)}
                      className={`flex items-center gap-2 cursor-pointer transition-all ${
                        isActive 
                          ? 'text-indigo-650 font-boldScale' 
                          : isCompleted 
                            ? 'text-emerald-600 font-medium' 
                            : 'text-gray-400 hover:text-gray-600'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] border ${
                        isActive 
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs font-bold' 
                          : isCompleted
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-600 font-bold'
                            : 'bg-white border-gray-250 text-gray-500'
                      }`}>
                        {isCompleted ? '✓' : s.step}
                      </div>
                      <span className="text-xs font-semibold hidden sm:inline">
                        {lang === 'zh' ? s.zh : s.en}
                      </span>
                    </div>
                    {idx < 3 && (
                      <div className={`flex-1 h-0.5 max-w-[40px] md:max-w-none transition-all ${wizardStep > s.step ? 'bg-emerald-500' : 'bg-gray-200'}`} />
                    )}
                  </Fragment>
                );
              })}
            </div>

            {/* Step Contents */}
            <div className="flex-grow overflow-y-auto p-5 md:p-6 space-y-5">
              
              {/* STEP 1: Basic Information */}
              {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in duration-200 text-left">
                  <div className="bg-indigo-50/70 py-3.5 px-4.5 rounded-xl border border-indigo-100 text-xs text-indigo-750 font-sans leading-relaxed flex items-start gap-2">
                    <Sparkles size={16} className="text-indigo-500 shrink-0 mt-0.5 animate-bounce" />
                    <div>
                      <strong>{lang === 'zh' ? '设计理念：' : 'Instructional ConceptTip:'}</strong>
                      <p className="mt-0.5">
                        {lang === 'zh' 
                          ? '一个高品质的课程往往始于明确的选题背景。选择适当的学科科目分类，系统不仅会按您的选择在后续步骤推荐量身定做的教案摸板，还可以一键预装适合该学科的课堂互动时间轴模板。' 
                          : 'Selecting a clear title and specific subject category helps pre-populate customized Markdown content outlines and specialized scheduling presets.'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-sans">
                    <div className="md:col-span-2 space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '📍 课程/课件名称 *' : '📍 Course Title *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={wizardCourseTitle}
                          onChange={e => setWizardCourseTitle(e.target.value)}
                          placeholder={lang === 'zh' ? '例：西方哲学：康德的三大批判、Python编程入门、高中物理电路并联原理' : 'e.g. Introduction to regressions, Western Philosophies, Lever Principles'}
                          className="w-full px-4 py-3 border border-gray-250 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 text-sm shadow-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '🎯 课程设计简介与要点说明 (Objectives)' : '🎯 Description & Lesson Objectives'}
                        </label>
                        <textarea
                          rows={4}
                          value={wizardCourseDescription}
                          onChange={e => setWizardCourseDescription(e.target.value)}
                          placeholder={lang === 'zh' ? '在此处编写您的授课背景、面向学段及最关键的 2-3 个核心教学总目标。' : 'Write a short description stating learning outcomes and student prerequisite goals.'}
                          className="w-full p-4 border border-gray-255 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-800 text-sm shadow-xs resize-none"
                        />
                      </div>
                    </div>

                    <div className="col-span-1 border-l border-gray-100 md:pl-6 space-y-4 text-left">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {lang === 'zh' ? '🎨 学部科目分类' : '🎨 Subject Category'}
                        </label>
                        <select
                          value={wizardCourseCategory}
                          onChange={e => {
                            setWizardCourseCategory(e.target.value);
                          }}
                          className="w-full bg-white border border-gray-250 text-gray-755 font-bold px-3 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-xs text-sm cursor-pointer"
                        >
                          <option value="Mathematics">{lang === 'zh' ? '📐 基础数学与几何' : '📐 Mathematics'}</option>
                          <option value="ComputerScience">{lang === 'zh' ? '💻 计算机软件与人工智能' : '💻 Computer Science'}</option>
                          <option value="Literature">{lang === 'zh' ? '✍️ 语言文字与阅读理解' : '✍️ Literature & Writing'}</option>
                          <option value="Physics">{lang === 'zh' ? '⚡ 物理实验与自然探索' : '⚡ Physics & Science'}</option>
                          <option value="History">{lang === 'zh' ? '🏛️ 历史脉络与人地分析' : '🏛️ History & Humanities'}</option>
                          <option value="Art">{lang === 'zh' ? '🎨 交互设计与先锋创意艺术' : '🎨 Visual Arts & Design'}</option>
                          <option value="Other">{lang === 'zh' ? '🔮 交叉素养与综合学习' : '🔮 General & Other'}</option>
                        </select>
                      </div>

                      <div className="bg-slate-50 p-4 rounded-xl border border-gray-100 space-y-2 select-none text-left">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">{lang === 'zh' ? '科目时间轴专家建议' : 'SUBJECT HEURISTICS'}</span>
                        <div className="text-xs text-gray-600 leading-relaxed font-sans mt-1">
                          {wizardCourseCategory === 'Mathematics' && (lang === 'zh' ? '💡 数学：偏向理论推演。推荐 20分公式精讲 + 15分黑板实践互动，强化基础。' : '💡 Math recommends: 20m Core Lecture + 15m Practice for theorem grounding.')}
                          {wizardCourseCategory === 'ComputerScience' && (lang === 'zh' ? '💡 计算机：偏重编码体验。推荐 15分白板代码推演 + 20分终端实验与分享。' : '💡 CS recommends: 15m Algorithms + 20m Interactive workshops on virtual boards.')}
                          {wizardCourseCategory === 'Literature' && (lang === 'zh' ? '💡 语文文学：注重文本深度。推荐 10分范文研习 + 20分分组思辨，提升理解。' : '💡 Lit recommends: 10m Reading Analysis + 20m Collaborative Discussions.')}
                          {wizardCourseCategory === 'Physics' && (lang === 'zh' ? '💡 科学类：逻辑导向。推荐 10分虚拟视频实验 + 20分机理讲解 + 10分钟随堂答卷。' : '💡 Science recommends: 10m virtual showcase + 20m principles + 10m evaluation.')}
                          {wizardCourseCategory === 'History' && (lang === 'zh' ? '💡 历史人文：情景引入。推荐 15分人文画卷重塑 + 15分史实论驳辩论。' : '💡 History recommends: 15m Context Mapping + 15m Interactive Debate panels.')}
                          {wizardCourseCategory === 'Art' && (lang === 'zh' ? '💡 视觉创意：自由度高。推荐 10分美术鉴赏 + 25分白板手绘画布互动体验。' : '💡 Art recommends: 10m Aesthetics inspiration + 25m real-time board drawing.')}
                          {wizardCourseCategory === 'Other' && (lang === 'zh' ? '💡 其他科目：均分各小节时间，循序渐进，打造完整的教学循环闭环。' : '💡 Generic: Divide evenly into sequential warm-up, core presentation and quiz.')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Timeline Builder / Presets */}
              {wizardStep === 2 && (
                <div className="space-y-5 animate-in fade-in duration-200 text-left font-sans">
                  <div className="bg-emerald-50/40 py-3.5 px-4.5 rounded-xl border border-emerald-100 text-xs text-emerald-850 leading-relaxed flex items-start gap-2 text-left">
                    <Activity size={16} className="text-emerald-555 shrink-0 mt-0.5 animate-pulse" />
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
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      {lang === 'zh' ? '💡 点击应用典型课堂框架模板 (Quick Apply)' : '💡 Click to Auto-Apply Structure Presets'}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {[
                        {
                          id: 'preset_standard',
                          title: lang === 'zh' ? '经典 5-20-15-5 讲授模式' : 'Traditional Dual-Lecture Paradigm',
                          desc: lang === 'zh' ? '由浅入深：先通过场景导入，后精讲，接着在白板配合大屏进行演练。' : 'Perfect dynamic for most standard classes.',
                          segments: [
                            { id: 'seg-preset-1', title: 'Course Orientation / 课堂导入', type: 'intro', duration: '5m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Warm up topic' },
                            { id: 'seg-preset-2', title: 'Subject Core Lecture / 核心理论精讲', type: 'lecture', duration: '20m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Main content slide' },
                            { id: 'seg-preset-3', title: 'Interactive Lab Work / 随堂协同演练', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Exercises & questions' },
                            { id: 'seg-preset-4', title: 'Wrap up / 课堂成果总结与答疑', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Check answer notes' }
                          ]
                        },
                        {
                          id: 'preset_seminar',
                          title: lang === 'zh' ? '主题讨论工作坊模式' : 'Active Discussion Workshop',
                          desc: lang === 'zh' ? '协同探究：教师5分钟破冰，学生15分钟小组演练，15分钟对决汇报，10分钟定级。' : 'Discussion and presentation heavy layout.',
                          segments: [
                            { id: 'seg-preset-5', title: 'Debate Scenario Brief / 讨论情境简述', type: 'intro', duration: '5m', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100', notes: 'Define debate metrics' },
                            { id: 'seg-preset-6', title: 'Cooperative Ideation / 精英白板协作设计', type: 'practice', duration: '15m', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100', notes: 'Joint workspace analysis' },
                            { id: 'seg-preset-7', title: 'Student Team Presentation / 各小组交互汇报', type: 'lecture', duration: '15m', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100', notes: 'Group screen sharing' },
                            { id: 'seg-preset-8', title: 'Review & Grade Feedback / 教师深度对标点评', type: 'summary', duration: '10m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Score reviews' }
                          ]
                        },
                        {
                          id: 'preset_flipped',
                          title: lang === 'zh' ? '翻转课堂高强度训练' : 'Targeted Problem-Solving Sprint',
                          desc: lang === 'zh' ? '应试/解惑突破：10分钟温习，15分钟重难盲点攻坚，15分钟专项题演习。' : 'Perfect for exams and targeted training courses.',
                          segments: [
                            { id: 'seg-preset-9', title: 'Blind Spot Evaluation / 温史自学效果自测', type: 'intro', duration: '10m', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100', notes: 'Scan quiz' },
                            { id: 'seg-preset-10', title: 'Advanced Principle Explores / 重难考点极限拆解', type: 'lecture', duration: '15m', color: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100', notes: 'Analyse weak metrics' },
                            { id: 'seg-preset-11', title: 'Mock Solving Battle / 核心精选题实操对抗', type: 'practice', duration: '15m', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', notes: 'Sprint workout' },
                            { id: 'seg-preset-12', title: 'Anchor Recap / 知识网架构网节点固化', type: 'summary', duration: '5m', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100', notes: 'Highlight checklist' }
                          ]
                        }
                      ].map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
                            setWizardCourseTimeline(preset.segments);
                            addToast(
                              lang === 'zh' ? '预设已刷装' : 'Preset Configured',
                              lang === 'zh' ? `已将《${preset.title}》应用到您当前设计的课程中。` : `Assigned "${preset.title}" timeslots.`,
                              'success'
                            );
                          }}
                          className="bg-white border rounded-xl p-3 text-left transition-all hover:bg-indigo-50/20 hover:border-indigo-400 cursor-pointer active:scale-98"
                        >
                          <div className="font-bold text-gray-800 text-xs sm:text-sm">{preset.title}</div>
                          <div className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">{preset.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Customizable Interactive Grid */}
                  <div>
                    <div className="flex items-center justify-between mb-2 select-none">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        {lang === 'zh' ? '📌 流程时间卡编辑 (拖拽或直接对表格字段赋值)' : '📌 Custom Timeslot Table (Edit fields directly)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const newSeg = {
                            id: `seg-w-custom-${Date.now()}`,
                            title: lang === 'zh' ? `自理授课阶段 ${wizardCourseTimeline.length + 1}` : `Interactive Step ${wizardCourseTimeline.length + 1}`,
                            type: 'practice',
                            duration: '10m',
                            color: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                            notes: ''
                          };
                          setWizardCourseTimeline([...wizardCourseTimeline, newSeg]);
                        }}
                        className="flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                      >
                        <Plus size={12} /> {lang === 'zh' ? '增设阶段' : 'Append Phase'}
                      </button>
                    </div>

                    <div className="space-y-2 border border-gray-150 rounded-xl p-3.5 bg-gray-50/50">
                      {wizardCourseTimeline.map((seg, idx) => (
                        <div 
                          key={seg.id} 
                          className="flex flex-col sm:flex-row items-center gap-3 bg-white border border-gray-200 rounded-lg p-2.5 shadow-xs"
                        >
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] text-gray-500 font-bold shrink-0">
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
                              className="font-bold text-xs text-gray-800 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-indigo-500 py-0.5 px-1 focus:outline-none focus:bg-gray-50/50 rounded flex-1 sm:w-56"
                              placeholder="Phase Title"
                            />
                          </div>

                          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end sm:ml-auto">
                            <div className="flex items-center gap-1 bg-slate-50 border border-gray-200 rounded px-2 py-0.5 shrink-0">
                              <span className="text-[10px] font-bold text-gray-400">时长:</span>
                              <input
                                type="text"
                                value={seg.duration}
                                onChange={(e) => {
                                  const updated = [...wizardCourseTimeline];
                                  updated[idx].duration = e.target.value;
                                  setWizardCourseTimeline(updated);
                                }}
                                className="w-8 text-[11px] text-gray-800 font-extrabold bg-transparent text-center focus:outline-none"
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
                              className="bg-slate-50 border border-gray-200 text-[10px] font-bold text-gray-600 rounded p-1 focus:outline-none cursor-pointer"
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
                              className="text-gray-400 hover:text-rose-600 font-bold p-1 cursor-pointer text-sm select-none"
                              title="Delete this segment"
                            >
                              &times;
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 text-[10px] text-right text-gray-500 font-mono select-none">
                      {lang === 'zh' ? '📈 环节累加公式：' : '📈 Dynamic aggregation formula: '} 
                      <span className="text-gray-800 font-semibold">{wizardCourseTimeline.map(s => s.duration).join(' + ')}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Syllabus and materials */}
              {wizardStep === 3 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-200 font-sans text-left">
                  <div className="space-y-3 flex flex-col h-full min-h-[360px] text-left">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider select-none shrink-0">
                        {lang === 'zh' ? '✏️ 使用 Markdown 语法编写课时材料' : '✏️ Lesson Materials (Markdown)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const autofilled = generateTemplateContent(wizardCourseTitle, wizardCourseCategory);
                          setWizardCourseContent(autofilled);
                          addToast(
                            lang === 'zh' ? '大纲模板生成成功' : 'Curriculum Loaded',
                            lang === 'zh' ? '针对所选择的模型和属性已一键刷装教案模板框架。' : 'Prepopulated Markdown structure.',
                            'success'
                          );
                        }}
                        className="flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-100 text-indigo-755 hover:bg-indigo-100 px-3 py-1 rounded-lg transition-colors font-bold cursor-pointer"
                      >
                        <Sparkles size={13} className="text-indigo-500 animate-spin" />
                        {lang === 'zh' ? '✨ 一键生成专家级教学大纲模版' : '✨ Autofill Outline Template'}
                      </button>
                    </div>

                    <textarea
                      rows={14}
                      value={wizardCourseContent}
                      onChange={e => setWizardCourseContent(e.target.value)}
                      placeholder={lang === 'zh' ? '# 西方哲学三大经典原理\n\n在此输入您的具体内容讲解、白板图形绘制节点、以及课后实践任务大纲...' : '# Course curriculum content'}
                      className="w-full flex-grow p-4 bg-slate-900 text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs shadow-inner leading-relaxed text-left"
                    />
                  </div>

                  {/* Material Live Preview */}
                  <div className="space-y-3 flex flex-col h-full border border-gray-150 rounded-xl bg-slate-50/50 p-4 text-left">
                    <span className="block text-xs font-bold text-gray-400 uppercase tracking-wider select-none shrink-0">
                      🖥️ {lang === 'zh' ? '大纲资料实时交互渲染' : 'Syllabus Live Context rendering'}
                    </span>
                    <div className="flex-grow overflow-y-auto bg-white border border-gray-150 rounded-lg p-4 text-xs font-sans text-gray-700 max-h-[380px] overflow-x-hidden text-left select-text">
                      {wizardCourseContent.trim() ? (
                        <div className="markdown-body">
                          <Markdown>{wizardCourseContent}</Markdown>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 italic py-16">
                          <BookOpen size={32} className="mb-2 opacity-20 text-indigo-500" />
                          <span>{lang === 'zh' ? '教案空无内容，等待输入或一键填充模板...' : 'Waiting for materials...'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 4: Success Preview */}
              {wizardStep === 4 && (
                <div className="space-y-6 animate-in fade-in duration-200 text-center font-sans max-w-xl mx-auto py-3">
                  <div className="inline-flex p-3 bg-emerald-50 border border-emerald-100 text-emerald-500 rounded-full">
                    <CheckCircle2 size={36} className="animate-pulse text-emerald-555" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-gray-800 text-base md:text-lg">
                      {lang === 'zh' ? '🚀 互动课程已精心筹备成功！' : '🚀 Materials Generated successfully!'}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">
                      {lang === 'zh' ? '设计与时间轴逻辑全部检验合格。请在下方核验新课卡片，确认无误一键部署入 SQLite 内核数据库。' : 'Curriculum parameters are ready to boot inside the Secure Host.'}
                    </p>
                  </div>

                  {/* Course card preview */}
                  <div className="border border-indigo-200 rounded-2xl p-5 bg-linear-to-b from-indigo-50/20 to-white shadow-md text-left space-y-4">
                    <div className="flex items-center justify-between border-b border-indigo-50 pb-3 gap-2">
                      <div className="font-bold text-indigo-950 text-base sm:text-lg truncate">
                        {wizardCourseTitle || (lang === 'zh' ? '未指定课程主题' : 'Blank Topic')}
                      </div>
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-extrabold bg-indigo-50 text-indigo-800 uppercase tracking-wide border border-indigo-150 shrink-0">
                        {wizardCourseCategory}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-gray-400 block tracking-wider text-[10px] font-bold">{lang === 'zh' ? '教研环节数' : 'TOTAL STEPS'}</span>
                        <span className="text-gray-800 font-extrabold text-sm block mt-1">
                          {wizardCourseTimeline.length} {lang === 'zh' ? '项教学环节' : 'slots'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-400 block tracking-wider text-[10px] font-bold">{lang === 'zh' ? '发布载体引擎' : 'STORAGE MEDIUM'}</span>
                        <div className="flex items-center gap-1 text-emerald-650 font-extrabold text-sm mt-1">
                          <Database size={11} className="text-emerald-500" />
                          <span>SQLite DB</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-gray-150 p-3 rounded-lg text-[11px] text-gray-600 line-clamp-2 italic leading-relaxed text-left">
                      {wizardCourseDescription || (lang === 'zh' ? '无科目描述内容' : 'No description written.')}
                    </div>

                    {/* Progress map view */}
                    <div className="space-y-1.5 select-none">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider block">{lang === 'zh' ? '教学时间轴环流预览' : 'TIMELINE PROGRESS OVERVIEW'}</span>
                      <div className="flex items-center gap-1 w-full overflow-x-auto py-1">
                        {wizardCourseTimeline.map((seg, idx) => (
                          <Fragment key={seg.id}>
                            <div className={`px-2 py-1 text-[10px] font-bold rounded border truncate max-w-[120px] ${seg.color.split(' ')[0]}`}>
                              {seg.title.split(' / ')[0]} ({seg.duration})
                            </div>
                            {idx < wizardCourseTimeline.length - 1 && (
                              <ChevronRight size={11} className="text-gray-300" />
                            )}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Footer controls */}
            <div className="p-4 border-t border-gray-105 bg-slate-50 flex justify-between items-center shrink-0">
              <span className="text-[11px] font-bold font-mono text-gray-400 uppercase select-none">
                {lang === 'zh' ? '⚙️ SQLITE 写入预检通过' : '⚙️ SQLITE VERIFICATION SUCCESS'}
              </span>
              <div className="flex items-center gap-2">
                {wizardStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep(prev => prev - 1)}
                    disabled={wizardIsSubmitting}
                    className="px-4 py-2 text-xs font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors cursor-pointer select-none"
                  >
                    {lang === 'zh' ? '上一步' : 'Back'}
                  </button>
                )}
                {wizardStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (wizardStep === 1 && !wizardCourseTitle.trim()) {
                        alert(lang === 'zh' ? '请输入课程课题名称！' : 'Please type course title to proceed.');
                        return;
                      }
                      setWizardStep(prev => prev + 1);
                    }}
                    className="px-4.5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm flex items-center gap-1 cursor-pointer select-none"
                  >
                    {lang === 'zh' ? '继续前进' : 'Continue'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleDeployWizardCourse}
                    disabled={wizardIsSubmitting}
                    className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50 select-none animate-bounce"
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
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
