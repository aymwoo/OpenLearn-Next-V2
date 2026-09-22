import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Radio,
  Bell,
  CheckCircle2,
  FileBarChart2,
  MonitorPlay,
  Play,
  Check,
  RotateCcw,
  Users,
  Activity,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { StageDisplayModal } from './StageDisplayModal';

export interface ClassroomInteractiveCockpitProps {
  lessonId: string | null;
  lessonTitle?: string;
  classId?: string | null;
  lang?: 'zh' | 'en';
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function ClassroomInteractiveCockpit({
  lessonId,
  lessonTitle,
  classId,
  lang = 'zh',
  addToast,
}: ClassroomInteractiveCockpitProps) {
  const [currentStage, setCurrentStage] = useState<string>('IN_CLASS_TEACHING');
  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [isPollDialogOpen, setIsPollDialogOpen] = useState(false);
  const [pollTitle, setPollTitle] = useState('课堂极速单选投票');
  const [pollType, setPollType] = useState<'ABCD' | 'TF'>('ABCD');
  const [activePoll, setActivePoll] = useState<any>(null);
  const [activeBuzzer, setActiveBuzzer] = useState<any>(null);
  const [pacingSignals, setPacingSignals] = useState({ TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 });
  const [panoramicSummary, setPanoramicSummary] = useState<any>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // 轮询课堂阶段与实时数据
  useEffect(() => {
    if (!lessonId) return;

    let mounted = true;
    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/classroom/sessions/${lessonId}`);
        if (res.ok && mounted) {
          const json = await res.json();
          if (json.hasActiveSession && json.stage) {
            setCurrentStage(json.stage);
          }
          setActivePoll(json.activePoll || null);
          setActiveBuzzer(json.activeBuzzer || null);
        }

        const stageRes = await fetch(`/api/classroom/stage/${lessonId}/data`);
        if (stageRes.ok && mounted) {
          const stageJson = await stageRes.json();
          setPacingSignals(stageJson.pacing || { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 });
        }
      } catch (err) {
        // silent
      }
    };

    fetchSession();
    const interval = setInterval(fetchSession, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [lessonId]);

  if (!lessonId) return null;

  // 阶段推进处理
  const handleStageTransition = async (stage: string) => {
    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, classId }),
      });

      if (res.ok) {
        setCurrentStage(stage);
        addToast(
          lang === 'zh' ? '课堂阶段已切换' : 'Classroom Stage Updated',
          lang === 'zh' ? `当前进入阶段：${stage}` : `Current stage: ${stage}`,
          'success',
        );

        if (stage === 'ARCHIVED_REPORT') {
          // 获取全景报告
          const reportRes = await fetch(`/api/classroom/sessions/${lessonId}/panoramic-report`);
          if (reportRes.ok) {
            const reportData = await reportRes.json();
            setPanoramicSummary(reportData);
            setShowSummaryModal(true);
          }
        }
      } else {
        const err = await res.json();
        addToast(
          lang === 'zh' ? '阶段切换被拦截' : 'Stage Transition Blocked',
          err.error || 'Check guards',
          'warning',
        );
      }
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 发起极速投票
  const handleStartQuickPoll = async () => {
    try {
      const options = pollType === 'ABCD' ? ['A', 'B', 'C', 'D'] : ['正确', '错误'];
      const res = await fetch(`/api/classroom/sessions/${lessonId}/quick-poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pollTitle,
          questionType: pollType,
          options,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setActivePoll(json.poll);
        setIsPollDialogOpen(false);
        addToast(
          lang === 'zh' ? '极速投票已启动' : 'Quick Poll Launched',
          lang === 'zh' ? '学生端已弹出作答卡，大屏展台同步更新' : 'Poll active for students',
          'success',
        );
      }
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 结束当前投票
  const handleClosePoll = async () => {
    if (!activePoll) return;
    try {
      await fetch(`/api/classroom/sessions/${lessonId}/quick-poll/${activePoll.id}/close`, {
        method: 'POST',
      });
      setActivePoll(null);
      addToast(
        lang === 'zh' ? '投票已结束' : 'Poll Closed',
        lang === 'zh' ? '已汇总全班作答结果' : 'Results aggregated',
        'info',
      );
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 发起毫秒抢答
  const handleStartBuzzer = async () => {
    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/buzzer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '全班极速抢答' }),
      });

      if (res.ok) {
        const json = await res.json();
        setActiveBuzzer(json.buzzer);
        addToast(
          lang === 'zh' ? '抢答器已激活' : 'Buzzer Ready',
          lang === 'zh' ? '学生端已出现红色抢答按钮' : 'Students can buzz now',
          'success',
        );
      }
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 重置抢答器
  const handleResetBuzzer = async () => {
    if (!activeBuzzer) return;
    try {
      await fetch(`/api/classroom/sessions/${lessonId}/buzzer/${activeBuzzer.id}/reset`, {
        method: 'POST',
      });
      setActiveBuzzer((prev: any) => (prev ? { ...prev, status: 'READY', winner_student_id: null } : null));
      addToast(lang === 'zh' ? '抢答已重置' : 'Buzzer Reset', '', 'info');
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  const stages = [
    { id: 'PRE_CLASS_READY', labelZh: '课前就绪', labelEn: 'Pre-Class' },
    { id: 'IN_CLASS_TEACHING', labelZh: '课中授课', labelEn: 'Teaching' },
    { id: 'WRAP_UP_EXIT_TICKET', labelZh: '结课通票', labelEn: 'Exit Ticket' },
    { id: 'ARCHIVED_REPORT', labelZh: '学情简报', labelEn: 'Report' },
  ];

  return (
    <div
      id="classroom-interactive-cockpit"
      className="bg-surface border-b border-border/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 select-none text-xs transition-colors"
    >
      {/* 阶段控制导航 (Stepper) */}
      <div className="flex items-center gap-1.5 bg-surface-secondary/70 p-1 rounded-xl border border-border/60 shadow-3xs">
        {stages.map((st, idx) => {
          const isActive = currentStage === st.id;
          return (
            <button
              key={st.id}
              onClick={() => handleStageTransition(st.id)}
              className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                isActive
                  ? 'bg-primary-theme text-white shadow-sm ring-2 ring-primary-theme/20'
                  : 'text-muted hover:text-foreground hover:bg-surface'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">
                {idx + 1}
              </span>
              <span>{lang === 'zh' ? st.labelZh : st.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* 中部快捷互动栏 */}
      <div className="flex items-center gap-2">
        {/* 口播单选投票 */}
        {activePoll && activePoll.status === 'ACTIVE' ? (
          <button
            onClick={handleClosePoll}
            className="px-3 py-1.5 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer animate-pulse"
          >
            <CheckCircle2 size={13} />
            <span>
              {lang === 'zh' ? `结束投票 (${activePoll.totalVotes || 0}人)` : `Close Poll (${activePoll.totalVotes || 0})`}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setIsPollDialogOpen(true)}
            className="px-3 py-1.5 bg-surface-secondary hover:bg-surface border border-border/80 text-foreground font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          >
            <Sparkles size={13} className="text-amber-500" />
            <span>{lang === 'zh' ? '极速投票' : 'Quick Poll'}</span>
          </button>
        )}

        {/* 毫秒抢答器 */}
        {activeBuzzer ? (
          <button
            onClick={handleResetBuzzer}
            className="px-3 py-1.5 bg-rose-500 text-white font-bold rounded-lg hover:bg-rose-600 transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>{lang === 'zh' ? '重置抢答' : 'Reset Buzzer'}</span>
          </button>
        ) : (
          <button
            onClick={handleStartBuzzer}
            className="px-3 py-1.5 bg-surface-secondary hover:bg-surface border border-border/80 text-foreground font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          >
            <Bell size={13} className="text-rose-500" />
            <span>{lang === 'zh' ? '发起抢答' : 'Start Buzzer'}</span>
          </button>
        )}

        {/* 结课通票快捷按钮 */}
        <button
          onClick={() => handleStageTransition('WRAP_UP_EXIT_TICKET')}
          className="px-3 py-1.5 bg-surface-secondary hover:bg-surface border border-border/80 text-foreground font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          title="发起 60 秒下课通票"
        >
          <CheckCircle2 size={13} className="text-indigo-500" />
          <span>{lang === 'zh' ? '60s 通票' : 'Exit Ticket'}</span>
        </button>

        {/* 大屏展台模式 */}
        <button
          onClick={() => setIsStageModalOpen(true)}
          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
        >
          <MonitorPlay size={13} className="text-blue-500" />
          <span>{lang === 'zh' ? '打开大屏展台' : 'Stage Display'}</span>
        </button>

        {/* 扩展卡槽：第三方插件注册自定义快捷互动 */}
        <ExtensionPointRenderer
          slot="classroom.quick_activity"
          slotProps={{
            lessonId,
            classId,
            stage: currentStage,
          }}
        />
      </div>

      {/* 右侧：节奏晴雨表指示器 */}
      <div className="flex items-center gap-2 pl-2 border-l border-border/60">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-muted">
          <TrendingUp size={12} className="text-primary-theme" />
          <span>{lang === 'zh' ? '节奏晴雨表:' : 'Barometer:'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]"
            title="听懂了 / 节奏适宜"
          >
            💡 {pacingSignals.CLEAR || 0}
          </span>
          <span
            className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-[10px]"
            title="有些困惑"
          >
            ❓ {pacingSignals.CONFUSED || 0}
          </span>
          <span
            className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-[10px]"
            title="讲太快了"
          >
            🐇 {pacingSignals.TOO_FAST || 0}
          </span>
        </div>
      </div>

      {/* 大屏展台模态框 */}
      <StageDisplayModal
        isOpen={isStageModalOpen}
        onClose={() => setIsStageModalOpen(false)}
        lessonId={lessonId}
        lessonTitle={lessonTitle}
        lang={lang}
      />

      {/* 极速出题配置对话框 */}
      {isPollDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-sm shadow-xl flex flex-col gap-4">
            <h3 className="font-bold text-base text-foreground flex items-center gap-2">
              <Sparkles size={18} className="text-amber-500" />
              <span>{lang === 'zh' ? '发起口播极速单选' : 'Launch Quick Poll'}</span>
            </h3>

            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted text-xs">
                {lang === 'zh' ? '投票标题 / 提示语' : 'Poll Title'}
              </label>
              <input
                type="text"
                value={pollTitle}
                onChange={(e) => setPollTitle(e.target.value)}
                className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-theme"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted text-xs">
                {lang === 'zh' ? '题型选择' : 'Question Type'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPollType('ABCD')}
                  className={`p-2.5 rounded-lg border font-bold text-center transition-colors cursor-pointer ${
                    pollType === 'ABCD'
                      ? 'border-primary-theme bg-primary-theme/10 text-primary-theme'
                      : 'border-border bg-surface-secondary text-muted'
                  }`}
                >
                  ABCD 四选一
                </button>
                <button
                  type="button"
                  onClick={() => setPollType('TF')}
                  className={`p-2.5 rounded-lg border font-bold text-center transition-colors cursor-pointer ${
                    pollType === 'TF'
                      ? 'border-primary-theme bg-primary-theme/10 text-primary-theme'
                      : 'border-border bg-surface-secondary text-muted'
                  }`}
                >
                  正确 / 错误
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPollDialogOpen(false)}
                className="px-4 py-2 rounded-lg text-muted hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleStartQuickPoll}
                className="px-4 py-2 bg-primary-theme text-white font-bold rounded-lg hover:bg-primary-theme-hover transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '立即发布' : 'Launch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全景学情简报弹窗 */}
      {showSummaryModal && panoramicSummary && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-3xl border border-border p-8 w-full max-w-2xl shadow-2xl flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border/80 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary-theme/10 text-primary-theme rounded-2xl">
                  <FileBarChart2 size={28} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-foreground">
                    {lang === 'zh' ? '全景课堂学情简报' : 'Panoramic Classroom Report'}
                  </h3>
                  <p className="text-xs text-muted">
                    {lang === 'zh' ? `授课时长: ${panoramicSummary.session?.durationMin || 0} 分钟` : 'Session Summary'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="p-2 text-muted hover:text-foreground rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-surface-secondary rounded-2xl border border-border/80 flex flex-col items-center text-center">
                <span className="text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '随堂测验正确率' : 'Quiz Accuracy'}
                </span>
                <span className="text-3xl font-black text-emerald-500 font-mono">
                  {panoramicSummary.metrics?.quizAccuracy || 0}%
                </span>
                <span className="text-[10px] text-muted mt-1">
                  {panoramicSummary.metrics?.quizCount || 0} 题次提交
                </span>
              </div>

              <div className="p-4 bg-surface-secondary rounded-2xl border border-border/80 flex flex-col items-center text-center">
                <span className="text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '课堂互动参与人次' : 'Poll Interactions'}
                </span>
                <span className="text-3xl font-black text-amber-500 font-mono">
                  {panoramicSummary.metrics?.pollVotesTotal || 0}
                </span>
                <span className="text-[10px] text-muted mt-1">口播投票互动</span>
              </div>

              <div className="p-4 bg-surface-secondary rounded-2xl border border-border/80 flex flex-col items-center text-center">
                <span className="text-xs font-bold text-muted mb-1">
                  {lang === 'zh' ? '结课通票综合评分' : 'Exit Ticket Rating'}
                </span>
                <span className="text-3xl font-black text-indigo-500 font-mono">
                  {panoramicSummary.metrics?.exitTicketsAvgRating || 5.0} ★
                </span>
                <span className="text-[10px] text-muted mt-1">
                  {panoramicSummary.metrics?.exitTicketsCount || 0} 人提交
                </span>
              </div>
            </div>

            {/* 困惑知识点词云列表 */}
            {panoramicSummary.metrics?.topPuzzledConcepts?.length > 0 && (
              <div className="p-4 bg-amber-500/5 rounded-2xl border border-amber-500/20 flex flex-col gap-2">
                <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {lang === 'zh' ? '📌 需重点讲评或个别辅导的困惑点 (来自结课通票)' : 'Top Puzzled Concepts'}
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {panoramicSummary.metrics.topPuzzledConcepts.map((concept: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium rounded-lg text-xs border border-amber-500/30"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="px-6 py-2.5 bg-primary-theme text-white font-bold rounded-xl hover:bg-primary-theme-hover transition-colors cursor-pointer"
              >
                {lang === 'zh' ? '完成归档' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
