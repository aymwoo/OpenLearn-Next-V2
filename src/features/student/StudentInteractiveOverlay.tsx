import React, { useState, useEffect, useRef } from 'react';
import { Bell, Sparkles, TrendingUp, CheckCircle2, HelpCircle, Zap, Star, X } from 'lucide-react';
import { StudentCountdownBanner } from './StudentCountdownBanner';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { AdaptiveExitTicketModal } from '../classroom/exit-ticket/AdaptiveExitTicketModal';
import { getOptionalSocket } from '../../services/socket-service';

export interface StudentInteractiveOverlayProps {
  lessonId: string | null;
  studentId?: string;
  studentName?: string;
  lang?: 'zh' | 'en';
}

export function StudentInteractiveOverlay({
  lessonId,
  studentId = 'student_demo',
  studentName = '我',
  lang = 'zh',
}: StudentInteractiveOverlayProps) {
  const [activePoll, setActivePoll] = useState<any>(null);
  const [activeBuzzer, setActiveBuzzer] = useState<any>(null);
  const [stage, setStage] = useState<string>('IN_CLASS_TEACHING');

  // 教学环节与分环节节奏晴雨表状态
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [segmentTitles, setSegmentTitles] = useState<Record<string, string>>({});
  const [currentPacingSignal, setCurrentPacingSignal] = useState<'TOO_FAST' | 'SLOW' | 'CONFUSED' | 'CLEAR' | null>(
    null,
  );

  // 作答与抢答状态
  const [selectedPollOption, setSelectedPollOption] = useState<string | null>(null);
  const [pollSubmitted, setPollSubmitted] = useState(false);
  const [buzzStatus, setBuzzStatus] = useState<'IDLE' | 'BUZZED' | 'WINNER' | 'MISSED'>('IDLE');
  /** 学生主动关闭弹窗后记录的 buzzerId：用于「同一轮不反复弹出，新一轮自动重开」 */
  const [dismissedBuzzerId, setDismissedBuzzerId] = useState<string | null>(null);
  const [pacingFeedback, setPacingFeedback] = useState<string | null>(null);
  const [isExitTicketOpen, setIsExitTicketOpen] = useState(false);
  const [exitTicketSubmitted, setExitTicketSubmitted] = useState(false);
  const [rating, setRating] = useState(5);
  const [puzzledConcept, setPuzzledConcept] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const buzzerArmedTimeRef = useRef<number>(Date.now());
  /**
   * 本轮抢答已裁决的结果（按 buzzerId 记忆）。
   * 作用：一旦判定为 WINNER/MISSED 就不再被后续轮询改写，
   * 避免本地 studentId 与服务端会话 ID 不一致时在两个结果间来回跳变。
   */
  const buzzOutcomeRef = useRef<{ buzzerId: string; status: 'WINNER' | 'MISSED' } | null>(null);
  /**
   * 轮询请求序号（单调递增）+ 本次抢答时的水位线。
   * 用于识别「在途轮询返回的过期快照」：抢答提交瞬间会记下当时已发出的请求水位，
   * 凡是序号 ≤ 水位的响应都诞生于抢答之前，它带回的 READY 只是旧状态，
   * 绝不能据此把已判定的结果复位掉。
   *
   * 用序号而非时间戳：同一毫秒内发出的请求与抢答，用 Date.now() 无法区分先后。
   */
  const pollSeqRef = useRef(0);
  const buzzPollSeqRef = useRef(0);
  /**
   * 轮询状态镜像：只供「是否为新的一轮」做比较，不参与渲染。
   * 必须用 ref 而非 state —— 服务端每次轮询都返回全新对象，若把 activePoll /
   * activeBuzzer 放进 effect 依赖，会形成
   * 「轮询 → 写入新对象 → 依赖变化 → effect 重建并立即再次轮询」的自激循环，
   * 2.5s 节流被完全绕过，学生端会以 CPU 速度持续打接口。
   */
  const activePollRef = useRef<any>(null);
  const activeBuzzerRef = useRef<any>(null);
  const exitTicketSubmittedRef = useRef(false);

  // 轮询活跃互动与阶段
  useEffect(() => {
    if (!lessonId) return;

    let mounted = true;
    const pollClassroomState = async () => {
      // 本次请求的序号（响应到达时据此判断快照是否诞生于抢答之前）
      const mySeq = ++pollSeqRef.current;
      try {
        const res = await fetch(`/api/classroom/sessions/${lessonId}`);
        if (res.ok && mounted) {
          const json = await res.json();
          if (json.hasActiveSession) {
            setStage(json.stage);
            if (json.session?.current_segment_id) {
              setActiveSegmentId(json.session.current_segment_id);
            }

            // 如果处于结课通票阶段且尚未提交，打开通票模态框
            if (json.stage === 'WRAP_UP_EXIT_TICKET' && !exitTicketSubmittedRef.current) {
              setIsExitTicketOpen(true);
            }

            // 同步投票
            if (json.activePoll && (!activePollRef.current || activePollRef.current.id !== json.activePoll.id)) {
              activePollRef.current = json.activePoll;
              setActivePoll(json.activePoll);
              setSelectedPollOption(null);
              setPollSubmitted(false);
            } else if (!json.activePoll && activePollRef.current) {
              activePollRef.current = null;
              setActivePoll(null);
            }

            // 同步抢答器
            const prevBuzzer = activeBuzzerRef.current;
            if (json.activeBuzzer) {
              const isNewBuzzer = !prevBuzzer || prevBuzzer.id !== json.activeBuzzer.id;
              if (isNewBuzzer) {
                // 教师开启新一轮：武装抢答，允许弹窗再次出现
                activeBuzzerRef.current = json.activeBuzzer;
                setActiveBuzzer(json.activeBuzzer);
                setBuzzStatus('IDLE');
                setDismissedBuzzerId(null);
                buzzOutcomeRef.current = null;
                buzzerArmedTimeRef.current = Date.now();
              } else if (json.activeBuzzer.status === 'LOCKED') {
                // 本轮已出结果：结果一经判定即锁定，不被后续轮询翻转
                const outcome = buzzOutcomeRef.current;
                const decided =
                  outcome && outcome.buzzerId === json.activeBuzzer.id
                    ? outcome.status
                    : json.activeBuzzer.winner_student_id === studentId
                      ? 'WINNER'
                      : 'MISSED';
                buzzOutcomeRef.current = { buzzerId: json.activeBuzzer.id, status: decided };
                activeBuzzerRef.current = json.activeBuzzer;
                setBuzzStatus(decided);
                setActiveBuzzer(json.activeBuzzer);
              } else if (json.activeBuzzer.status === 'READY') {
                // 「READY」有两种来源，必须区分：
                //  a) 教师重置了同一轮（buzzOutcomeRef 里已有本轮结果）→ 复位，允许再抢；
                //  b) 本次请求是在抢答之前发出的在途快照（DB 尚未提交 / 响应竞态）→ 必须忽略，
                //     否则会把刚判定出的 WINNER/MISSED 冲回 IDLE，学生看到按钮反复闪回。
                const isStaleSnapshot = mySeq <= buzzPollSeqRef.current;
                if (!isStaleSnapshot && buzzOutcomeRef.current?.buzzerId === json.activeBuzzer.id) {
                  buzzOutcomeRef.current = null;
                  activeBuzzerRef.current = json.activeBuzzer;
                  setBuzzStatus('IDLE');
                  setActiveBuzzer(json.activeBuzzer);
                  setDismissedBuzzerId(null);
                  buzzerArmedTimeRef.current = Date.now();
                }
              }
            } else if (prevBuzzer) {
              activeBuzzerRef.current = null;
              setActiveBuzzer(null);
              setBuzzStatus('IDLE');
              buzzOutcomeRef.current = null;
            }
          }
        }
      } catch (e) {
        // silent
      }
    };

    pollClassroomState();
    const timer = setInterval(pollClassroomState, 2500);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
    // 仅依赖真正需要重建轮询的值。activePoll / activeBuzzer / exitTicketSubmitted
    // 一律通过上面的 ref 读取：把它们放进依赖会导致自激轮询（见 activeBuzzerRef 注释）。
  }, [lessonId, studentId]);

  // 监听教师广播的教学环节切换
  useEffect(() => {
    const socket = getOptionalSocket();
    if (!socket || !lessonId) return;

    const handleSegmentChanged = (data: any) => {
      if (data?.lessonId === lessonId && data?.activeSegmentId) {
        setActiveSegmentId(data.activeSegmentId);
      }
    };
    socket.on('student-active-segment-changed', handleSegmentChanged);
    return () => {
      if (typeof socket.off === 'function') {
        socket.off('student-active-segment-changed', handleSegmentChanged);
      }
    };
  }, [lessonId]);

  // 加载当前课节的大纲环节名称字典
  useEffect(() => {
    if (!lessonId) return;
    fetch(`/api/lessons/${lessonId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.timeline) {
          try {
            const raw = typeof data.timeline === 'string' ? JSON.parse(data.timeline) : data.timeline;
            if (Array.isArray(raw)) {
              const map: Record<string, string> = {};
              raw.forEach((s: any) => {
                if (s?.id && s?.title) map[s.id] = s.title;
              });
              setSegmentTitles(map);
            }
          } catch (_) {}
        }
      })
      .catch(() => {});
  }, [lessonId]);

  // 当环节变化或初次挂载时，查询当前学生在当前环节的反馈状态
  useEffect(() => {
    if (!lessonId) return;
    const seg = activeSegmentId || 'default';
    fetch(`/api/classroom/sessions/${lessonId}/pacing-summary?segmentId=${encodeURIComponent(seg)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          setCurrentPacingSignal(data.mySignal || null);
        }
      })
      .catch(() => {});
  }, [lessonId, activeSegmentId]);

  if (!lessonId) return null;

  // 发送、切换或取消节奏信号（按当前环节去重）
  const sendPacingSignal = async (signalType: 'TOO_FAST' | 'SLOW' | 'CONFUSED' | 'CLEAR') => {
    try {
      const isToggleCancel = currentPacingSignal === signalType;
      const res = await fetch(`/api/classroom/sessions/${lessonId}/pacing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signal: isToggleCancel ? null : signalType,
          action: isToggleCancel ? 'cancel' : undefined,
          toggle: true,
          segmentId: activeSegmentId || 'default',
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setCurrentPacingSignal(json.currentSignal ?? null);
        if (json.currentSignal) {
          setPacingFeedback(
            signalType === 'TOO_FAST'
              ? lang === 'zh'
                ? '已反馈: 🐇 讲太快'
                : 'Pacing: Too Fast'
              : signalType === 'SLOW'
                ? lang === 'zh'
                  ? '已反馈: 🐢 讲太慢'
                  : 'Pacing: Too Slow'
                : signalType === 'CONFUSED'
                  ? lang === 'zh'
                    ? '已反馈: ❓ 有疑问'
                    : 'Pacing: Confused'
                  : lang === 'zh'
                    ? '已反馈: 💡 听懂了'
                    : 'Pacing: Clear',
          );
        } else {
          setPacingFeedback(lang === 'zh' ? '已取消反馈' : 'Feedback cleared');
        }
        setTimeout(() => setPacingFeedback(null), 2500);
      }
    } catch (e) {
      // silent
    }
  };

  // 提交单选投票
  const submitPollVote = async (option: string) => {
    if (!activePoll || pollSubmitted) return;
    try {
      setSelectedPollOption(option);
      setPollSubmitted(true);
      await fetch(`/api/classroom/sessions/${lessonId}/quick-poll/${activePoll.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          option,
        }),
      });
    } catch (e) {
      // silent
    }
  };

  // 抢答点击
  const handleBuzzIn = async () => {
    if (!activeBuzzer || activeBuzzer.status !== 'READY' || buzzStatus !== 'IDLE') return;

    const responseTimeMs = Date.now() - buzzerArmedTimeRef.current;
    // 记下抢答时已发出的轮询水位：这些在途响应的状态快照诞生于抢答之前，须被忽略
    buzzPollSeqRef.current = pollSeqRef.current;
    setBuzzStatus('BUZZED');

    try {
      const res = await fetch(`/api/classroom/sessions/${lessonId}/buzzer/${activeBuzzer.id}/buzz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName,
          responseTimeMs,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        // 服务端契约：命中先到先得时返回 won=true；已被别人抢先则返回 won=false + winner 信息
        const won = json.won ?? json.winner === true;
        const next: 'WINNER' | 'MISSED' = won ? 'WINNER' : 'MISSED';
        buzzOutcomeRef.current = { buzzerId: activeBuzzer.id, status: next };
        setBuzzStatus(next);

        // 未抢到时立刻把获胜者信息写回，避免要等下一次 2.5s 轮询才显示姓名
        if (!won && json.winner) {
          const lockedBuzzer = {
            ...activeBuzzer,
            status: 'LOCKED' as const,
            winner_student_id: json.winner.studentId ?? null,
            winner_student_name: json.winner.studentName ?? null,
            winner_response_time_ms: json.winner.responseTimeMs ?? null,
          };
          activeBuzzerRef.current = lockedBuzzer;
          setActiveBuzzer(lockedBuzzer);
        }
      } else {
        // 提交失败（如网络/鉴权）：回退到待抢答，允许学生重试
        setBuzzStatus('IDLE');
      }
    } catch (e) {
      // 请求异常同样回退，避免停在无内容的「BUZZED」空壳界面
      setBuzzStatus('IDLE');
    }
  };

  // 提交结课通票
  const submitExitTicket = async () => {
    try {
      await fetch(`/api/classroom/sessions/${lessonId}/exit-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          puzzledConcept,
          feedback: feedbackNotes,
        }),
      });
      exitTicketSubmittedRef.current = true;
      setExitTicketSubmitted(true);
      setIsExitTicketOpen(false);
    } catch (e) {
      // silent
    }
  };

  return (
    <>
      {/* 课堂倒计时横幅（与教师端实时同步） */}
      <StudentCountdownBanner lessonId={lessonId} lang={lang} />

      {/* 课中插件浮层槽位：插件可在此渲染随堂答题等模态弹窗
          （学生上课中被锁定在课节视图，仪表盘的 student.view 槽位不可见） */}
      <ExtensionPointRenderer slot="student.classroom.overlay" slotProps={{ studentId, lessonId }} />

      {/* 考试模式全屏视图（v5.1 休眠槽位接线）：插件全屏接管（锁定退出 + 倒计时），
          由插件组件自行决定渲染时机（仅考试模式的卷激活时） */}
      <ExtensionPointRenderer slot="student.fullscreen" slotProps={{ studentId, lessonId }} />

      {/* 悬浮学习节奏信号条 (底部浮动) */}
      <aside
        aria-label={lang === 'zh' ? '课堂互动工具栏' : 'Classroom interaction toolbar'}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 bg-surface/95 backdrop-blur-md border border-theme p-2 rounded-2xl shadow-2xl transition-all"
      >
        {/* 教学环节标签指示 */}
        <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-secondary/70 rounded-xl border border-theme text-2xs font-bold text-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-theme animate-pulse" />
          <span className="truncate max-w-[120px]">
            {activeSegmentId && segmentTitles[activeSegmentId]
              ? segmentTitles[activeSegmentId]
              : lang === 'zh'
                ? '当前环节'
                : 'Current Segment'}
          </span>
        </div>

        {pacingFeedback && (
          <span className="text-2xs font-bold text-primary-theme px-1.5 py-0.5 animate-fade-in whitespace-nowrap">
            {pacingFeedback}
          </span>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => sendPacingSignal('CLEAR')}
            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1 cursor-pointer ${
              currentPacingSignal === 'CLEAR'
                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 ring-2 ring-emerald-500/60 shadow-xs'
                : 'hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            }`}
            title={lang === 'zh' ? '听懂了，节奏适宜（再次点击取消）' : 'Clear & Optimal (Click again to cancel)'}
          >
            <span>💡</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '听懂了' : 'Clear'}</span>
            {currentPacingSignal === 'CLEAR' && <span className="text-3xs ml-0.5 font-bold">✓</span>}
          </button>

          <button
            type="button"
            onClick={() => sendPacingSignal('CONFUSED')}
            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1 cursor-pointer ${
              currentPacingSignal === 'CONFUSED'
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 ring-2 ring-amber-500/60 shadow-xs'
                : 'hover:bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
            title={lang === 'zh' ? '有点困惑，希望老师点拨（再次点击取消）' : 'Confused (Click again to cancel)'}
          >
            <span>❓</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '有疑问' : 'Confused'}</span>
            {currentPacingSignal === 'CONFUSED' && <span className="text-3xs ml-0.5 font-bold">✓</span>}
          </button>

          <button
            type="button"
            onClick={() => sendPacingSignal('TOO_FAST')}
            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1 cursor-pointer ${
              currentPacingSignal === 'TOO_FAST'
                ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 ring-2 ring-rose-500/60 shadow-xs'
                : 'hover:bg-rose-500/10 text-rose-600 dark:text-rose-400'
            }`}
            title={lang === 'zh' ? '讲得太快了，希望能慢一点（再次点击取消）' : 'Too fast (Click again to cancel)'}
          >
            <span>🐇</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '讲太快' : 'Too Fast'}</span>
            {currentPacingSignal === 'TOO_FAST' && <span className="text-3xs ml-0.5 font-bold">✓</span>}
          </button>

          <button
            type="button"
            onClick={() => sendPacingSignal('SLOW')}
            className={`px-2.5 py-1.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1 cursor-pointer ${
              currentPacingSignal === 'SLOW'
                ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 ring-2 ring-indigo-500/60 shadow-xs'
                : 'hover:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
            }`}
            title={lang === 'zh' ? '讲太慢了，希望快一点（再次点击取消）' : 'Too slow (Click again to cancel)'}
          >
            <span>🐢</span>
            <span className="hidden sm:inline">{lang === 'zh' ? '讲太慢' : 'Too Slow'}</span>
            {currentPacingSignal === 'SLOW' && <span className="text-3xs ml-0.5 font-bold">✓</span>}
          </button>
        </div>
      </aside>

      {/* 极速单选作答弹窗 */}
      {activePoll && activePoll.status === 'ACTIVE' && (
        <div className="fixed bottom-20 right-6 z-50 bg-surface rounded-2xl border border-amber-500/40 p-5 shadow-2xl w-80 flex flex-col gap-3 animate-slide-up">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span className="text-xs font-extrabold text-amber-500 flex items-center gap-1.5">
              <Sparkles size={14} />
              {lang === 'zh' ? '极速答题进行中' : 'Quick Poll Active'}
            </span>
            {pollSubmitted && (
              <span className="text-[11px] text-emerald-500 font-bold flex items-center gap-1">
                <CheckCircle2 size={12} />
                {lang === 'zh' ? '已提交' : 'Submitted'}
              </span>
            )}
          </div>

          <p className="font-bold text-sm text-foreground">{activePoll.title}</p>

          <div className="grid grid-cols-2 gap-2 mt-1">
            {(activePoll.options || ['A', 'B', 'C', 'D']).map((opt: string) => {
              const isSelected = selectedPollOption === opt;
              return (
                <button
                  key={opt}
                  disabled={pollSubmitted}
                  onClick={() => submitPollVote(opt)}
                  className={`p-3 rounded-xl font-bold text-center text-sm transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-primary-theme text-white ring-2 ring-primary-theme shadow-md scale-95'
                      : pollSubmitted
                        ? 'bg-surface-secondary text-muted opacity-60 cursor-not-allowed'
                        : 'bg-surface-secondary hover:bg-primary-theme/10 hover:border-primary-theme border border-border text-foreground'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 抢答器弹窗：同一轮可被学生主动关闭（dismissedBuzzerId），
          教师开启新一轮（新的 buzzerId）或重置同一轮时自动重新弹出 */}
      {activeBuzzer && dismissedBuzzerId !== activeBuzzer.id && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setDismissedBuzzerId(activeBuzzer.id)}
        >
          <div
            className="relative bg-surface rounded-3xl border border-rose-500/50 p-8 w-full max-w-sm shadow-2xl flex flex-col items-center text-center gap-4 animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭出口：学生必须能自行退出全屏遮罩 */}
            <button
              onClick={() => setDismissedBuzzerId(activeBuzzer.id)}
              aria-label={lang === 'zh' ? '关闭抢答' : 'Close buzzer'}
              className="absolute top-3 right-3 p-1.5 rounded-full text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            <h3 className="text-xl font-black text-foreground flex items-center gap-2">
              <Bell size={22} className="text-rose-500 animate-bounce" />
              <span>{activeBuzzer.title || '全班极速抢答'}</span>
            </h3>

            {buzzStatus === 'BUZZED' && (
              <div className="my-4 p-6 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex flex-col items-center text-center">
                <span className="text-4xl mb-2 animate-pulse">⚡</span>
                <span className="text-base font-bold text-foreground">正在提交抢答…</span>
                <span className="text-xs text-muted mt-1">请稍候，马上公布结果</span>
              </div>
            )}

            {buzzStatus === 'IDLE' && activeBuzzer.status === 'READY' && (
              <div className="my-4 flex flex-col items-center gap-3">
                <button
                  onClick={handleBuzzIn}
                  className="w-36 h-36 rounded-full bg-gradient-to-tr from-rose-600 to-rose-400 text-white font-black text-2xl shadow-xl hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center border-4 border-white dark:border-slate-800 cursor-pointer animate-pulse"
                >
                  <Zap size={32} className="mb-1" />
                  <span>抢！</span>
                </button>
                <span className="text-xs text-muted">点击红色大按钮抢得首答权</span>
              </div>
            )}

            {buzzStatus === 'WINNER' && (
              <div className="my-4 p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex flex-col items-center text-center">
                <span className="text-4xl mb-2">🎉</span>
                <span className="text-lg font-black text-emerald-500">恭喜你率先抢答！</span>
                <span className="text-xs text-muted mt-1">请起立或开麦回答老师的问题</span>
                <button
                  onClick={() => setDismissedBuzzerId(activeBuzzer.id)}
                  className="mt-3 px-4 py-1.5 rounded-xl text-xs font-bold text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  {lang === 'zh' ? '知道了，返回课堂' : 'Got it, back to class'}
                </button>
              </div>
            )}

            {buzzStatus === 'MISSED' && (
              <div className="my-4 p-6 bg-slate-800/20 border border-border rounded-2xl flex flex-col items-center text-center">
                <span className="text-4xl mb-2">⚡</span>
                <span className="text-base font-bold text-foreground">
                  已被 {activeBuzzer.winner_student_name || '其他同学'} 抢先一步！
                </span>
                <span className="text-xs text-muted mt-1">下次手速要更快哦</span>
                <button
                  onClick={() => setDismissedBuzzerId(activeBuzzer.id)}
                  className="mt-3 px-4 py-1.5 rounded-xl text-xs font-bold text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
                >
                  {lang === 'zh' ? '知道了，返回课堂' : 'Got it, back to class'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 60s 自适应结课通票模态框 */}
      <AdaptiveExitTicketModal
        isOpen={isExitTicketOpen && !exitTicketSubmitted}
        onClose={() => setIsExitTicketOpen(false)}
        lessonId={lessonId}
        studentName={studentName}
        lang={lang}
        onSubmitSuccess={() => {
          exitTicketSubmittedRef.current = true;
          setExitTicketSubmitted(true);
        }}
      />
    </>
  );
}
