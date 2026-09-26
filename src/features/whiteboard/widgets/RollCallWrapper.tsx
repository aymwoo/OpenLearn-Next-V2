import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Trash2,
  UserCheck,
  HelpCircle,
  Shuffle,
  Award,
  ChevronDown,
  Layers,
  Coins,
  RefreshCw,
  CheckCircle,
} from 'lucide-react';
import {
  type PickerStudent,
  type PickerTier,
  type PickerMode,
  type EvaluationRating,
  EVALUATION_CONFIGS,
  filterCandidatesByTier,
  pickStudentFairly,
} from '../services/fair-picker-engine';
import { useAppStore } from '../../../store/appStore';
import { frontendEventBus } from '../../../services/event-bus';
import { v7 as uuidv7 } from 'uuid';
import { WidgetTitleBar } from './WidgetTitleBar';

export interface RollCallWrapperProps {
  elementId: string;
  data: any;
  lessonId?: string;
  classId?: string;
  onElementUpdate?: (id: string, data: any) => Promise<void>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onDelete: () => void;
  /** 只读跟随模式：隐藏删除等编辑按钮 */
  readOnly?: boolean;
  isMinimized?: boolean;
  isMaximized?: boolean;
  isPropertiesOpen?: boolean;
  onOpenProperties?: () => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  onMaximize?: () => void;
}

