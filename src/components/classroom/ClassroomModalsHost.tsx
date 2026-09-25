/**
 * ClassroomModalsHost — 课堂模态框宿主
 *
 * 从 `LiveClassroomView`（2600+ 行 God 组件）中抽出的模态框编排层。
 *
 * 职责边界：
 *   - **只负责渲染**，不持有 state、不发请求、不含业务逻辑；
 *   - 所有开合状态与回调由 `LiveClassroomView` 传入（保持单一数据源）；
 *   - 目的：让 `LiveClassroomView` 的 JSX 只关心「课堂主体布局」，
 *     课堂新增弹窗时改本文件即可，不必再改动巨型组件。
 *
 * 包含的 6 个弹窗：
 *   StudentGrowthProfileModal  ─ 学生五维雷达档案（Stitch 07fd3861）
 *   PeerReviewShowcaseModal    ─ 全班大屏互评秀场（Stitch 21e2dac1）
 *   ParentNotificationModal    ─ 家校通知生成器（post-class）
 *   MasteryPredictionModal     ─ AI 实时学情预测（in-class）
 *   DiagnosticCenterModal      ─ 课堂异常告警中心（in-class）
 *   GroupCollabWhiteboardModal ─ 小组协作白板（in-class）
 */

import React from 'react';
import { StudentGrowthProfileModal } from '../../features/student/StudentGrowthProfileModal';
import { PeerReviewShowcaseModal } from '../../features/classroom/peer-review/PeerReviewShowcaseModal';
import { ParentNotificationModal } from '../../features/classroom/notifications/ParentNotificationModal';
import { MasteryPredictionModal } from '../../features/classroom/pacing/MasteryPredictionModal';
import { DiagnosticCenterModal } from '../../features/classroom/diagnostics/DiagnosticCenterModal';
import { GroupCollabWhiteboardModal } from '../../features/classroom/collab-whiteboard/GroupCollabWhiteboardModal';
import { ShowcaseDiffModal } from '../../features/classroom/showcase-diff/ShowcaseDiffModal';
import type { ClassroomLiveData } from '../../features/classroom/hooks/useClassroomLiveData';

