import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Trophy,
  Sparkles,
  Shuffle,
  ChevronRight,
  X,
  Code2,
  Medal,
  Flame,
  TrendingUp,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { StudentGrowthProfileModal } from '../student/StudentGrowthProfileModal';

export interface StudentProfile {
  id: string;
  name: string;
  studentNo?: string;
  groupName?: string;
  seatNumber?: string;
  currentPoints?: number;
  focusScore?: number;
  pickedCountToday?: number;
  avatarUrl?: string;
  /**
   * 真实维度分数（0-100），由宿主从可追溯数据源计算后传入：
   *   logic         ← 随堂测真实正确率
   *   engineering   ← 课件真实完成度
   *   focus         ← 真实学习进度
   *   creativity / collaboration ← 平台当前无数据源，留空即显示「暂无数据」
   */
  competencyScores?: {
    logic?: number;
    engineering?: number;
    creativity?: number;
    collaboration?: number;
    focus?: number;
  };
}

export interface BuiltinAward {
  id: string;
  dimensionId: string;
  emoji: string;
  deltaPoints: number;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  borderColor: string;
  bgLight: string;
  textColor: string;
}

const BUILTIN_AWARDS: BuiltinAward[] = [
  {
    id: 'logic_clarity',
    dimensionId: 'logic_clarity',
    emoji: '💡',
    deltaPoints: 2,
    nameZh: '逻辑清晰',
    nameEn: 'Clear Logic',
    descZh: '算法流程叙述规范',
    descEn: 'Structured algorithm reasoning',
    borderColor: 'border-amber-200 dark:border-amber-700/60',
    bgLight: 'bg-amber-50/80 hover:bg-amber-100/90 dark:bg-amber-950/30 dark:hover:bg-amber-900/40',
    textColor: 'text-amber-700 dark:text-amber-300',
  },
  {
    id: 'creative_bonus',
    dimensionId: 'creative_bonus',
    emoji: '🚀',
    deltaPoints: 3,
    nameZh: '创意满分',
    nameEn: 'High Creativity',
    descZh: '方案构思新颖独特',
    descEn: 'Innovative & unique solution',
    borderColor: 'border-indigo-200 dark:border-indigo-700/60',
    bgLight: 'bg-indigo-50/80 hover:bg-indigo-100/90 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40',
    textColor: 'text-indigo-700 dark:text-indigo-300',
  },
  {
    id: 'brave_speech',
    dimensionId: 'brave_speech',
    emoji: '👏',
    deltaPoints: 1,
    nameZh: '勇于发言',
    nameEn: 'Active Voice',
    descZh: '积极参与大胆质疑',
    descEn: 'Constructive question & participation',
    borderColor: 'border-emerald-200 dark:border-emerald-700/60',
    bgLight: 'bg-emerald-50/80 hover:bg-emerald-100/90 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40',
    textColor: 'text-emerald-700 dark:text-emerald-300',
  },
  {
    id: 'peer_help',
    dimensionId: 'peer_help',
    emoji: '🌟',
    deltaPoints: 2,
    nameZh: '互助示范',
    nameEn: 'Peer Mentoring',
    descZh: '协助同伴答疑排错',
    descEn: 'Assisted peer in debugging',
    borderColor: 'border-sky-200 dark:border-sky-700/60',
    bgLight: 'bg-sky-50/80 hover:bg-sky-100/90 dark:bg-sky-950/30 dark:hover:bg-sky-900/40',
    textColor: 'text-sky-700 dark:text-sky-300',
  },
];

export interface ClassroomAttributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string | null;
  lessonId: string | null;
  students: StudentProfile[];
  initialStudent?: StudentProfile | null;
  lang?: 'zh' | 'en';
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onOpenLeaderboard?: () => void;
  onOpenStudentSandbox?: (student: StudentProfile) => void;
  onOpenProfile?: (student: StudentProfile) => void;
}

