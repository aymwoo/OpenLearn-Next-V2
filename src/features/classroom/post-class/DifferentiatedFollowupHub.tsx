import React, { useState } from 'react';
import {
  Send,
  CheckCircle2,
  Sparkles,
  BookOpen,
  HelpCircle,
  TrendingUp,
  Layers,
  ArrowRight,
  UserCheck,
} from 'lucide-react';
import type { FollowupTierGroup, FollowupTierType, TierStudentItem } from './types';

export interface DifferentiatedFollowupHubProps {
  initialTiers: FollowupTierGroup[];
  lessonTitle: string;
  onDispatchHomework?: (dispatchedTiers: FollowupTierGroup[]) => void;
  onSelectStudent?: (studentId: string) => void;
  addToast: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function DifferentiatedFollowupHub({
  initialTiers,
  lessonTitle,
  onDispatchHomework,
  onSelectStudent,
  addToast,
}: DifferentiatedFollowupHubProps) {
  const [tiers, setTiers] = useState<FollowupTierGroup[]>(initialTiers);
  const [isDispatched, setIsDispatched] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  const totalAssigned = tiers.reduce((acc, t) => acc + t.students.length, 0);

  const handleMoveStudent = (
    student: TierStudentItem,
    fromTier: FollowupTierType,
    toTier: FollowupTierType,
  ) => {
    if (fromTier === toTier) return;
    setTiers((prev) =>
      prev.map((group) => {
        if (group.tier === fromTier) {
          return {
            ...group,
            students: group.students.filter((s) => s.studentId !== student.studentId),
          };
        }
        if (group.tier === toTier) {
          return {
            ...group,
            students: [...group.students, student],
          };
        }
        return group;
      }),
    );
    setIsDispatched(false);
  };

  const handleDispatchAll = () => {
    setDispatching(true);
    setTimeout(() => {
      setDispatching(false);
      setIsDispatched(true);
      if (onDispatchHomework) {
        onDispatchHomework(tiers);
      }
      addToast(
        '✓ 差异化课后任务已成功派发',
        `已向全班 ${totalAssigned} 名同学精准分流推送对应学习资源包。`,
        'success',
      );
    }, 600);
  };

  return (
    <div className="bg-surface rounded-2xl border border-theme p-5 shadow-sm flex flex-col gap-4">
      {/* 头部控制区 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-theme pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary-theme/10 text-primary-theme flex items-center justify-center font-bold">
            <Layers size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-main tracking-tight flex items-center gap-2">
              <span>差异化课后巩固派发中枢 (Differentiated Follow-up Hub)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary-theme/10 text-primary-theme">
                AI 自动分流
              </span>
            </h2>
            <p className="text-xs text-muted">
              依据测验表现与 Exit Ticket 卡点自动聚类，支持微调并一键派发至学生端。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDispatched && (
            <span className="text-xs text-emerald-600 font-bold flex items-center gap-1 bg-emerald-500/10 px-2.5 py-1 rounded-xl border border-emerald-500/20">
              <CheckCircle2 size={13} />
              <span>已全员派发到位</span>
            </span>
          )}

          <button
            type="button"
            id="btn-dispatch-differentiated-tasks"
            onClick={handleDispatchAll}
            disabled={dispatching || totalAssigned === 0}
            className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all shadow-xs cursor-pointer ${
              isDispatched
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-primary-theme text-white hover:bg-primary-theme-hover'
            } disabled:opacity-50`}
          >
            <Send size={13} className={dispatching ? 'animate-spin' : ''} />
            <span>
              {dispatching
                ? '派发中...'
                : isDispatched
                  ? '重新派发任务包'
                  : `一键派发至全班 (${totalAssigned}人)`}
            </span>
          </button>
        </div>
      </div>

      {/* 三梯队卡片容器 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((group) => {
          const isA = group.tier === 'TIER_A_ADVANCED';
          const isB = group.tier === 'TIER_B_STANDARD';
          const isC = group.tier === 'TIER_C_REINFORCE';

          const borderBg = isA
            ? 'border-emerald-500/30 bg-emerald-500/5'
            : isB
              ? 'border-blue-500/30 bg-blue-500/5'
              : 'border-amber-500/30 bg-amber-500/5';

          const titleColor = isA
            ? 'text-emerald-700 dark:text-emerald-400'
            : isB
              ? 'text-blue-700 dark:text-blue-400'
              : 'text-amber-700 dark:text-amber-400';

          const badgeBg = isA
            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
            : isB
              ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-300';

          return (
            <div
              key={group.tier}
              className={`rounded-2xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${borderBg}`}
            >
              <div className="flex flex-col gap-2.5">
                {/* 梯队标题 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {isA && <Sparkles size={16} className="text-emerald-600" />}
                    {isB && <TrendingUp size={16} className="text-blue-600" />}
                    {isC && <HelpCircle size={16} className="text-amber-600" />}
                    <span className={`text-xs font-black ${titleColor}`}>{group.title}</span>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badgeBg}`}>
                    {group.students.length} 人
                  </span>
                </div>

                <p className="text-[11px] text-muted leading-tight">{group.subtitle}</p>

                {/* 资源包摘要 */}
                <div className="p-2.5 rounded-xl bg-surface border border-theme/80 flex flex-col gap-1 shadow-2xs">
                  <span className="text-[11px] font-bold text-main line-clamp-1">
                    {group.packageTitle}
                  </span>
                  <p className="text-[10px] text-muted line-clamp-2 leading-relaxed">
                    {group.packageDescription}
                  </p>
                </div>
              </div>

              {/* 归属学生胶囊列表 */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-muted">
                  <span>成员名单 ({group.students.length})</span>
                  <span className="text-[10px]">点击切换梯队</span>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1 bg-surface/50 rounded-xl border border-theme/50">
                  {group.students.length === 0 ? (
                    <span className="text-[11px] text-muted/60 p-2 italic w-full text-center">
                      暂无归入此梯队的同学
                    </span>
                  ) : (
                    group.students.map((student) => (
                      <div
                        key={student.studentId}
                        className="group relative flex items-center gap-1 px-2 py-1 rounded-lg bg-surface border border-theme text-[11px] font-medium text-main hover:border-primary-theme transition-all shadow-2xs"
                      >
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => onSelectStudent && onSelectStudent(student.studentId)}
                          title="点击查看个人课节报告"
                        >
                          {student.studentName}
                        </span>
                        {student.quizScore !== null && (
                          <span className="text-[9px] font-mono text-muted">
                            ({student.quizScore}分)
                          </span>
                        )}

                        {/* 快捷微调梯队下拉/按钮 */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-1 transition-opacity">
                          {!isA && (
                            <button
                              type="button"
                              title="上调至 A 梯队"
                              onClick={() =>
                                handleMoveStudent(student, group.tier, 'TIER_A_ADVANCED')
                              }
                              className="text-[9px] px-1 py-0.2 bg-emerald-500/20 text-emerald-600 rounded hover:bg-emerald-500/40"
                            >
                              ↑A
                            </button>
                          )}
                          {!isB && (
                            <button
                              type="button"
                              title="调整至 B 梯队"
                              onClick={() =>
                                handleMoveStudent(student, group.tier, 'TIER_B_STANDARD')
                              }
                              className="text-[9px] px-1 py-0.2 bg-blue-500/20 text-blue-600 rounded hover:bg-blue-500/40"
                            >
                              B
                            </button>
                          )}
                          {!isC && (
                            <button
                              type="button"
                              title="下调至 C 梯队"
                              onClick={() =>
                                handleMoveStudent(student, group.tier, 'TIER_C_REINFORCE')
                              }
                              className="text-[9px] px-1 py-0.2 bg-amber-500/20 text-amber-600 rounded hover:bg-amber-500/40"
                            >
                              ↓C
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