type ToastFn = (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
type Lang = 'zh' | 'en';

export interface ClassroomModalsHostProps {
  // ── 通用 ──
  lang: Lang;
  addToast: ToastFn;
  selectedLesson: string | null;
  lessonTitle: string;
  className: string;
  liveClassSelectedClassId: string | null;
  classroomStage: string | null;
  sessionStartedAt: number | null;
  students: Array<{ id: string; name?: string; student_number?: string; [k: string]: unknown }>;
  /** 真实派生指标（参与度/亮点/环节节奏/已用时长） */
  liveData: ClassroomLiveData;

  // ── 学生成长档案 ──
  isGrowthProfileOpen: boolean;
  onCloseGrowthProfile: () => void;
  growthProfileStudentId: string | null;

  // ── 互评秀场 ──
  isPeerReviewShowcaseOpen: boolean;
  onClosePeerReviewShowcase: () => void;
  onAdvanceToStage3: () => void;
  peerReviewData: {
    workA: unknown;
    workB: unknown;
    matchingItems: unknown;
    badges: unknown;
    podiumStudents: unknown;
    danmaku: unknown;
    reactions: unknown;
    rubricDimensions: unknown;
    reviewProgress: { completed: number; total: number };
  };
  onAutoAssignPeerReview: () => void | Promise<void>;
  autoAssigning: boolean;

  // ── 家校通知 ──
  isParentNotificationOpen: boolean;
  onCloseParentNotification: () => void;

  // ── AI 学情预测 ──
  isMasteryPredictionOpen: boolean;
  onCloseMasteryPrediction: () => void;

  // ── 异常告警中心 ──
  isDiagnosticCenterOpen: boolean;
  onCloseDiagnosticCenter: () => void;

  // ── 小组协作白板 ──
  isGroupCollabOpen: boolean;
  onCloseGroupCollab: () => void;

  // ── 多屏对比投屏批注 ──
  isShowcaseDiffOpen?: boolean;
  onCloseShowcaseDiff?: () => void;
}

export const ClassroomModalsHost: React.FC<ClassroomModalsHostProps> = ({
  lang,
  addToast,
  selectedLesson,
  lessonTitle,
  className,
  liveClassSelectedClassId,
  classroomStage,
  sessionStartedAt,
  students,
  liveData,
  isGrowthProfileOpen,
  onCloseGrowthProfile,
  growthProfileStudentId,
  isPeerReviewShowcaseOpen,
  onClosePeerReviewShowcase,
  onAdvanceToStage3,
  peerReviewData,
  onAutoAssignPeerReview,
  autoAssigning,
  isParentNotificationOpen,
  onCloseParentNotification,
  isMasteryPredictionOpen,
  onCloseMasteryPrediction,
  isDiagnosticCenterOpen,
  onCloseDiagnosticCenter,
  isGroupCollabOpen,
  onCloseGroupCollab,
  isShowcaseDiffOpen,
  onCloseShowcaseDiff,
}) => {
  const now = Date.now();

  return (
    <>
      {/* ── 学生成长能力五维雷达档案（Stitch 07fd3861） ──
          由归因/积分榜弹窗传入 studentId 后打开；真实 competencyScores 缺失的
          维度显示「暂无数据」，不再回退到硬编码 95/90/88/96/98。 */}
      <StudentGrowthProfileModal
        isOpen={isGrowthProfileOpen}
        onClose={onCloseGrowthProfile}
        student={
          growthProfileStudentId
            ? (() => {
                const st = students.find((s) => s.id === growthProfileStudentId);
                if (!st) return null;
                return {
                  ...st,
                  // StudentProfileData.name 必填：回退学号再回退 id（可追溯，不伪装姓名）
                  name: (st.name as string) ?? st.student_number ?? st.id,
                } as never;
              })()
            : null
        }
        lessonId={selectedLesson}
        classId={liveClassSelectedClassId}
        lang={lang}
        addToast={addToast}
      />

      {/* ── 全班大屏作业互评秀场（Stitch 21e2dac1） ──
          展示数据全部来自 /api/classroom/sessions/:id/peer-review 真实聚合。 */}
      <PeerReviewShowcaseModal
        isOpen={isPeerReviewShowcaseOpen}
        onClose={onClosePeerReviewShowcase}
        lessonTitle={lessonTitle}
        addToast={addToast}
        onAdvanceToStage3={onAdvanceToStage3}
        workA={peerReviewData.workA as never}
        workB={peerReviewData.workB as never}
        matchingItems={peerReviewData.matchingItems as never}
        badges={peerReviewData.badges as never}
        podiumStudents={peerReviewData.podiumStudents as never}
        danmaku={peerReviewData.danmaku as never}
        reactions={peerReviewData.reactions as never}
        rubricDimensions={peerReviewData.rubricDimensions as never}
        reviewProgress={peerReviewData.reviewProgress}
        onAutoAssign={onAutoAssignPeerReview}
        autoAssigning={autoAssigning}
      />

      {/* ── 家校通知生成器（post-class） ── */}
      <ParentNotificationModal
        isOpen={isParentNotificationOpen}
        onClose={onCloseParentNotification}
        snapshot={{
          lessonTitle,
          lessonId: selectedLesson,
          className,
          classId: liveClassSelectedClassId,
          // 真实时间窗：优先 session.started_at，缺失时回退「现在」（不编造时长）
          startTimeMs: sessionStartedAt ?? now,
          endTimeMs: now,
          totalStudents: students.length,
          onlineStudentIds: liveData.studentMetrics.filter((m) => m.online).map((m) => m.studentId),
          highlights: liveData.highlights,
          stages: liveData.stages,
          students: liveData.studentMetrics.map((m) => ({
            id: m.studentId,
            name: m.studentName,
            student_number: m.studentNumber,
            participationScore: m.participationScore,
            quizScore: m.quizScore,
            behaviorTags: m.behaviorTags,
          })),
        }}
        addToast={addToast}
        lang={lang}
      />

      {/* ── AI 实时学情预测（in-class） ── */}
      <MasteryPredictionModal
        isOpen={isMasteryPredictionOpen}
        onClose={onCloseMasteryPrediction}
        lessonId={selectedLesson}
        lessonTitle={lessonTitle}
        currentStageName={classroomStage ?? 'IN_CLASS_TEACHING'}
        elapsedMin={liveData.elapsedMin}
        plannedTotalMin={liveData.plannedTotalMin}
        studentSnapshots={liveData.studentMetrics.map((m) => ({
          studentId: m.studentId,
          studentName: m.studentName,
          participationScore: m.participationScore,
          quizScore: m.quizScore,
          // 节奏由真实进度派生：≥80 领先、≥50 正常、>0 偏慢、=0 停滞
          paceIndicator:
            m.progressPercent >= 80
              ? ('fast' as const)
              : m.progressPercent >= 50
                ? ('on-track' as const)
                : m.progressPercent > 0
                  ? ('slow' as const)
                  : ('stalled' as const),
          behaviorSignals: m.behaviorTags,
        }))}
        addToast={addToast}
        lang={lang}
      />

      {/* ── 课堂异常告警中心（in-class） ── */}
      <DiagnosticCenterModal
        isOpen={isDiagnosticCenterOpen}
        onClose={onCloseDiagnosticCenter}
        addToast={addToast}
        lang={lang}
      />

      {/* ── 小组协作白板（in-class） ── */}
      <GroupCollabWhiteboardModal
        isOpen={isGroupCollabOpen}
        onClose={onCloseGroupCollab}
        lessonId={selectedLesson}
        classId={liveClassSelectedClassId}
        availableStudents={students.map((s) => ({
          id: s.id,
          name: s.name ?? s.student_number ?? s.id,
        }))}
        addToast={addToast}
        lang={lang}
      />

      {/* ── 优秀作业 / 屏幕一键多屏对比投屏批注（Showcase & Dual-Screen Diff） ── */}
      <ShowcaseDiffModal
        isOpen={Boolean(isShowcaseDiffOpen)}
        onClose={onCloseShowcaseDiff ?? (() => {})}
        lessonTitle={lessonTitle}
        availableStudents={students.map((s) => ({
          id: s.id,
          name: s.name ?? s.student_number ?? s.id,
          seatNumber: s.seat_number ?? (s as any).seatNumber,
        }))}
        addToast={addToast}
        lang={lang}
      />
    </>
  );
};
