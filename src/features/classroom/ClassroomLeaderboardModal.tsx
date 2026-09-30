import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Trophy,
  Users,
  Award,
  Sparkles,
  X,
  Medal,
  ChevronDown,
  ChevronUp,
  Star,
  Flame,
  Send,
  Plus,
  Minus,
  TrendingUp,
} from 'lucide-react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import type { StudentProfile } from './ClassroomAttributionModal';
import { StudentGrowthProfileModal } from '../student/StudentGrowthProfileModal';
import { onSocketInstance } from '../../services/socket-service';

export interface ClassroomGroup {
  id: string;
  name: string;
  totalScore: number;
  rank: number;
  members: StudentProfile[];
  growthScore?: number;
  /** 服务端 `class_groups.color`（如 `bg-indigo-500`） */
  color?: string;
  /** 组长学生 id（`class_groups.leader_id`） */
  leaderId?: string | null;
}

/** `GET /api/classes/:id/groups` 的返回项（`member_ids` 已由服务端解析为 `memberIds`） */
interface ClassGroupRow {
  id: string;
  name: string;
  name_en?: string | null;
  color?: string | null;
  memberIds: string[];
  leader_id?: string | null;
  is_default?: boolean;
  sort_order?: number | null;
}

export interface ClassroomLeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: string | null;
  lessonId: string | null;
  students?: StudentProfile[];
  lang?: 'zh' | 'en';
  addToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onSelectStudentToAward?: (student: StudentProfile) => void;
  onViewStudentProfile?: (student: StudentProfile) => void;
}