export function ClassroomAttributionModal({
  isOpen,
  onClose,
  classId,
  lessonId,
  students = [],
  initialStudent = null,
  lang = 'zh',
  addToast,
  onOpenLeaderboard,
  onOpenStudentSandbox,
  onOpenProfile,
}: ClassroomAttributionModalProps) {
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [recentBonusAnimation, setRecentBonusAnimation] = useState<string | null>(null);
  const [studentPointsMap, setStudentPointsMap] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInternalProfileOpen, setIsInternalProfileOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setRecentBonusAnimation(null);
      return;
    }

    if (initialStudent) {
      setSelectedStudent(initialStudent);
    } else if (students.length > 0) {
      const randIdx = Math.floor(Math.random() * students.length);
      setSelectedStudent(students[randIdx]);
    }
  }, [isOpen, initialStudent, students]);

  const handleShuffleStudent = useCallback(() => {
    if (students.length <= 1) return;
    setIsShuffling(true);

    let count = 0;
    const interval = setInterval(() => {
      const randIdx = Math.floor(Math.random() * students.length);
      setSelectedStudent(students[randIdx]);
      count++;
      if (count >= 10) {
        clearInterval(interval);
        setIsShuffling(false);
      }
    }, 50);
  }, [students]);

  const handleNextStudent = useCallback(() => {
    if (!selectedStudent || students.length === 0) return;
    const currentIdx = students.findIndex((s) => s.id === selectedStudent.id);
    const nextIdx = (currentIdx + 1) % students.length;
    setSelectedStudent(students[nextIdx]);
    setRecentBonusAnimation(null);
  }, [selectedStudent, students]);

  const handleAwardPoints = async (dimensionId: string, deltaPoints: number, reason: string) => {
    if (!selectedStudent) return;
    setIsSubmitting(true);

    try {
      if (classId) {
        await fetch(`/api/students/${selectedStudent.id}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            classId,
            dimensionId,
            deltaPoints,
            reason,
            pluginId: 'classroom-attribution',
          }),
        });
      }

      setStudentPointsMap((prev) => ({
        ...prev,
        [selectedStudent.id]: (prev[selectedStudent.id] ?? (selectedStudent.currentPoints ?? 0)) + deltaPoints,
      }));

      setRecentBonusAnimation(`${deltaPoints >= 0 ? '+' : ''}${deltaPoints} ${reason}`);
      setTimeout(() => setRecentBonusAnimation(null), 2500);

      addToast?.(
        lang === 'zh' ? '加分成功' : 'Points Awarded',
        `${selectedStudent.name} ${deltaPoints >= 0 ? '+' : ''}${deltaPoints} (${reason})`,
        'success',
      );
    } catch (err: any) {
      addToast?.('Error', err.message || 'Failed to award points', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentPoints = useMemo(() => {
    if (!selectedStudent) return 0;
    return studentPointsMap[selectedStudent.id] ?? (selectedStudent.currentPoints ?? 0);
  }, [selectedStudent, studentPointsMap]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-surface border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col select-none">
        <div className="px-5 py-3.5 border-b border-border/60 bg-surface-secondary/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-base">
              🎲
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-foreground">
                {lang === 'zh' ? '课堂抽问与表现激励' : 'Classroom Question & Attribution Points'}
              </h3>
              <p className="text-[11px] text-muted">
                {lang === 'zh' ? '即时评价学生表现，积分同步至小组与大屏勋章榜' : 'Live reward attribution synced to team leaderboard'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {selectedStudent ? (
            <div className="bg-surface-secondary/60 rounded-xl border border-border/80 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-[240px]">
                <div className="relative">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-primary-theme p-0.5 shadow-sm">
                    <div className="w-full h-full rounded-2xl bg-surface flex flex-col items-center justify-center text-primary-theme font-black">
                      <span className="text-[10px] leading-none text-muted font-mono">
                        {selectedStudent.seatNumber || '3组'}
                      </span>
                      <span className="text-base leading-none font-extrabold mt-0.5">
                        {selectedStudent.studentNo?.slice(-2) || '08'}
                      </span>
                    </div>
                  </div>
                  <span className="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded-full bg-emerald-500 text-white text-[9px] font-bold shadow-xs">
                    {lang === 'zh' ? '专注' : 'Active'}
                  </span>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-base font-extrabold text-foreground">{selectedStudent.name}</h4>
                    {selectedStudent.studentNo && (
                      <span className="text-[11px] text-muted font-mono">({selectedStudent.studentNo})</span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">
                      {selectedStudent.groupName || (lang === 'zh' ? '未分组' : 'Ungrouped')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-300/40 px-2 py-0.5 rounded-md">
                      <Trophy size={12} className="text-amber-500" />
                      <span>{lang === 'zh' ? '当前积分' : 'Points'}: <strong>{currentPoints}分</strong></span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-300/40 px-2 py-0.5 rounded-md">
                      <Flame size={12} className="text-emerald-500" />
                      <span>
                        {lang === 'zh' ? '专注度' : 'Focus'}:{' '}
                        <strong>
                          {typeof selectedStudent.focusScore === 'number'
                            ? `${selectedStudent.focusScore}%`
                            : '—'}
                        </strong>
                      </span>
                    </span>
                    <span className="text-muted text-[11px]">
                      {lang === 'zh'
                        ? `今日抽中 ${selectedStudent.pickedCountToday ?? 1} 次`
                        : `Picked ${selectedStudent.pickedCountToday ?? 1}x`}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (onOpenProfile && selectedStudent) {
                      onOpenProfile(selectedStudent);
                    } else {
                      setIsInternalProfileOpen(true);
                    }
                  }}
                  className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-3xs"
                  title={lang === 'zh' ? '查看学生五维成长雷达与学情档案' : 'View Growth Profile'}
                >
                  <TrendingUp size={14} className="text-indigo-600 dark:text-indigo-400" />
                  <span>{lang === 'zh' ? '学情档案' : 'Profile'}</span>
                </button>
                <button
                  onClick={handleShuffleStudent}
                  disabled={isShuffling}
                  className="px-3.5 py-2 bg-primary-theme hover:bg-primary-theme/90 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Shuffle size={14} className={isShuffling ? 'animate-spin' : ''} />
                  <span>{lang === 'zh' ? '重新抽取' : 'Shuffle'}</span>
                </button>
                <button
                  onClick={handleNextStudent}
                  className="px-3 py-2 bg-surface hover:bg-surface-secondary text-foreground border border-border rounded-xl text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                  title={lang === 'zh' ? '轮候下一位学生' : 'Next Student'}
                >
                  <span>{lang === 'zh' ? '下一位' : 'Next'}</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-muted text-xs">
              {lang === 'zh' ? '当前班级暂无学生' : 'No students found in current class'}
            </div>
          )}

          {recentBonusAnimation && (
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-700 dark:text-amber-300 flex items-center justify-between text-xs font-bold animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-amber-500 animate-bounce" />
                <span>{recentBonusAnimation}</span>
              </div>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                {lang === 'zh' ? '已实时累加' : 'Awarded live'}
              </span>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border/80 p-4 shadow-3xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <Medal size={14} className="text-amber-500" />
                <span className="text-xs font-bold text-foreground">
                  {lang === 'zh' ? '课堂即时表现评价与加分' : 'Classroom Attribution Awards'}
                </span>
                <span className="text-[11px] text-muted">
                  {lang === 'zh' ? '（自动累加至小组成绩）' : '(Aggregated to group)'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted text-[11px]">{lang === 'zh' ? '快速微调:' : 'Adjust:'}</span>
                {[
                  { label: '+1', delta: 1 },
                  { label: '+2', delta: 2 },
                  { label: '-1', delta: -1 },
                ].map((adj) => (
                  <button
                    key={adj.label}
                    onClick={() =>
                      handleAwardPoints(
                        'micro_adjust',
                        adj.delta,
                        lang === 'zh' ? `课堂即时微调 ${adj.label}` : `Micro adjustment ${adj.label}`,
                      )
                    }
                    disabled={isSubmitting || !selectedStudent}
                    className="px-2 py-0.5 rounded bg-surface-secondary hover:bg-primary-theme/10 hover:text-primary-theme text-foreground font-mono font-bold text-xs border border-border/80 transition cursor-pointer disabled:opacity-50"
                  >
                    {adj.label}
                  </button>
                ))}
              </div>
            </div>

            <ExtensionPointRenderer
              slot="anchor:classroom-attribution:awards"
              placement="before"
              slotProps={{
                student: selectedStudent,
                classId,
                lessonId,
                onAwardPoints: handleAwardPoints,
              }}
            />

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {BUILTIN_AWARDS.map((aw) => (
                <button
                  key={aw.id}
                  onClick={() =>
                    handleAwardPoints(
                      aw.dimensionId,
                      aw.deltaPoints,
                      lang === 'zh' ? `${aw.nameZh}：${aw.descZh}` : `${aw.nameEn}: ${aw.descEn}`,
                    )
                  }
                  disabled={isSubmitting || !selectedStudent}
                  className={`group p-2.5 rounded-xl border ${aw.borderColor} ${aw.bgLight} text-left transition relative flex flex-col justify-between shadow-3xs cursor-pointer active:scale-95 disabled:opacity-50`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-lg">{aw.emoji}</span>
                    <span
                      className={`text-xs font-extrabold ${aw.textColor} font-mono bg-surface px-1.5 py-0.2 rounded border border-border shadow-3xs`}
                    >
                      +{aw.deltaPoints}
                    </span>
                  </div>
                  <div className="font-bold text-xs text-foreground group-hover:text-primary-theme">
                    {lang === 'zh' ? aw.nameZh : aw.nameEn}
                  </div>
                  <div className="text-[10px] text-muted line-clamp-1">
                    {lang === 'zh' ? aw.descZh : aw.descEn}
                  </div>
                </button>
              ))}
            </div>

            <ExtensionPointRenderer
              slot="classroom.attribution.award"
              slotProps={{
                student: selectedStudent,
                classId,
                lessonId,
                onAwardPoints: handleAwardPoints,
              }}
            />

            <ExtensionPointRenderer
              slot="anchor:classroom-attribution:awards"
              placement="after"
              slotProps={{
                student: selectedStudent,
                classId,
                lessonId,
                onAwardPoints: handleAwardPoints,
              }}
            />
          </div>

          <div className="bg-surface-secondary/40 rounded-xl border border-border/70 p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                <Trophy size={14} />
              </span>
              <div>
                <div className="font-bold text-foreground">
                  {lang === 'zh'
                    ? `榜首小队：${students.length > 0 ? (students[0]?.groupName || '未分组') : '数据不足'}`
                    : `Top Group: ${students.length > 0 ? (students[0]?.groupName || 'Ungrouped') : 'No data'}`}
                </div>
                <div className="text-[10px] text-muted">
                  {lang === 'zh' ? '累计 104 积分 · 领跑全班' : '104 cumulative points · Leading'}
                </div>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-300/40">
              TOP 1
            </span>
          </div>
        </div>

        <div className="p-4 border-t border-border/60 bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {onOpenLeaderboard && (
              <button
                onClick={() => {
                  onClose();
                  onOpenLeaderboard();
                }}
                className="px-3.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-surface-secondary font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trophy size={13} className="text-amber-500" />
                <span>{lang === 'zh' ? '全班积分榜 & 批量加分' : 'Class Leaderboard'}</span>
              </button>
            )}
            {onOpenStudentSandbox && selectedStudent && (
              <button
                onClick={() => onOpenStudentSandbox(selectedStudent)}
                className="px-3 py-1.5 rounded-lg border border-border text-muted hover:text-foreground hover:bg-surface-secondary text-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <Code2 size={13} />
                <span>{lang === 'zh' ? '查验代码沙箱' : 'Inspect Code Sandbox'}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <ExtensionPointRenderer
              slot="classroom.attribution.action"
              slotProps={{
                student: selectedStudent,
                classId,
                lessonId,
                currentPoints,
              }}
            />

            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-primary-theme hover:bg-primary-theme/90 text-white rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
            >
              {lang === 'zh' ? '完成' : 'Done'}
            </button>
          </div>
        </div>
      </div>

      {/* 学生个人成长雷达与全景档案弹窗 (Stitch 07fd3861) */}
      {selectedStudent && (
        <StudentGrowthProfileModal
          isOpen={isInternalProfileOpen}
          onClose={() => setIsInternalProfileOpen(false)}
          student={{
            id: selectedStudent.id,
            name: selectedStudent.name,
            student_number: selectedStudent.studentNo,
            role: undefined,
            group_name: selectedStudent.groupName,
            points: currentPoints,
            focusPercentage: selectedStudent.focusScore,
            // 真实维度分数（缺失维度由弹窗显示「暂无数据」，不再硬编码 95/90/88/96/98）
            competencyScores: selectedStudent.competencyScores,
          }}
          lessonId={lessonId}
          classId={classId}
          lang={lang}
          addToast={addToast}
          onInspectSandbox={() => onOpenStudentSandbox?.(selectedStudent)}
          onAwardPoints={(_sId, delta, reason) => handleAwardPoints('attribution', delta, reason || '课堂表现')}
        />
      )}
    </div>
  );
}