export function RollCallWrapper({
  elementId,
  data,
  lessonId,
  classId: propClassId,
  onElementUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDelete,
  readOnly = false,
  isMinimized = false,
  isMaximized = false,
  isPropertiesOpen = false,
  onOpenProperties,
  onMinimize,
  onRestore,
  onMaximize,
}: RollCallWrapperProps) {
  const classes = useAppStore((s) => s.classes) || [];
  const [selectedClassId, setSelectedClassId] = useState<string>(
    propClassId || data.classId || (classes[0]?.id ?? ''),
  );

  const [students, setStudents] = useState<PickerStudent[]>(() => {
    return (
      data.candidates ||
      data.allStudents || [
        { id: 'mock-s-1', name: '张明', student_number: '101', tier: 'basic', term_picked_count: 0, lesson_picked_count: 0 },
        { id: 'mock-s-2', name: '李华', student_number: '102', tier: 'intermediate', term_picked_count: 1, lesson_picked_count: 0 },
        { id: 'mock-s-3', name: '王超', student_number: '103', tier: 'advanced', term_picked_count: 2, lesson_picked_count: 0 },
        { id: 'mock-s-4', name: '赵丽', student_number: '104', tier: 'basic', term_picked_count: 0, lesson_picked_count: 0 },
        { id: 'mock-s-5', name: '钱科', student_number: '105', tier: 'intermediate', term_picked_count: 1, lesson_picked_count: 0 },
        { id: 'mock-s-6', name: '孙雪', student_number: '106', tier: 'advanced', term_picked_count: 3, lesson_picked_count: 0 },
      ]
    );
  });

  const [isLoadingStudents, setIsLoadingStudents] = useState<boolean>(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>(data.pickerMode || 'fair_all');
  const [difficulty, setDifficulty] = useState<PickerTier>(data.difficulty || 'intermediate');

  const [selectedStudent, setSelectedStudent] = useState<PickerStudent | null>(data.selectedStudent || null);
  const [isRolling, setIsRolling] = useState(false);
  const [tempDisplayStudent, setTempDisplayStudent] = useState<PickerStudent | null>(null);

  const [evaluation, setEvaluation] = useState<{
    rating: EvaluationRating;
    score: number;
    rewardCoins: number;
    submitted: boolean;
  } | null>(data.evaluation || null);

  // 从真实后端按班级拉取学生及提问频次画像
  useEffect(() => {
    if (!selectedClassId) return;

    let isMounted = true;
    setIsLoadingStudents(true);

    const fetchUrl = `/api/classes/${selectedClassId}/picker-candidates${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ''}`;
    fetch(fetchUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load class picker candidates');
        return res.json();
      })
      .then((list: PickerStudent[]) => {
        if (isMounted && Array.isArray(list) && list.length > 0) {
          setStudents(list);
        }
      })
      .catch((err) => {
        // 优雅降级保持当前列表
        console.warn('[RollCallWrapper] candidates fallback:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingStudents(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedClassId, lessonId]);

  // 根据当前提问模式过滤出的候选池
  const candidatePool = useMemo(() => {
    if (pickerMode === 'fair_all') {
      return students;
    }
    const { filtered } = filterCandidatesByTier(students, difficulty);
    return filtered;
  }, [students, pickerMode, difficulty]);

  // 执行公平/分层抽问
  const handleStartPick = () => {
    if (candidatePool.length === 0 || isRolling) return;

    setIsRolling(true);
    setEvaluation(null);

    let counter = 0;
    const totalFlips = 16;
    const intervalTime = 70;

    const interval = setInterval(() => {
      const randomIdx = Math.floor(Math.random() * candidatePool.length);
      setTempDisplayStudent(candidatePool[randomIdx]);
      counter++;

      if (counter >= totalFlips) {
        clearInterval(interval);

        // 使用公平加权算法挑选最终学生
        const result = pickStudentFairly(candidatePool);
        const picked = result ? result.student : candidatePool[0];

        setSelectedStudent(picked);
        setIsRolling(false);
        setTempDisplayStudent(null);

        // 本地更新该学生的 lesson_picked_count
        setStudents((prev) =>
          prev.map((s) =>
            s.id === picked.id
              ? { ...s, lesson_picked_count: (s.lesson_picked_count || 0) + 1 }
              : s,
          ),
        );

        // 持久化到白板图元数据
        if (onElementUpdate) {
          void onElementUpdate(elementId, {
            ...data,
            classId: selectedClassId,
            pickerMode,
            difficulty,
            selectedStudent: picked,
            pickedTime: new Date().toISOString(),
            status: 'picked',
            evaluation: null,
          });
        }

        // 广播抽中事件
        void frontendEventBus.publish({
          id: uuidv7(),
          type: 'rollcall.picked',
          source: 'rollcall.picker',
          payload: {
            elementId,
            studentId: picked.id,
            studentName: picked.name,
            classId: selectedClassId,
            lessonId,
          },
          timestamp: Date.now(),
        });
      }
    }, intervalTime);
  };

  // 教师打分并即时下发积分与成长金币
  const handleEvaluate = async (rating: EvaluationRating) => {
    if (!selectedStudent || evaluation?.submitted) return;

    const config = EVALUATION_CONFIGS[rating];
    const newEval = {
      rating,
      score: config.score,
      rewardCoins: config.rewardCoins,
      submitted: true,
    };
    setEvaluation(newEval);

    // 本地给学生增加金币
    setStudents((prev) =>
      prev.map((s) =>
        s.id === selectedStudent.id
          ? { ...s, total_reward_coins: (s.total_reward_coins || 0) + config.rewardCoins }
          : s,
      ),
    );

    // 调用服务端持久化接口
    try {
      await fetch('/api/rollcalls/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `rollcall-${elementId}-${selectedStudent.id}-${Date.now()}`,
          studentId: selectedStudent.id,
          studentName: selectedStudent.name,
          classId: selectedClassId,
          lessonId,
          rating,
          score: config.score,
          rewardCoins: config.rewardCoins,
          difficulty: pickerMode === 'tiered' ? difficulty : 'intermediate',
        }),
      });
    } catch (err) {
      console.error('[RollCallWrapper] evaluate rollcall failed:', err);
    }

    // 更新白板图元
    if (onElementUpdate) {
      void onElementUpdate(elementId, {
        ...data,
        evaluation: newEval,
      });
    }

    // 广播事件
    void frontendEventBus.publish({
      id: uuidv7(),
      type: 'rollcall.evaluated',
      source: 'rollcall.picker',
      payload: {
        elementId,
        studentId: selectedStudent.id,
        rating,
        rewardCoins: config.rewardCoins,
        score: config.score,
      },
      timestamp: Date.now(),
    });
  };

  return (
    <div
      className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 border border-indigo-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans select-none"
      style={{ pointerEvents: readOnly ? 'none' : 'auto' }}
    >
      {/* 顶部统一标题栏 & 拖拽把手 */}
      <WidgetTitleBar
        title="随机点名助手 (分层抽问 Fair Picker)"
        icon={<Sparkles size={13} className="animate-pulse text-amber-400" />}
        readOnly={readOnly}
        isMinimized={isMinimized}
        isMaximized={isMaximized}
        isPropertiesOpen={isPropertiesOpen}
        themeColor="indigo"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onOpenProperties={onOpenProperties}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onMaximize={onMaximize}
        onDelete={onDelete}
        extraActions={
          classes.length > 1 && !readOnly ? (
            <div className="relative mr-1" onPointerDown={(e) => e.stopPropagation()}>
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="bg-indigo-900/80 text-indigo-100 text-[11px] rounded px-1.5 py-0.5 border border-indigo-700/60 outline-hidden cursor-pointer"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id} className="bg-slate-900 text-white">
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null
        }
      />

      {!isMinimized && (
        <>
          {/* 模式选择栏 */}
      {!readOnly && (
        <div
          className="px-3 py-1.5 bg-indigo-950/40 border-b border-indigo-900/40 flex items-center justify-between gap-2 shrink-0 text-xs"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 bg-indigo-900/40 p-0.5 rounded-lg border border-indigo-800/40">
            <button
              onClick={() => setPickerMode('fair_all')}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                pickerMode === 'fair_all'
                  ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                  : 'text-indigo-300 hover:text-white'
              }`}
            >
              全员公平
            </button>
            <button
              onClick={() => setPickerMode('tiered')}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-all ${
                pickerMode === 'tiered'
                  ? 'bg-purple-600 text-white shadow-2xs font-bold'
                  : 'text-indigo-300 hover:text-white'
              }`}
            >
              分层抽问
            </button>
          </div>

          {pickerMode === 'tiered' && (
            <div className="flex items-center gap-1">
              {(['basic', 'intermediate', 'advanced'] as PickerTier[]).map((t) => {
                const label = t === 'basic' ? '基础' : t === 'intermediate' ? '进阶' : '拔高';
                const activeColor =
                  t === 'basic'
                    ? 'bg-emerald-600 text-white'
                    : t === 'intermediate'
                      ? 'bg-blue-600 text-white'
                      : 'bg-amber-600 text-white';
                return (
                  <button
                    key={t}
                    onClick={() => setDifficulty(t)}
                    className={`px-1.5 py-0.5 rounded text-xs font-medium transition-all ${
                      difficulty === t ? `${activeColor} font-bold shadow-2xs` : 'text-indigo-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 主展示区 */}
      <div className="flex-1 p-3 flex flex-col justify-between min-h-0 text-white gap-2">
        <div className="w-full flex-1 flex flex-col items-center justify-center p-2 rounded-lg bg-indigo-950/50 border border-indigo-900/30 relative overflow-hidden">
          {isRolling ? (
            <div className="text-center space-y-1.5 animate-pulse">
              <div className="text-xs text-indigo-300 uppercase tracking-widest font-semibold flex items-center justify-center gap-1.5">
                <Shuffle size={12} className="animate-spin text-amber-400" />
                <span>检索加权公平候选池中...</span>
              </div>
              <div className="text-2xl font-extrabold text-amber-300 scale-105 tracking-wider font-sans">
                {tempDisplayStudent?.name || '...'}
              </div>
              <div className="text-xs text-indigo-400/80 font-mono">
                学号: {tempDisplayStudent?.student_number || '---'}
              </div>
            </div>
          ) : selectedStudent ? (
            <div className="text-center space-y-1 w-full max-w-[260px]">
              <div className="text-xs text-indigo-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-1">
                <UserCheck size={12} className="text-emerald-400" />
                <span>抽中的幸运答题者</span>
              </div>
              <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-300 tracking-wider">
                {selectedStudent.name}
              </div>
              <div className="flex items-center justify-center gap-2 text-xs text-indigo-300/80 font-mono">
                <span>学号 {selectedStudent.student_number || selectedStudent.id}</span>
                <span>•</span>
                <span>已回答 {selectedStudent.lesson_picked_count || 0} 次</span>
                {selectedStudent.total_reward_coins !== undefined && (
                  <>
                    <span>•</span>
                    <span className="text-amber-400 flex items-center gap-0.5 font-bold">
                      <Coins size={10} />
                      {selectedStudent.total_reward_coins}
                    </span>
                  </>
                )}
              </div>

              {/* 即时评价与金币奖章面板 */}
              <div
                className="mt-2 pt-2 border-t border-indigo-900/50 w-full"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {evaluation?.submitted ? (
                  <div className="bg-indigo-900/60 border border-emerald-500/40 rounded-lg p-1.5 flex items-center justify-center gap-2 text-xs">
                    <CheckCircle size={14} className="text-emerald-400" />
                    <span className="font-bold text-emerald-300">
                      已评定: {EVALUATION_CONFIGS[evaluation.rating].badge}{' '}
                      {EVALUATION_CONFIGS[evaluation.rating].label}
                    </span>
                    <span className="text-amber-300 font-bold flex items-center gap-0.5">
                      +{evaluation.rewardCoins} 金币
                    </span>
                  </div>
                ) : !readOnly ? (
                  <div className="space-y-1">
                    <div className="text-2xs text-indigo-300/70 text-center font-medium">
                      作答表现评定与激励下发：
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {(['excellent', 'good', 'encourage'] as EvaluationRating[]).map((r) => {
                        const cfg = EVALUATION_CONFIGS[r];
                        return (
                          <button
                            key={r}
                            onClick={() => void handleEvaluate(r)}
                            className="bg-indigo-900/80 hover:bg-indigo-800 border border-indigo-700/60 hover:border-amber-400/80 text-white rounded py-1 px-1 flex flex-col items-center gap-0.5 transition-all active:scale-95 cursor-pointer shadow-3xs group"
                          >
                            <span className="text-sm group-hover:scale-110 transition-transform">
                              {cfg.badge}
                            </span>
                            <span className="text-2xs font-semibold">{cfg.label}</span>
                            <span className="text-3xs text-amber-300 font-mono">+{cfg.rewardCoins}币</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="text-center space-y-1">
              <HelpCircle size={26} className="text-indigo-400/80 mx-auto animate-pulse" />
              <div className="text-xs text-indigo-300 font-semibold">随机抽取与分层轮盘</div>
              <p className="text-2xs text-indigo-400/60 leading-tight">
                频次反比加权算法 • 支持基础/进阶/拔高分层抽问
              </p>
            </div>
          )}
        </div>

        {/* 底部动作按钮与状态 */}
        <div
          className="w-full shrink-0 flex flex-col items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleStartPick}
            disabled={isRolling || candidatePool.length === 0}
            className="w-full py-1.5 bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-md active:scale-98 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Shuffle size={12} className={isRolling ? 'animate-spin' : ''} />
            <span>
              {isRolling
                ? '加权滚轮运转中...'
                : selectedStudent
                  ? '抽取下一位学生'
                  : '开始随机点名'}
            </span>
          </button>

          <div className="text-2xs text-indigo-400/60 text-center font-mono flex items-center justify-center gap-1.5">
            <span>候选池：{candidatePool.length} 人</span>
            <span>•</span>
            <span>
              {pickerMode === 'fair_all' ? '全员公平' : `分层: ${difficulty}`}
            </span>
            {isLoadingStudents && (
              <RefreshCw size={9} className="animate-spin text-indigo-400" />
            )}
          </div>
        </div>
      </div>
      </>
    )}
  </div>
);
}
