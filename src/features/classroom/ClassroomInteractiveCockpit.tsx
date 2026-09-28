import React, { useState, useEffect, useCallback } from 'react';
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
  Dices,
  Trophy,
  Save,
  Rocket,
  Trash2,
  Plus,
  Star,
  BookOpen,
  ArrowDownToLine,
  X,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { StageDisplayModal } from './StageDisplayModal';
import { PacingDashboardModal } from './PacingDashboardModal';
import { ClassroomAttributionModal } from './ClassroomAttributionModal';
import { ClassroomLeaderboardModal } from './ClassroomLeaderboardModal';

export interface ClassroomInteractiveCockpitProps {
  lessonId: string | null;
  lessonTitle?: string;
  classId?: string | null;
  lang?: 'zh' | 'en';
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  currentStage?: string;
  onStageChange?: (stage: string) => void;
  students?: any[];
}

/** 课程预设投票题数据结构 */
interface PresetPoll {
  id: string;
  lessonId: string;
  title: string;
  questionType: 'ABCD' | 'TF' | 'CUSTOM';
  options: string[];
  correctOption: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export function ClassroomInteractiveCockpit({
  lessonId,
  lessonTitle,
  classId,
  lang = 'zh',
  addToast,
  currentStage: propStage,
  onStageChange,
  students = [],
}: ClassroomInteractiveCockpitProps) {
  const [internalStage, setInternalStage] = useState<string>('IN_CLASS_TEACHING');
  const currentStage = propStage !== undefined ? propStage : internalStage;

  const setStage = (st: string) => {
    setInternalStage(st);
    onStageChange?.(st);
  };

  const [isStageModalOpen, setIsStageModalOpen] = useState(false);
  const [isAttributionModalOpen, setIsAttributionModalOpen] = useState(false);
  const [isLeaderboardModalOpen, setIsLeaderboardModalOpen] = useState(false);
  const [isPollDialogOpen, setIsPollDialogOpen] = useState(false);
  const [pollTitle, setPollTitle] = useState('课堂极速单选投票');
  const [pollType, setPollType] = useState<'ABCD' | 'TF' | 'CUSTOM'>('ABCD');
  const [pollOptions, setPollOptions] = useState<string[]>(['A', 'B', 'C', 'D']);
  const [pollCorrectOption, setPollCorrectOption] = useState<string>('');
  const [presetPolls, setPresetPolls] = useState<PresetPoll[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [activePoll, setActivePoll] = useState<any>(null);
  const [activeBuzzer, setActiveBuzzer] = useState<any>(null);
  const [pacingSignals, setPacingSignals] = useState({ TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 });
  const [showPacingDashboard, setShowPacingDashboard] = useState(false);
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
            setStage(json.stage);
          }
          setActivePoll(json.activePoll || null);
          setActiveBuzzer(json.activeBuzzer || null);
        }

        const stageRes = await fetch(`/api/classroom/stage/${lessonId}/data`);
        if (stageRes.ok && mounted) {
          const stageJson = await stageRes.json();
          setPacingSignals(stageJson.pacing || { TOO_FAST: 0, SLOW: 0, CONFUSED: 0, CLEAR: 0 });
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

  // 获取当前课程的预设投票题库（必须早于 `if (!lessonId) return null` —— 保持 Hook 调用顺序恒定）
  const fetchPresetPolls = useCallback(async () => {
    if (!lessonId) return;
    setIsLoadingPresets(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/preset-polls`);
      if (res.ok) {
        const json = await res.json();
        setPresetPolls(json.presets || []);
      }
    } catch {
      // 静默失败，不影响主流程
    } finally {
      setIsLoadingPresets(false);
    }
  }, [lessonId]);

  // 打开弹窗时自动拉取预设题库
  useEffect(() => {
    if (isPollDialogOpen) {
      fetchPresetPolls();
    }
  }, [isPollDialogOpen, fetchPresetPolls]);

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
        setStage(stage);
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
        addToast(lang === 'zh' ? '阶段切换被拦截' : 'Stage Transition Blocked', err.error || 'Check guards', 'warning');
      }
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 切换题型时自动同步选项
  const handlePollTypeChange = (type: 'ABCD' | 'TF' | 'CUSTOM') => {
    setPollType(type);
    if (type === 'ABCD') {
      setPollOptions(['A', 'B', 'C', 'D']);
    } else if (type === 'TF') {
      setPollOptions(['正确', '错误']);
    }
    // CUSTOM 保留当前选项不变
    setPollCorrectOption('');
  };

  // 保存当前编辑器内容为预设题到本课程
  const handleSavePreset = async () => {
    if (!lessonId || !pollTitle.trim()) {
      addToast(
        lang === 'zh' ? '保存失败' : 'Save Failed',
        lang === 'zh' ? '题目标题不能为空' : 'Title required',
        'warning',
      );
      return;
    }
    try {
      const res = await fetch(`/api/lessons/${lessonId}/preset-polls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: pollTitle,
          questionType: pollType,
          options: pollOptions,
          correctOption: pollCorrectOption || null,
        }),
      });
      if (res.ok) {
        addToast(
          lang === 'zh' ? '已保存' : 'Saved',
          lang === 'zh' ? '题目已保存到本课程题库' : 'Preset saved',
          'success',
        );
        fetchPresetPolls();
      }
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 删除预设题
  const handleDeletePreset = async (presetId: string) => {
    if (!lessonId) return;
    try {
      await fetch(`/api/lessons/${lessonId}/preset-polls/${presetId}`, { method: 'DELETE' });
      setPresetPolls((prev) => prev.filter((p) => p.id !== presetId));
    } catch (e: any) {
      addToast('Error', e.message, 'error');
    }
  };

