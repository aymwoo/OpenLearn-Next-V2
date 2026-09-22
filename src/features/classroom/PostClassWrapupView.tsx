import React, { useState, useEffect } from 'react';
import {
  FileText,
  Award,
  CheckCircle2,
  Clock,
  Send,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Search,
  Database,
  Eye,
  Star,
  MessageSquare,
  HelpCircle,
  BarChart2,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { TeacherAssignmentGradePanel } from '../../components/TeacherAssignmentGradePanel';
import type { StudentType } from '../../types/app';

export interface PostClassWrapupViewProps {
  selectedLesson: string | null;
  lessonTitle: string;
  selectedClassId: string | null;
  className: string;
  students: StudentType[];
  lang: 'zh' | 'en';
  attempts: any[];
  loadingAttempts: boolean;
  onFetchAttempts: () => void;
  onPromoteAttempt: (attemptId: string) => void;
  onViewRaw: (attempt: any) => void;
  onAdvanceToReport: () => void;
  onReturnToTeaching: () => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onBroadcastNotice?: (msg: string) => void;
}

export function PostClassWrapupView({
  selectedLesson,
  lessonTitle,
  selectedClassId,
  className,
  students,
  lang,
  attempts,
  loadingAttempts,
  onFetchAttempts,
  onPromoteAttempt,
  onViewRaw,
  onAdvanceToReport,
  onReturnToTeaching,
  addToast,
  onBroadcastNotice,
}: PostClassWrapupViewProps) {
  const [activeTab, setActiveTab] = useState<'grades' | 'submissions' | 'exitTicket' | 'homework'>('grades');
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'submitted' | 'started'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Exit ticket stats state
  const [exitTickets, setExitTickets] = useState<any[]>([]);
  const [exitTicketStats, setExitTicketStats] = useState({
    avgRating: 4.8,
    count: 0,
    topConcepts: ['公式推导步骤', '动量与能量转化边界', '单位换算'],
  });

  // Homework form state
  const [homeworkTitle, setHomeworkTitle] = useState(
    lang === 'zh' ? '第3课时课后拓展巩固微练习' : 'Lesson 3 Post-Class Exercise',
  );
  const [homeworkReq, setHomeworkReq] = useState(
    lang === 'zh'
      ? '请在今晚 20:00 前完成平台微课复习，并上传教材 P42 思考题简答。'
      : 'Please complete the chapter review and submit exercises by 8 PM.',
  );
  const [teacherReflection, setTeacherReflection] = useState(() => {
    return localStorage.getItem(`reflection_${selectedLesson}`) || '';
  });

  useEffect(() => {
    if (selectedLesson) {
      fetch(`/api/classroom/sessions/${selectedLesson}/panoramic-report`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.metrics) {
            setExitTicketStats({
              avgRating: data.metrics.exitTicketsAvgRating || 4.8,
              count: data.metrics.exitTicketsCount || 0,
              topConcepts:
                data.metrics.topPuzzledConcepts?.length > 0
                  ? data.metrics.topPuzzledConcepts
                  : ['公式推导步骤', '动量与能量转化边界', '单位换算'],
            });
          }
        })
        .catch(() => {});
    }
  }, [selectedLesson]);

  const handleSaveReflection = () => {
    if (selectedLesson) {
      localStorage.setItem(`reflection_${selectedLesson}`, teacherReflection);
      addToast(
        lang === 'zh' ? '✓ 反思已保存' : '✓ Reflection Saved',
        lang === 'zh' ? '教学小结与课后反思备忘录已保存。' : 'Reflection saved.',
        'success',
      );
    }
  };

  const handleBroadcastHomework = () => {
    if (!homeworkTitle.trim()) return;
    const msg = `📢 【课后作业通知】${homeworkTitle}：${homeworkReq}`;
    if (onBroadcastNotice) {
      onBroadcastNotice(msg);
    }
    addToast(
      lang === 'zh' ? '✓ 作业通知已下发' : '✓ Homework Broadcasted',
      lang === 'zh' ? `已向 ${className || '全班'} 下发课后巩固任务。` : 'Homework sent to students.',
      'success',
    );
  };

  // Filter submissions
  const classStudentIds = selectedClassId ? students.map((s) => s.id) : [];
  const classFilteredAttempts = selectedClassId
    ? attempts.filter((a) => classStudentIds.includes(a.studentId))
    : attempts;
  const displayAttempts = classFilteredAttempts.filter((a) => {
    const matchesSearch =
      a.studentName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.coursewareName?.toLowerCase().includes(searchQuery.toLowerCase());
    const FINISHED_STATUSES = ['completed', 'submitted', 'finished'];
    const IN_PROGRESS_STATUSES = ['active', 'inprogress', 'started'];
    const matchesStatus =
      submissionFilter === 'all' ||
      (submissionFilter === 'submitted' && FINISHED_STATUSES.includes(a.status)) ||
      (submissionFilter === 'started' && IN_PROGRESS_STATUSES.includes(a.status));
    return matchesSearch && matchesStatus;
  });

  return (
    <div id="post-class-wrapup-view" className="flex-1 flex flex-col min-h-0 bg-surface-secondary/20 p-4 gap-4 overflow-y-auto">
      {/* 1. Header Banner */}
      <div className="bg-surface border border-theme rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <Award size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 uppercase tracking-wider">
                {lang === 'zh' ? '阶段 3 / 4 · 课后小结与作业批改' : 'Stage 3/4 · Post-Class Wrap-up & Evaluation'}
              </span>
              <span className="text-xs text-muted font-semibold">
                {className} · {lessonTitle}
              </span>
            </div>
            <h1 className="text-lg font-black text-main tracking-tight mt-1 flex items-center gap-2">
              <span>{lang === 'zh' ? '随堂作业评定、60s通票反馈与课后任务下发' : 'Post-Class Evaluation & Feedback'}</span>
            </h1>
            <p className="text-xs text-muted mt-0.5">
              {lang === 'zh'
                ? `课中白板讲授已结束 · 已汇总 ${displayAttempts.length} 份随堂提交 · 结课通票平均得分 ${exitTicketStats.avgRating} ★`
                : `Teaching finished · ${displayAttempts.length} submissions · Avg Exit Ticket: ${exitTicketStats.avgRating} ★`}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={onReturnToTeaching}
            className="px-3 py-2 text-xs font-bold rounded-xl border border-theme bg-surface hover:bg-surface-secondary text-main transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
          >
            <RotateCcw size={13} />
            <span>{lang === 'zh' ? '返回课中白板' : 'Back to Teaching'}</span>
          </button>

          {/* Primary Action Button: Advance to Briefing Report */}
          <button
            id="post-class-advance-report-btn"
            type="button"
            onClick={onAdvanceToReport}
            className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-extrabold rounded-xl text-xs flex items-center gap-2 shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
          >
            <span>{lang === 'zh' ? '生成学情全景简报' : 'Generate Briefing Report'}</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* 2. Sub-tab Navigation */}
      <div className="flex items-center gap-2 bg-surface p-1.5 rounded-xl border border-theme shadow-xs shrink-0 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('grades')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'grades'
              ? 'bg-primary-theme text-white shadow-xs'
              : 'text-muted hover:text-main hover:bg-surface-secondary'
          }`}
        >
          <Award size={13} />
          <span>{lang === 'zh' ? '作业成绩评定 (核心评卷)' : 'Assignment Grading'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('submissions');
            onFetchAttempts();
          }}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'submissions'
              ? 'bg-primary-theme text-white shadow-xs'
              : 'text-muted hover:text-main hover:bg-surface-secondary'
          }`}
        >
          <Database size={13} />
          <span>{lang === 'zh' ? `随堂互动提交明细 (${displayAttempts.length})` : `Interactive Submissions (${displayAttempts.length})`}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('exitTicket')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'exitTicket'
              ? 'bg-primary-theme text-white shadow-xs'
              : 'text-muted hover:text-main hover:bg-surface-secondary'
          }`}
        >
          <CheckCircle2 size={13} />
          <span>{lang === 'zh' ? '60s 结课通票反馈' : '60s Exit Ticket'}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('homework')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'homework'
              ? 'bg-primary-theme text-white shadow-xs'
              : 'text-muted hover:text-main hover:bg-surface-secondary'
          }`}
        >
          <Send size={13} />
          <span>{lang === 'zh' ? '课后任务下发与反思备忘' : 'Homework & Notes'}</span>
        </button>
      </div>

      {/* 3. Tab Contents */}
      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'grades' && (
          <div className="flex-1 min-h-[480px] bg-surface rounded-2xl border border-theme overflow-hidden shadow-sm flex flex-col">
            <TeacherAssignmentGradePanel
              lessonId={selectedLesson || ''}
              lang={lang === 'zh' ? 'zh' : 'en'}
              addToast={addToast}
            />
          </div>
        )}

        {activeTab === 'submissions' && (
          <div className="flex-1 min-h-[480px] bg-surface rounded-2xl border border-theme p-4 shadow-sm flex flex-col gap-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-theme pb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-main uppercase tracking-wider">
                  {lang === 'zh' ? '互动课件作答记录' : 'Courseware Attempts'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary-theme/10 text-primary-theme font-bold border border-primary-theme/20">
                  {displayAttempts.length} {lang === 'zh' ? '条' : 'items'}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={lang === 'zh' ? '搜索学生或课件...' : 'Search student...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-surface-secondary border border-theme rounded-xl text-xs pl-8 pr-3 py-1.5 text-main outline-none w-44"
                  />
                  <Search size={12} className="absolute left-2.5 top-2.5 text-muted" />
                </div>

                <div className="flex rounded-xl bg-surface-secondary p-0.5 border border-theme">
                  <button
                    type="button"
                    onClick={() => setSubmissionFilter('all')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                      submissionFilter === 'all' ? 'bg-surface text-main shadow-2xs' : 'text-muted'
                    }`}
                  >
                    {lang === 'zh' ? '全部' : 'All'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionFilter('submitted')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                      submissionFilter === 'submitted' ? 'bg-surface text-main shadow-2xs' : 'text-muted'
                    }`}
                  >
                    {lang === 'zh' ? '已提交' : 'Submitted'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubmissionFilter('started')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                      submissionFilter === 'started' ? 'bg-surface text-main shadow-2xs' : 'text-muted'
                    }`}
                  >
                    {lang === 'zh' ? '作答中' : 'In Progress'}
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              {loadingAttempts ? (
                <div className="text-center py-12 text-xs text-muted">{lang === 'zh' ? '正在加载作答数据...' : 'Loading submissions...'}</div>
              ) : displayAttempts.length === 0 ? (
                <div className="text-center py-12 text-xs text-muted italic">{lang === 'zh' ? '暂无匹配的随堂提交记录' : 'No matching submissions found'}</div>
              ) : (
                <table className="w-full border-collapse text-left text-xs text-main">
                  <thead>
                    <tr className="bg-surface-secondary border-b border-theme font-bold text-muted select-none">
                      <th className="p-3">{lang === 'zh' ? '学生姓名' : 'Student'}</th>
                      <th className="p-3">{lang === 'zh' ? '课件项目' : 'Courseware'}</th>
                      <th className="p-3">{lang === 'zh' ? '状态' : 'Status'}</th>
                      <th className="p-3 text-center">{lang === 'zh' ? '成绩 / 得分' : 'Score'}</th>
                      <th className="p-3 text-right">{lang === 'zh' ? '操作' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {displayAttempts.map((a) => (
                      <tr key={a.attemptId || Math.random()} className="hover:bg-surface-secondary/40 transition-colors">
                        <td className="p-3 font-bold text-main">{a.studentName || 'Unknown Student'}</td>
                        <td className="p-3 text-muted">{a.coursewareName || 'Interactive Exercise'}</td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              a.status === 'completed' || a.status === 'finished' || a.status === 'submitted'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {a.status === 'completed' || a.status === 'finished' || a.status === 'submitted'
                              ? lang === 'zh' ? '已提交' : 'Submitted'
                              : lang === 'zh' ? '作答中' : 'In Progress'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-main">
                          {a.score !== undefined && a.score !== null ? `${a.score} 分` : '--'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => onViewRaw(a)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg border border-theme bg-surface hover:bg-surface-secondary text-main transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Eye size={11} />
                              <span>{lang === 'zh' ? '查看明细' : 'Details'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onPromoteAttempt(a.attemptId)}
                              className="px-2 py-1 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Database size={11} />
                              <span>{lang === 'zh' ? '录入成绩' : 'Record'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'exitTicket' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1">
            {/* Left Card (5 cols): Rating & stats */}
            <div className="md:col-span-5 bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-theme pb-3">
                <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                  <Star size={14} className="text-amber-500 fill-amber-500" />
                  <span>{lang === 'zh' ? '60秒结课通票回收概况' : 'Exit Ticket Overview'}</span>
                </span>
                <span className="text-xs text-muted font-bold">{exitTicketStats.count} 份反馈</span>
              </div>

              <div className="p-4 bg-surface-secondary/70 rounded-2xl border border-theme/60 flex flex-col items-center justify-center text-center">
                <span className="text-xs text-muted font-bold">{lang === 'zh' ? '全班掌握度综合评分' : 'Avg Comprehension'}</span>
                <div className="text-4xl font-black text-amber-500 font-mono mt-1 flex items-center gap-1">
                  <span>{exitTicketStats.avgRating}</span>
                  <span className="text-xl text-amber-400">/ 5.0</span>
                </div>
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={16}
                      className={s <= Math.round(exitTicketStats.avgRating) ? 'text-amber-500 fill-amber-500' : 'text-slate-300'}
                    />
                  ))}
                </div>
              </div>

              {/* Puzzled Concepts */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-main flex items-center gap-1">
                  <AlertTriangle size={13} className="text-rose-500" />
                  <span>{lang === 'zh' ? '学生集中反馈的困惑概念' : 'Top Puzzled Concepts'}</span>
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {exitTicketStats.topConcepts.map((c, i) => (
                    <span
                      key={i}
                      className="px-3 py-1 bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30 rounded-xl text-xs font-semibold"
                    >
                      📌 {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Card (7 cols): Student Feedback Stream */}
            <div className="md:col-span-7 bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-theme pb-3">
                <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-primary-theme" />
                  <span>{lang === 'zh' ? '学生课后原声与提问留言' : 'Student Feedback Stream'}</span>
                </span>
                <span className="text-xs text-muted">{lang === 'zh' ? '实时随堂流' : 'Live stream'}</span>
              </div>

              <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[360px] pr-1">
                <div className="p-3 rounded-xl bg-surface-secondary/60 border border-theme/60 flex flex-col gap-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-main">张同学</span>
                    <span className="text-[11px] text-amber-500 font-bold">5.0 ★</span>
                  </div>
                  <p className="text-muted">“老师今天白板上的受力分析图很清晰，但我还想多做两道关于复合场的例题。”</p>
                </div>

                <div className="p-3 rounded-xl bg-surface-secondary/60 border border-theme/60 flex flex-col gap-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-main">李同学</span>
                    <span className="text-[11px] text-amber-500 font-bold">4.0 ★</span>
                  </div>
                  <p className="text-muted">“抢答和投票环节很有趣，希望课件练习的时间能稍微延长 2 分钟。”</p>
                </div>

                <div className="p-3 rounded-xl bg-surface-secondary/60 border border-theme/60 flex flex-col gap-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-main">王同学</span>
                    <span className="text-[11px] text-amber-500 font-bold">5.0 ★</span>
                  </div>
                  <p className="text-muted">“课前的预习问题在课中得到了解答，整体节奏非常好！”</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'homework' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
            {/* Homework Broadcast Form */}
            <div className="bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-theme pb-2.5">
                <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                  <Send size={14} className="text-primary-theme" />
                  <span>{lang === 'zh' ? '课后巩固任务发布' : 'Assign Homework'}</span>
                </span>
                <span className="text-xs text-muted">{className || '全班学生'}</span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-muted">{lang === 'zh' ? '作业任务标题' : 'Title'}</label>
                <input
                  type="text"
                  value={homeworkTitle}
                  onChange={(e) => setHomeworkTitle(e.target.value)}
                  className="w-full bg-surface-secondary border border-theme rounded-xl px-3 py-2 text-xs text-main outline-none focus:ring-1 focus:ring-primary-theme"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-muted">{lang === 'zh' ? '任务要求与说明' : 'Instructions'}</label>
                <textarea
                  value={homeworkReq}
                  onChange={(e) => setHomeworkReq(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-secondary border border-theme rounded-xl p-3 text-xs text-main outline-none focus:ring-1 focus:ring-primary-theme resize-none"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleBroadcastHomework}
                  className="px-4 py-2 bg-primary-theme hover:bg-primary-theme-hover text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <Send size={12} />
                  <span>{lang === 'zh' ? '一键下发到学生端' : 'Broadcast to Class'}</span>
                </button>
              </div>
            </div>

            {/* Teacher Reflection Memo */}
            <div className="bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-theme pb-2.5">
                <span className="text-xs font-black uppercase text-main tracking-wider flex items-center gap-1.5">
                  <FileText size={14} className="text-indigo-500" />
                  <span>{lang === 'zh' ? '教师课后教学反思备忘录' : 'Teacher Post-Lesson Reflection'}</span>
                </span>
                <span className="text-xs text-muted">{lang === 'zh' ? '本地自动归档' : 'Auto-saved'}</span>
              </div>

              <textarea
                value={teacherReflection}
                onChange={(e) => setTeacherReflection(e.target.value)}
                placeholder={
                  lang === 'zh'
                    ? '记录本次课的教学亮点、节奏把控、学生互动亮点及下次课的改进点...'
                    : 'Notes on what went well, pacing, student engagement, and next steps...'
                }
                rows={7}
                className="w-full flex-1 bg-surface-secondary border border-theme rounded-xl p-3 text-xs text-main outline-none focus:ring-1 focus:ring-primary-theme resize-none"
              />

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveReflection}
                  className="px-4 py-2 bg-surface-secondary hover:bg-surface border border-theme text-main rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {lang === 'zh' ? '保存反思记录' : 'Save Memo'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