export function ClassroomLeaderboardModal({
  isOpen,
  onClose,
  classId,
  lessonId,
  students = [],
  lang = 'zh',
  addToast,
  onSelectStudentToAward,
  onViewStudentProfile,
}: ClassroomLeaderboardModalProps) {
  const [activeTab, setActiveTab] = useState<'groups' | 'individual'>('groups');
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>('group-1');
  const [bonusAnimation, setBonusAnimation] = useState<string | null>(null);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<StudentProfile | null>(null);
  /** 服务端分组方案（唯一真源：`class_groups`） */
  const [classGroupRows, setClassGroupRows] = useState<ClassGroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  /** 避免同一班级的重复拉取（socket 事件 + 打开弹窗可能同时触发） */
  const groupsFetchedForRef = useRef<string | null>(null);

  const fetchClassGroups = useCallback(async () => {
    if (!classId) {
      setClassGroupRows([]);
      groupsFetchedForRef.current = null;
      return;
    }
    setGroupsLoading(true);
    try {
      const res = await fetch(`/api/classes/${encodeURIComponent(classId)}/groups`);
      if (!res.ok) throw new Error('Failed to load class groups');
      const data = await res.json();
      setClassGroupRows(Array.isArray(data) ? data : []);
      groupsFetchedForRef.current = classId;
    } catch (err) {
      // 拉取失败保持空数组 → UI 展示空态，绝不退回另一套数据源编造分组
      console.warn('[ClassroomLeaderboardModal] load class groups failed:', err);
      setClassGroupRows([]);
    } finally {
      setGroupsLoading(false);
    }
  }, [classId]);

  // 打开弹窗 / 切换班级时取一次
  useEffect(() => {
    if (!isOpen) return;
    void fetchClassGroups();
  }, [isOpen, fetchClassGroups]);

  /**
   * 分组方案变更后自动重拉。
   *
   * 此前 `classroom:groups_changed` 有 producer 却接不上：唯一的分组 UI 读的是
   * 另一套数据源（且那套数据从未被写入）。改为读本接口后，这条事件才真正可接。
   * 组件内直接订阅（`onSocketInstance` 处理 socket 晚到），按 classId 过滤。
   */
  useEffect(() => {
    if (!isOpen || !classId) return;
    let detach: (() => void) | null = null;
    const off = onSocketInstance((socket) => {
      const handler = (payload: any) => {
        if (!payload || payload.classId !== classId) return;
        void fetchClassGroups();
      };
      detach?.();
      socket.on('classroom:groups_changed', handler);
      detach = () => socket.off('classroom:groups_changed', handler);
    });
    return () => {
      off();
      detach?.();
    };
  }, [isOpen, classId, fetchClassGroups]);

  /**
   * 小组分组与积分 —— 全部基于真实数据：
   *   分组   ← `GET /api/classes/:id/groups`（`class_groups` 表，含 name/color/leader/memberIds）
   *   成员   ← 该组 `memberIds` 与 `students`（课堂花名册）按学生 id 求交集
   *   总分   ← 组内成员 currentPoints 之和
   *   成长分 ← 平台无「本节增量」历史快照表，故不显示（旧版为 +14/+10 等硬编码假值）
   *
   * 为什么要改成读接口：此前按 `students[].groupName` 自行 `useMemo` 分组，而
   * **`students.group_name` 全仓从未被写入**（服务端无 UPDATE、前端无赋值），
   * 于是分组页一直只渲染出一个「未分组」桶。真正的分组数据写在 `class_groups`，
   * 两套数据源互不相通 —— 这也是 `classroom:groups_changed` 事件有 producer
   * 却接不上消费端的原因：即使接了，那个 UI 也读不到 `class_groups` 的内容。
   *
   * 无分组数据时返回空数组，UI 展示空态，而不是回退到另一套数据源或伪造队名
   * —— 保持单一真源，否则会重新制造这次的歧义。
   */
  const groups: ClassroomGroup[] = useMemo(() => {
    if (classGroupRows.length === 0) return [];

    const byId = new Map(students.map((st) => [st.id, st]));

    return classGroupRows
      .map((row) => {
        // 只取仍在花名册里的成员：分组方案可能引用已转学的学生
        const members = (row.memberIds ?? []).map((id) => byId.get(id)).filter(Boolean) as StudentProfile[];
        // 真实总分 = 组内成员真实积分之和（无积分记录 → 0）
        const totalScore = members.reduce((acc, m) => acc + (m.currentPoints ?? 0), 0);
        return {
          id: row.id,
          name: (lang === 'en' && row.name_en?.trim() ? row.name_en : row.name) || row.id,
          totalScore,
          rank: 0, // 排名在下方排序后统一赋值
          members,
          // growthScore 留空：平台无「本节增量」真实来源，不编造
          growthScore: undefined,
          color: row.color ?? undefined,
          leaderId: row.leader_id ?? null,
        };
      })
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((g, idx) => ({ ...g, rank: idx + 1 }));
  }, [classGroupRows, students, lang]);

  /**
   * 学生 → 所属组名。个人榜里展示的小组标签改用同一真源，
   * 避免与分组页出现两套不同的组名（旧代码读始终为空的 `students.groupName`）。
   */
  const groupNameByStudentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of classGroupRows) {
      const name = (lang === 'en' && row.name_en?.trim() ? row.name_en : row.name) || row.id;
      for (const id of row.memberIds ?? []) map.set(id, name);
    }
    return map;
  }, [classGroupRows, lang]);

  const groupNameOf = useCallback(
    (studentId: string) => groupNameByStudentId.get(studentId) || (lang === 'zh' ? '未分组' : 'Ungrouped'),
    [groupNameByStudentId, lang],
  );

  // Handle whole-group batch awards (Stitch 00e4f919)
  const handleAwardWholeGroup = (groupId: string, groupName: string, deltaPoints: number, reason: string) => {
    setBonusAnimation(`${groupName} 全员 +${deltaPoints} (${reason})`);
    setTimeout(() => setBonusAnimation(null), 3000);

    addToast?.(
      lang === 'zh' ? '小组集体加分' : 'Team Points Awarded',
      `${groupName} 全员 +${deltaPoints} (${reason})`,
      'success',
    );
  };

  const handleSyncToStageDisplay = () => {
    addToast?.(
      lang === 'zh' ? '大屏榜单已同步' : 'Stage Display Synced',
      lang === 'zh' ? '当前积分榜动效已实时推送到教室主大屏幕' : 'Leaderboard broadcasted to stage display',
      'info',
    );
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-3xl bg-surface border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col select-none max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border/60 bg-surface-secondary/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-base">
              🏆
            </span>
            <div>
              <h3 className="font-extrabold text-sm text-foreground">
                {lang === 'zh' ? '全班积分榜与小组积分明细' : 'Class Points & Team Leaderboard'}
              </h3>
              <p className="text-[11px] text-muted">
                {lang === 'zh'
                  ? '随堂表现实时积分累加，激发小组合作共进'
                  : 'Live classroom performance points & teamwork league'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Tabs */}
            <div className="flex items-center p-0.5 rounded-lg bg-surface border border-border text-xs">
              <button
                onClick={() => setActiveTab('groups')}
                className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  activeTab === 'groups' ? 'bg-primary-theme text-white shadow-3xs' : 'text-muted hover:text-foreground'
                }`}
              >
                {lang === 'zh' ? '小组联赛' : 'Teams'}
              </button>
              <button
                onClick={() => setActiveTab('individual')}
                className={`px-3 py-1 rounded-md font-bold transition-all cursor-pointer ${
                  activeTab === 'individual'
                    ? 'bg-primary-theme text-white shadow-3xs'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                {lang === 'zh' ? '个人英雄榜' : 'Individual'}
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Celebratory Banner */}
        {bonusAnimation && (
          <div className="mx-5 mt-4 p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/50 text-amber-700 dark:text-amber-300 flex items-center justify-between text-xs font-bold animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500 animate-bounce" />
              <span>{bonusAnimation}</span>
            </div>
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              {lang === 'zh' ? '大屏同步广播' : 'Synced to Stage'}
            </span>
          </div>
        )}

        {/* Content Body */}
        <div className="p-5 space-y-3.5 overflow-y-auto flex-1">
          {activeTab === 'groups' ? (
            <div className="space-y-3">
              {groups.map((group) => {
                const isExpanded = expandedGroupId === group.id;
                const rankColor =
                  group.rank === 1
                    ? 'bg-amber-500 text-white'
                    : group.rank === 2
                      ? 'bg-slate-400 text-white'
                      : group.rank === 3
                        ? 'bg-amber-700/80 text-white'
                        : 'bg-surface-secondary text-muted';

                return (
                  <div
                    key={group.id}
                    className="border border-border/80 rounded-xl bg-surface-secondary/20 overflow-hidden shadow-3xs transition-all"
                  >
                    {/* Group Header Card */}
                    <div className="p-3.5 flex flex-wrap items-center justify-between gap-3 bg-surface hover:bg-surface-secondary/30 transition">
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-lg ${rankColor} font-mono font-extrabold text-xs flex items-center justify-center`}
                        >
                          {group.rank}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-extrabold text-sm text-foreground">{group.name}</h4>
                            <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded font-bold">
                              {typeof group.growthScore === 'number'
                                ? lang === 'zh'
                                  ? `本节 +${group.growthScore}`
                                  : `+${group.growthScore}`
                                : ''}
                            </span>
                          </div>
                          <span className="text-[11px] text-muted">
                            {lang === 'zh'
                              ? `组内成员 ${group.members.length} 人 · 均分 ${Math.round(group.totalScore / group.members.length)} 分`
                              : `${group.members.length} members`}
                          </span>
                        </div>
                      </div>

                      {/* Right: Score + Batch Award buttons + Toggle */}
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-base font-extrabold text-primary-theme pr-2">
                          {group.totalScore}
                          <span className="text-xs font-normal text-muted ml-0.5">{lang === 'zh' ? '分' : 'pts'}</span>
                        </span>

                        {/* Whole Group Award Pill 1: 团队协作之星 */}
                        <button
                          onClick={() =>
                            handleAwardWholeGroup(
                              group.id,
                              group.name,
                              2,
                              lang === 'zh' ? '团队协作之星：组内积极帮扶答疑' : 'Team Collaboration Star',
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          title={lang === 'zh' ? '整组每人 +2 协作分' : 'Whole group +2 Collaboration points'}
                        >
                          <Star size={12} />
                          <span>+2 {lang === 'zh' ? '协作' : 'Collab'}</span>
                        </button>

                        {/* Whole Group Award Pill 2: 全员全勤奖 */}
                        <button
                          onClick={() =>
                            handleAwardWholeGroup(
                              group.id,
                              group.name,
                              1,
                              lang === 'zh' ? '全员全勤奖：按时到齐投入学习' : 'Perfect Attendance Award',
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                          title={lang === 'zh' ? '整组每人 +1 全勤分' : 'Whole group +1 Attendance points'}
                        >
                          <Medal size={12} />
                          <span>+1 {lang === 'zh' ? '全勤' : 'Attendance'}</span>
                        </button>

                        {/* Expand members button */}
                        <button
                          onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                          className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-secondary transition cursor-pointer"
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Group Members Drilldown List (Stitch 783386a9) */}
                    {isExpanded && (
                      <div className="px-4 py-2.5 bg-surface-secondary/40 border-t border-border/60 space-y-1.5 animate-in slide-in-from-top-1 duration-150">
                        {group.members.map((member) => (
                          <div
                            key={member.id}
                            className="p-2 rounded-lg bg-surface border border-border/60 flex items-center justify-between text-xs hover:border-primary-theme/40 transition"
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="w-5 h-5 rounded-md bg-surface-secondary text-muted font-mono font-bold text-[10px] flex items-center justify-center">
                                {member.seatNumber?.slice(-2) || '01'}
                              </span>
                              <span className="font-bold text-foreground">{member.name}</span>
                              <span className="text-[11px] text-muted font-mono">{member.studentNo}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-foreground">
                                {member.currentPoints ?? 28} <span className="text-[10px] text-muted">分</span>
                              </span>
                              <button
                                onClick={() => {
                                  if (onViewStudentProfile) {
                                    onViewStudentProfile(member);
                                  } else {
                                    setSelectedStudentForProfile(member);
                                  }
                                }}
                                className="px-2 py-0.5 rounded bg-surface-secondary hover:bg-surface text-foreground font-semibold text-[11px] transition border border-border cursor-pointer flex items-center gap-0.5"
                                title={lang === 'zh' ? '查看学情档案' : 'View Profile'}
                              >
                                <TrendingUp size={11} className="text-primary-theme" />
                                <span>{lang === 'zh' ? '档案' : 'Profile'}</span>
                              </button>
                              {onSelectStudentToAward && (
                                <button
                                  onClick={() => {
                                    onClose();
                                    onSelectStudentToAward(member);
                                  }}
                                  className="px-2 py-0.5 rounded bg-primary-theme/10 hover:bg-primary-theme/20 text-primary-theme font-semibold text-[11px] transition cursor-pointer"
                                >
                                  {lang === 'zh' ? '单人评价' : 'Award'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 空态 / 加载态：分组方案来自 class_groups，未配置分组时如实展示，
                  不回退到 students.groupName（该字段全仓从未被写入，回退等于编造） */}
              {groups.length === 0 && (
                <div className="py-10 px-4 text-center">
                  {groupsLoading ? (
                    <p className="text-xs text-muted animate-pulse">
                      {lang === 'zh' ? '正在加载分组方案…' : 'Loading group plans…'}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted font-semibold">
                        {lang === 'zh' ? '本班尚未配置分组方案' : 'No group plan configured for this class'}
                      </p>
                      <p className="text-2xs text-muted/80 mt-1">
                        {lang === 'zh'
                          ? '可在「班级分组」中创建分组后在此查看小组联赛'
                          : 'Create groups under Class Groups to see the team league here'}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Individual Leaderboard Tab */
            <div className="space-y-1.5">
              {students.map((student, idx) => (
                <div
                  key={student.id}
                  className="p-3 rounded-xl border border-border/80 bg-surface flex items-center justify-between text-xs hover:bg-surface-secondary/30 transition shadow-3xs"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-lg font-mono font-bold text-xs flex items-center justify-center ${
                        idx === 0
                          ? 'bg-amber-500 text-white'
                          : idx === 1
                            ? 'bg-slate-400 text-white'
                            : idx === 2
                              ? 'bg-amber-700/80 text-white'
                              : 'bg-surface-secondary text-muted'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-foreground">{student.name}</span>
                        <span className="px-1.5 py-0.2 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-bold">
                          {groupNameOf(student.id)}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted font-mono">{student.studentNo}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                      <Flame size={12} />
                      <span>{typeof student.focusScore === 'number' ? `${student.focusScore}%` : '—'}</span>
                    </span>
                    <span className="font-mono font-extrabold text-sm text-primary-theme">
                      {student.currentPoints ?? 0} <span className="text-xs font-normal text-muted">分</span>
                    </span>
                    <button
                      onClick={() => {
                        if (onViewStudentProfile) {
                          onViewStudentProfile(student);
                        } else {
                          setSelectedStudentForProfile(student);
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-surface-secondary hover:bg-surface text-foreground font-semibold text-xs transition border border-border cursor-pointer flex items-center gap-1 shadow-3xs"
                      title={lang === 'zh' ? '查看学情成长雷达档案' : 'View Growth Profile'}
                    >
                      <TrendingUp size={12} className="text-primary-theme" />
                      <span>{lang === 'zh' ? '档案' : 'Profile'}</span>
                    </button>
                    {onSelectStudentToAward && (
                      <button
                        onClick={() => {
                          onClose();
                          onSelectStudentToAward(student);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-primary-theme/10 hover:bg-primary-theme/20 text-primary-theme font-bold text-xs transition cursor-pointer"
                      >
                        {lang === 'zh' ? '加分' : 'Award'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/60 bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={handleSyncToStageDisplay}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Send size={13} />
            <span>{lang === 'zh' ? '同步至班级大屏勋章榜' : 'Sync to Stage Display'}</span>
          </button>

          <div className="flex items-center gap-2">
            {/* Third-Party Plugin Extension Slot */}
            <ExtensionPointRenderer slot="classroom.leaderboard.action" slotProps={{ classId, lessonId, groups }} />

            <button
              onClick={onClose}
              className="px-4 py-1.5 border border-border text-foreground hover:bg-surface-secondary rounded-lg text-xs font-semibold transition cursor-pointer"
            >
              {lang === 'zh' ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      </div>

      {/* 学生个人成长雷达与全景档案弹窗 (Stitch 07fd3861) */}
      {selectedStudentForProfile && (
        <StudentGrowthProfileModal
          isOpen={!!selectedStudentForProfile}
          onClose={() => setSelectedStudentForProfile(null)}
          student={{
            id: selectedStudentForProfile.id,
            name: selectedStudentForProfile.name,
            student_number: selectedStudentForProfile.studentNo,
            group_name: groupNameOf(selectedStudentForProfile.id),
            points: selectedStudentForProfile.currentPoints,
            focusPercentage: selectedStudentForProfile.focusScore,
          }}
          lessonId={lessonId}
          classId={classId}
          lang={lang}
          addToast={addToast}
        />
      )}
    </div>
  );
}
