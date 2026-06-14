import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  X, 
  Calendar, 
  Wand2, 
  BookOpen, 
  Send, 
  Loader2, 
  CheckCircle2, 
  ArrowLeft, 
  Users, 
  FileText, 
  Sparkles,
  Command
} from 'lucide-react';

interface ClassType {
  id: string;
  name: string;
  description: string;
  created_at: number;
}

interface Lesson {
  id: string;
  title: string;
  content: string;
}

interface QuickActionsMenuProps {
  classes: ClassType[];
  lessons: Lesson[];
  lang: 'zh' | 'en';
  onScheduleClass: (classId: string, lessonId: string, date: string) => Promise<boolean>;
  onGenerateAssignment: (classId: string, topic: string) => Promise<boolean>;
  onCreateLesson: (title: string, content: string) => Promise<boolean>;
}

export function QuickActionsMenu({
  classes,
  lessons,
  lang,
  onScheduleClass,
  onGenerateAssignment,
  onCreateLesson
}: QuickActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentView, setCurrentView] = useState<'menu' | 'schedule' | 'assignment' | 'lesson'>('menu');
  
  // Schedule state
  const [scheduleClassId, setScheduleClassId] = useState('');
  const [scheduleLessonId, setScheduleLessonId] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');

  // Assignment state
  const [assignmentClassId, setAssignmentClassId] = useState('');
  const [assignmentTopic, setAssignmentTopic] = useState('');

  // Lesson state
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonContent, setLessonContent] = useState('');

  // Feedback states
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = {
    zh: {
      quickActions: '快捷操作指令',
      quickDesc: '无需切换页面，在此直接向教育总线或班级下发运行调度命令。',
      scheduleClass: '排课计划调度',
      scheduleDesc: '为班级分配课程段并指定授课时间',
      generateAssignment: '生成 AI 测验任务',
      generateDesc: '利用代理模型为班级定制专属能力题目',
      createLesson: '注册教学课件',
      createDesc: '发布新的富文本 Markdown 教材大纲',
      back: '返回上级',
      confirm: '确认并下发指令',
      classSelect: '选择目标班级',
      lessonSelect: '选择关联课件',
      dateSelect: '授课日期选择',
      assignmentTopic: '测验主题方向 / 核心知识点',
      assignmentTopicPlaceholder: '例: 一元二次方程，光合作用，牛顿运动定律等...',
      lessonTitle: '课件名称（大纲标题）',
      lessonTitlePlaceholder: '例: 量子力学初步 / 物理实验基础',
      lessonContent: '详细授课内容 (Markdown 支持)',
      successScheduled: '排课成功！总线已捕获日程数据。',
      successAssignment: 'AI 测验任务成功生成，稍后同步。',
      successLesson: '新课件发布成功！画板白板可直接拖拽加载。',
      emptyClasses: '未检测到活跃班级',
      emptyLessons: '未检测到可用课件',
      loadingBus: '内核微服务运行中...',
      genericError: '网络或核指令总线调用失败，请重试'
    },
    en: {
      quickActions: 'Quick Actions',
      quickDesc: 'Deploy scheduler and class orchestration bus commands instantly from here.',
      scheduleClass: 'Schedule Lesson Period',
      scheduleDesc: 'Assign a lesson package and scheduled date to an active class',
      generateAssignment: 'Generate AI Assignment',
      generateDesc: 'Deploy agent workflows to design tailored student test cases',
      createLesson: 'Register Lesson Curriculum',
      createDesc: 'Publish new rich Markdown-based whiteboard syllabus',
      back: 'Back',
      confirm: 'Execute Command',
      classSelect: 'Select Class',
      lessonSelect: 'Select Lesson Template',
      dateSelect: 'Choose Scheduled Date',
      assignmentTopic: 'Assignment Topic / Target Knowledge',
      assignmentTopicPlaceholder: 'e.g., Quadratic equations, Photosynthesis, Newtonian gravity...',
      lessonTitle: 'Lesson Curriculum Title',
      lessonTitlePlaceholder: 'e.g., Intro to Quantum Mechanics',
      lessonContent: 'Whiteboard Curriculum Content (Markdown)',
      successScheduled: 'Success! Dynamic class schedule updated.',
      successAssignment: 'Success! AI is compiling custom quiz structures.',
      successLesson: 'Success! Ready to orchestrate inside classroom sandbox.',
      emptyClasses: 'No classes discovered',
      emptyLessons: 'No lessons discovered',
      loadingBus: 'Interfacing core services...',
      genericError: 'System bus execute command failure, please retry'
    }
  }[lang];

  const resetForm = () => {
    setScheduleClassId('');
    setScheduleLessonId('');
    setScheduleDate('');
    setAssignmentClassId('');
    setAssignmentTopic('');
    setLessonTitle('');
    setLessonContent('');
    setError(null);
    setSuccess(false);
    setLoading(false);
  };

  const currentSuccessMsg = () => {
    switch(currentView) {
      case 'schedule': return t.successScheduled;
      case 'assignment': return t.successAssignment;
      case 'lesson': return t.successLesson;
      default: return '';
    }
  };

  const handleActionClick = (view: 'schedule' | 'assignment' | 'lesson') => {
    resetForm();
    setCurrentView(view);
    
    // Auto populate state defaults where possible
    if (classes.length > 0) {
      setScheduleClassId(classes[0].id);
      setAssignmentClassId(classes[0].id);
    }
    if (lessons.length > 0) {
      setScheduleLessonId(lessons[0].id);
    }
    if (view === 'lesson') {
      setLessonContent(`# 新课件名称\n\n## 教学目标\n- 掌握核心考点\n- 熟练完成基础物理实验\n\n## 课堂探究\n这里写课本的主要讲授要点。`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let isOk = false;
      if (currentView === 'schedule') {
        if (!scheduleClassId || !scheduleLessonId || !scheduleDate) {
          setError('Please complete all form fields.');
          setLoading(false);
          return;
        }
        isOk = await onScheduleClass(scheduleClassId, scheduleLessonId, scheduleDate);
      } else if (currentView === 'assignment') {
        if (!assignmentClassId || !assignmentTopic.trim()) {
          setError('Please specify target class and a valid topic.');
          setLoading(false);
          return;
        }
        isOk = await onGenerateAssignment(assignmentClassId, assignmentTopic.trim());
      } else if (currentView === 'lesson') {
        if (!lessonTitle.trim() || !lessonContent.trim()) {
          setError('Title and Content can not be empty.');
          setLoading(false);
          return;
        }
        isOk = await onCreateLesson(lessonTitle.trim(), lessonContent.trim());
      }

      if (isOk) {
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          setCurrentView('menu');
        }, 2200);
      } else {
        setError(t.genericError);
      }
    } catch (err: any) {
      setError(err.message || t.genericError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="quick-actions-fab-container" className="absolute bottom-8 right-8 z-40 flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="mb-4 w-[360px] sm:w-[420px] bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden flex flex-col focus:outline-none"
            id="quick-actions-popup-card"
          >
            {/* Header */}
            <div className="bg-indigo-600 px-5 py-4 text-white flex items-center justify-between shadow-inner">
              <div className="flex items-center gap-2">
                <Command size={18} className="animate-pulse" />
                <h3 className="font-bold text-sm tracking-wide">{t.quickActions}</h3>
              </div>
              <button 
                onClick={() => { setIsOpen(false); setCurrentView('menu'); }}
                className="text-white/80 hover:text-white hover:bg-white/15 p-1 rounded-full transition-all focus:outline-none"
                title="Close Portal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Content Area */}
            <div className="p-5 max-h-[480px] overflow-y-auto bg-gray-50/50">
              {currentView === 'menu' && (
                <div className="space-y-4">
                  <p className="text-[11px] text-gray-500 leading-relaxed font-medium bg-indigo-50/50 border border-indigo-100 p-2.5 rounded-lg mb-4">
                    {t.quickDesc}
                  </p>
                  
                  {/* Action 1: Schedule Class */}
                  <div 
                    onClick={() => handleActionClick('schedule')}
                    className="flex items-start gap-3.5 p-3.5 bg-white border border-gray-200 hover:border-indigo-400 hover:shadow-md rounded-xl cursor-pointer transition-all hover:scale-101 group"
                    id="action-schedule-class"
                  >
                    <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-200">
                      <Calendar size={18} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1 group-hover:text-indigo-600 transition-colors uppercase tracking-wider">{t.scheduleClass}</h4>
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.scheduleDesc}</p>
                    </div>
                  </div>

                  {/* Action 2: Generate Assignment / Quiz */}
                  <div 
                    onClick={() => handleActionClick('assignment')}
                    className="flex items-start gap-3.5 p-3.5 bg-white border border-gray-200 hover:border-purple-400 hover:shadow-md rounded-xl cursor-pointer transition-all hover:scale-101 group"
                    id="action-generate-assignment"
                  >
                    <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg group-hover:bg-purple-600 group-hover:text-white transition-colors duration-200">
                      <Wand2 size={18} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1 group-hover:text-purple-600 transition-colors uppercase tracking-wider">{t.generateAssignment}</h4>
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.generateDesc}</p>
                    </div>
                  </div>

                  {/* Action 3: Create Lesson Curriculum */}
                  <div 
                    onClick={() => handleActionClick('lesson')}
                    className="flex items-start gap-3.5 p-3.5 bg-white border border-gray-200 hover:border-emerald-400 hover:shadow-md rounded-xl cursor-pointer transition-all hover:scale-101 group"
                    id="action-create-lesson"
                  >
                    <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-200">
                      <BookOpen size={18} />
                    </div>
                    <div className="flex-1">
                      <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1 group-hover:text-emerald-600 transition-colors uppercase tracking-wider">{t.createLesson}</h4>
                      <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{t.createDesc}</p>
                    </div>
                  </div>
                </div>
              )}

              {currentView !== 'menu' && (
                <div className="relative">
                  {/* Back button */}
                  <button 
                    onClick={() => setCurrentView('menu')}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-indigo-600 font-semibold mb-4 cursor-pointer focus:outline-none"
                    id="action-back-button"
                  >
                    <ArrowLeft size={14} />
                    <span>{t.back}</span>
                  </button>

                  {success ? (
                    <motion.div 
                      initial={{ scale: 0.95 }}
                      animate={{ scale: 1 }}
                      className="flex flex-col items-center justify-center py-10 text-center"
                    >
                      <CheckCircle2 size={48} className="text-green-500 animate-bounce mb-3" />
                      <h4 className="font-bold text-green-800 text-sm">{currentSuccessMsg()}</h4>
                      <p className="text-[11px] text-gray-400 mt-1">Returning to action console...</p>
                    </motion.div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-xs font-semibold">
                          ⚠️ {error}
                        </div>
                      )}

                      {/* WORKSPACE FOR SCHEDULE CLASS */}
                      {currentView === 'schedule' && (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><Users size={12} /> {t.classSelect}</label>
                            {classes.length === 0 ? (
                              <p className="text-xs italic text-red-500">{t.emptyClasses}</p>
                            ) : (
                              <select 
                                value={scheduleClassId} 
                                onChange={e => setScheduleClassId(e.target.value)}
                                className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              >
                                {classes.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><BookOpen size={12} /> {t.lessonSelect}</label>
                            {lessons.length === 0 ? (
                              <p className="text-xs italic text-red-500">{t.emptyLessons}</p>
                            ) : (
                              <select 
                                value={scheduleLessonId} 
                                onChange={e => setScheduleLessonId(e.target.value)}
                                className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              >
                                {lessons.map(l => (
                                  <option key={l.id} value={l.id}>{l.title}</option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><Calendar size={12} /> {t.dateSelect}</label>
                            <input 
                              type="date" 
                              value={scheduleDate} 
                              onChange={e => setScheduleDate(e.target.value)}
                              className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              required
                            />
                          </div>
                        </>
                      )}

                      {/* WORKSPACE FOR GENERATE ASSIGNMENT */}
                      {currentView === 'assignment' && (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><Users size={12} /> {t.classSelect}</label>
                            {classes.length === 0 ? (
                              <p className="text-xs italic text-red-500">{t.emptyClasses}</p>
                            ) : (
                              <select 
                                value={assignmentClassId} 
                                onChange={e => setAssignmentClassId(e.target.value)}
                                className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              >
                                {classes.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><Sparkles size={12} /> {t.assignmentTopic}</label>
                            <input 
                              type="text" 
                              value={assignmentTopic} 
                              onChange={e => setAssignmentTopic(e.target.value)}
                              placeholder={t.assignmentTopicPlaceholder}
                              className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              required
                            />
                          </div>
                        </>
                      )}

                      {/* WORKSPACE FOR CREATE LESSON */}
                      {currentView === 'lesson' && (
                        <>
                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><FileText size={12} /> {t.lessonTitle}</label>
                            <input 
                              type="text" 
                              value={lessonTitle} 
                              onChange={e => setLessonTitle(e.target.value)}
                              placeholder={t.lessonTitlePlaceholder}
                              className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 text-gray-700 font-medium"
                              required
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold text-gray-600 flex items-center gap-1"><BookOpen size={12} /> {t.lessonContent}</label>
                            <textarea 
                              value={lessonContent} 
                              onChange={e => setLessonContent(e.target.value)}
                              rows={5}
                              className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-xs focus:ring-2 focus:ring-indigo-500 font-mono text-gray-700"
                              required
                            />
                          </div>
                        </>
                      )}

                      {/* Submit */}
                      <button 
                        type="submit"
                        disabled={loading || (currentView === 'schedule' && (classes.length === 0 || lessons.length === 0)) || (currentView === 'assignment' && classes.length === 0)}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md active:scale-98 disabled:opacity-50"
                      >
                        {loading ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            <span>{t.loadingBus}</span>
                          </>
                        ) : (
                          <>
                            <Send size={13} />
                            <span>{t.confirm}</span>
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setCurrentView('menu');
        }}
        className={`w-14 h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center shadow-lg hover:shadow-indigo-200 hover:shadow-2xl transition-all duration-250 cursor-pointer active:scale-95 focus:outline-none relative group`}
        title="Trigger Education OS Quick Scheduler Command Panel"
        id="quick-actions-fab-button"
      >
        <span className="absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-20 group-hover:animate-ping"></span>
        <motion.div
          animate={{ rotate: isOpen ? 135 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-center text-white"
        >
          <Plus size={24} strokeWidth={2.8} />
        </motion.div>
      </button>
    </div>
  );
}