  // 将预设题载入编辑器
  const loadPresetToEditor = (preset: PresetPoll) => {
    setPollTitle(preset.title);
    setPollType(preset.questionType);
    setPollOptions([...preset.options]);
    setPollCorrectOption(preset.correctOption || '');
  };

  // 发起极速投票（使用当前编辑器中的数据）
  const handleStartQuickPoll = async (title?: string, qType?: string, opts?: string[], correctOpt?: string | null) => {
    try {
      const finalTitle = title || pollTitle;
      const finalType = qType || pollType;
      const finalOptions = opts || pollOptions;
      const finalCorrect = correctOpt !== undefined ? correctOpt : pollCorrectOption || null;

      const res = await fetch(`/api/classroom/sessions/${lessonId}/quick-poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: finalTitle,
          questionType: finalType,
          options: finalOptions,
          correctOption: finalCorrect,
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
              {lang === 'zh'
                ? `结束投票 (${activePoll.totalVotes || 0}人)`
                : `Close Poll (${activePoll.totalVotes || 0})`}
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

        {/* 随机抽问与归因加分 (Stitch 88b094e6) */}
        <button
          onClick={() => setIsAttributionModalOpen(true)}
          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          title={lang === 'zh' ? '随机抽问与归因表现激励' : 'Random Pick & Attribution Points'}
        >
          <Dices size={13} className="text-indigo-500" />
          <span>{lang === 'zh' ? '随机抽问' : 'Roll Call'}</span>
        </button>

        {/* 班级积分榜 (Stitch 00e4f919) */}
        <button
          onClick={() => setIsLeaderboardModalOpen(true)}
          className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-3xs cursor-pointer"
          title={lang === 'zh' ? '全班积分榜与小组联赛' : 'Class Points & Team Leaderboard'}
        >
          <Trophy size={13} className="text-amber-500" />
          <span>{lang === 'zh' ? '积分榜' : 'Leaderboard'}</span>
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

        {/* 扩展卡槽：第三方插件注册顶栏操作 */}
        <ExtensionPointRenderer
          slot="classroom.topbar.action"
          slotProps={{
            lessonId,
            classId,
            stage: currentStage,
          }}
        />
        <ExtensionPointRenderer
          slot="classroom.topbar.pill"
          slotProps={{
            lessonId,
            classId,
            stage: currentStage,
          }}
        />
      </div>

      {/* 右侧：节奏晴雨表指示器（点击打开实时情绪仪表盘） */}
      <div className="flex items-center gap-2 pl-2 border-l border-border/60">
        <button
          onClick={() => setShowPacingDashboard(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-xl hover:bg-surface-secondary transition-colors cursor-pointer group"
          title={lang === 'zh' ? '打开课堂反馈情绪仪表盘' : 'Open feedback dashboard'}
        >
          <div className="flex items-center gap-1 text-[11px] font-semibold text-muted group-hover:text-main">
            <TrendingUp size={12} className="text-primary-theme" />
            <span>{lang === 'zh' ? '节奏晴雨表:' : 'Barometer:'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-[10px]"
              title="理解 / 节奏适宜"
            >
              💡 {pacingSignals.CLEAR || 0}
            </span>
            <span
              className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-[10px]"
              title="困惑"
            >
              ❓ {pacingSignals.CONFUSED || 0}
            </span>
            <span
              className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold text-[10px]"
              title="慢一点（讲太快）"
            >
              🐇 {pacingSignals.TOO_FAST || 0}
            </span>
            <span
              className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold text-[10px]"
              title="快一点（讲太慢）"
            >
              🐢 {pacingSignals.SLOW || 0}
            </span>
          </div>
        </button>
      </div>

      {/* 课堂反馈情绪实时仪表盘 */}
      {showPacingDashboard && lessonId && (
        <PacingDashboardModal
          lessonId={lessonId}
          lang={lang === 'zh' ? 'zh' : 'en'}
          signals={pacingSignals}
          onlineCount={students?.filter((s) => s.online).length || 0}
          onClose={() => setShowPacingDashboard(false)}
        />
      )}

      {/* 大屏展台模态框 */}
      <StageDisplayModal
        isOpen={isStageModalOpen}
        onClose={() => setIsStageModalOpen(false)}
        lessonId={lessonId}
        lessonTitle={lessonTitle}
        lang={lang}
      />

      {/* 课堂抽问与归因表现激励弹窗 (Stitch 88b094e6) */}
      <ClassroomAttributionModal
        isOpen={isAttributionModalOpen}
        onClose={() => setIsAttributionModalOpen(false)}
        classId={classId}
        lessonId={lessonId}
        students={students}
        lang={lang}
        addToast={addToast}
        onOpenLeaderboard={() => setIsLeaderboardModalOpen(true)}
      />

      {/* 班级积分榜与小组联赛弹窗 (Stitch 00e4f919) */}
      <ClassroomLeaderboardModal
        isOpen={isLeaderboardModalOpen}
        onClose={() => setIsLeaderboardModalOpen(false)}
        classId={classId}
        lessonId={lessonId}
        students={students}
        lang={lang}
        addToast={addToast}
        onSelectStudentToAward={() => {
          setIsLeaderboardModalOpen(false);
          setIsAttributionModalOpen(true);
        }}
      />

      {/* 极速出题配置对话框（含预设题库 + 灵活编辑器） */}
      {isPollDialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-lg shadow-xl flex flex-col gap-4 max-h-[85vh] overflow-y-auto">
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Sparkles size={18} className="text-amber-500" />
                <span>{lang === 'zh' ? '极速投票配置' : 'Quick Poll Setup'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPollDialogOpen(false)}
                className="p-1.5 rounded-lg text-muted hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* ── 预设题库区 ── */}
            {presetPolls.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                  <BookOpen size={13} />
                  <span>
                    {lang === 'zh' ? `本课已保存题目 (${presetPolls.length})` : `Saved Presets (${presetPolls.length})`}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
                  {presetPolls.map((preset) => (
                    <div
                      key={preset.id}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border/60 bg-surface-secondary/50 hover:bg-surface-secondary transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{preset.title}</div>
                        <div className="text-xs text-muted flex items-center gap-1.5 mt-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-surface-secondary border border-border text-[10px] font-bold">
                            {preset.questionType === 'TF' ? '判断' : preset.questionType === 'ABCD' ? 'ABCD' : '自定义'}
                          </span>
                          <span className="truncate">{preset.options.join(' / ')}</span>
                          {preset.correctOption && (
                            <span className="flex items-center gap-0.5 text-emerald-500">
                              <Star size={10} className="fill-current" />
                              {preset.correctOption}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => loadPresetToEditor(preset)}
                          className="p-1.5 rounded-md hover:bg-primary-theme/10 text-primary-theme transition-colors cursor-pointer"
                          title={lang === 'zh' ? '引入到编辑器' : 'Load to editor'}
                        >
                          <ArrowDownToLine size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleStartQuickPoll(
                              preset.title,
                              preset.questionType,
                              preset.options,
                              preset.correctOption,
                            )
                          }
                          className="p-1.5 rounded-md hover:bg-emerald-500/10 text-emerald-500 transition-colors cursor-pointer"
                          title={lang === 'zh' ? '直接发送' : 'Send now'}
                        >
                          <Rocket size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 transition-colors cursor-pointer"
                          title={lang === 'zh' ? '删除' : 'Delete'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isLoadingPresets && (
              <div className="text-xs text-muted text-center py-2">
                {lang === 'zh' ? '加载预设题库...' : 'Loading presets...'}
              </div>
            )}

            {/* ── 分割线 ── */}
            {presetPolls.length > 0 && <div className="border-t border-border/60" />}

            {/* ── 题干输入 ── */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted text-xs">
                {lang === 'zh' ? '投票标题 / 题干' : 'Poll Title / Question'}
              </label>
              <input
                type="text"
                value={pollTitle}
                onChange={(e) => setPollTitle(e.target.value)}
                placeholder={lang === 'zh' ? '例：下列哪个选项正确？' : 'e.g. Which is correct?'}
                className="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-theme"
              />
            </div>

            {/* ── 题型选择（三列） ── */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted text-xs">{lang === 'zh' ? '题型选择' : 'Question Type'}</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'ABCD' as const, label: 'ABCD 四选一' },
                  { key: 'TF' as const, label: '正确 / 错误' },
                  { key: 'CUSTOM' as const, label: '自定义选项' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePollTypeChange(key)}
                    className={`p-2 rounded-lg border font-bold text-center text-xs transition-colors cursor-pointer ${
                      pollType === key
                        ? 'border-primary-theme bg-primary-theme/10 text-primary-theme'
                        : 'border-border bg-surface-secondary text-muted'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── 选项编辑区 ── */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-muted text-xs">
                {lang === 'zh' ? '选项列表' : 'Options'}{' '}
                {pollCorrectOption && (
                  <span className="text-emerald-500 ml-1">
                    ✓ {lang === 'zh' ? '参考答案' : 'Answer'}: {pollCorrectOption}
                  </span>
                )}
              </label>
              <div className="flex flex-col gap-1.5">
                {pollOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPollCorrectOption(pollCorrectOption === opt ? '' : opt)}
                      className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 ${
                        pollCorrectOption === opt
                          ? 'text-emerald-500 bg-emerald-500/10'
                          : 'text-muted/40 hover:text-emerald-400'
                      }`}
                      title={lang === 'zh' ? '设为参考答案' : 'Set as correct'}
                    >
                      <Star size={14} className={pollCorrectOption === opt ? 'fill-current' : ''} />
                    </button>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => {
                        const next = [...pollOptions];
                        next[idx] = e.target.value;
                        setPollOptions(next);
                        if (pollType !== 'CUSTOM') setPollType('CUSTOM');
                      }}
                      className="flex-1 px-3 py-1.5 bg-surface-secondary border border-border rounded-lg text-foreground text-sm focus:outline-hidden focus:ring-2 focus:ring-primary-theme"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = pollOptions.filter((_, i) => i !== idx);
                          setPollOptions(next);
                          if (pollCorrectOption === opt) setPollCorrectOption('');
                          if (pollType !== 'CUSTOM') setPollType('CUSTOM');
                        }}
                        className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < 8 && (
                <button
                  type="button"
                  onClick={() => {
                    setPollOptions([...pollOptions, `选项${pollOptions.length + 1}`]);
                    if (pollType !== 'CUSTOM') setPollType('CUSTOM');
                  }}
                  className="flex items-center gap-1.5 text-xs text-primary-theme hover:text-primary-theme-hover font-semibold mt-1 cursor-pointer"
                >
                  <Plus size={13} />
                  {lang === 'zh' ? '添加选项' : 'Add Option'}{' '}
                  <span className="text-muted font-normal">({pollOptions.length}/8)</span>
                </button>
              )}
            </div>

            {/* ── 操作栏 ── */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={handleSavePreset}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-muted hover:bg-surface-secondary border border-border/60 transition-colors cursor-pointer"
              >
                <Save size={14} />
                {lang === 'zh' ? '保存到本课程' : 'Save to Lesson'}
              </button>
              <button
                type="button"
                onClick={() => handleStartQuickPoll()}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-theme text-white font-bold rounded-lg hover:bg-primary-theme-hover transition-colors cursor-pointer"
              >
                <Rocket size={14} />
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
                <span className="text-[10px] text-muted mt-1">{panoramicSummary.metrics?.quizCount || 0} 题次提交</span>
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
