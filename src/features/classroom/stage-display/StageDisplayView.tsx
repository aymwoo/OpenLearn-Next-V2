/**
 * 大屏展台 · 独立窗口视图
 *
 * 场景：教师点「大屏展台」→ 新开一个浏览器标签页/窗口投到副屏或投影 →
 * 授课界面留在主窗口继续操作。展台窗口**独立维持连接**（Socket 主导 +
 * 低频轮询兜底），教师切课节、切标签页都不会中断它的数据流。
 *
 * 「保持连接」的两个必要条件（本组件都做了）：
 *   1. 数据源不依赖主窗口的生命周期 —— 自己建连、自己轮询；
 *   2. 断连可见且能自愈 —— 顶栏连接指示灯 + 状态变化提示（投影上投出去的内容
 *      如果已经过期，学生是看得见的，必须让教师能发现）。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { listFromEnvelope } from '../../../utils/listEnvelope.js';
import { StageDisplayPanel } from './StageDisplayPanel';
import { NoticeStack, useNoticeQueue } from './StageNoticeStack';
import { useStageDisplayFeed, type StageDisplayData } from './useStageDisplayFeed';
import { connectionNotice, diffStageNotices, stageLabel } from './stage-notices';
import { usePeerReviewData } from '../hooks/usePeerReviewData';

export interface StageDisplayViewProps {
  lessonId: string | null;
  lessonTitle?: string;
  lang?: 'zh' | 'en';
}

export function StageDisplayView({ lessonId, lessonTitle = '互动课堂', lang = 'zh' }: StageDisplayViewProps) {
  const { data, health, lastSyncedAt } = useStageDisplayFeed(lessonId);
  const { notices, push, dismiss } = useNoticeQueue(lang);

  // 互评赏析：接入真实数据源（此前展台只传 lessonTitle，整个模块是空壳）
  const [peerReviewOpen, setPeerReviewOpen] = useState(false);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [teacherName, setTeacherName] = useState('');

  // 课件作答列表：互评焦点作品从真实 attempt 中选（不编造）
  useEffect(() => {
    if (!peerReviewOpen || !lessonId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/courseware/attempts?pageSize=all');
        if (res.ok && !cancelled) setAttempts(listFromEnvelope<any>(await res.json()));
      } catch {
        /* 无数据时保持空态 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peerReviewOpen, lessonId]);

  // 主讲教师姓名：用于互评批注署名，避免写死「陈老师」
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/auth/session');
        if (res.ok && !cancelled) {
          const body = await res.json();
          setTeacherName(String(body?.session?.name ?? body?.session?.username ?? ''));
        }
      } catch {
        /* 保持空串，UI 回退为「教师」 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const peerReview = usePeerReviewData({
    lessonId,
    enabled: peerReviewOpen,
    attempts,
    studentCount: data.attendance?.expected ?? 0,
    lang,
  });

  const peerReviewProps = useMemo(
    () => ({
      workA: peerReview.data.workA,
      workB: peerReview.data.workB,
      matchingItems: peerReview.data.matchingItems,
      badges: peerReview.data.badges,
      podiumStudents: peerReview.data.podiumStudents,
      danmaku: peerReview.data.danmaku,
      reactions: peerReview.data.reactions,
      rubricDimensions: peerReview.data.rubricDimensions,
      reviewProgress: peerReview.data.reviewProgress,
      onAutoAssign: peerReview.autoAssign,
      autoAssigning: peerReview.autoAssigning,
      // 已同步台数用本班在线真实人数，而不是写死的 32
      syncedStudentsCount: data.attendance?.onlineInClass,
      teacherName,
      stageLabel: stageLabel(data.stage, lang),
    }),
    [peerReview, data.attendance, teacherName, data.stage, lang],
  );

  // 上一帧快照（放 ref：变化检测不应触发额外渲染）
  const prevDataRef = useRef<StageDisplayData | null>(null);
  const firstFrameRef = useRef(true);
  const prevHealthRef = useRef(health);

  // 课程状态变化 → 提示
  useEffect(() => {
    if (firstFrameRef.current) {
      // 首帧不是「变化」，只记录基线
      firstFrameRef.current = false;
      prevDataRef.current = data;
      return;
    }
    const prev = prevDataRef.current;
    prevDataRef.current = data;
    if (!prev) return;

    push(diffStageNotices(prev, data, { lang, isFirstFrame: false }));
  }, [data, lang, push]);

  // 连接状态变化 → 提示（重连是无人值守场景最需要被看见的事）
  useEffect(() => {
    const notice = connectionNotice(health, prevHealthRef.current, lang);
    prevHealthRef.current = health;
    if (notice) push([notice]);
  }, [health, lang, push]);

  if (!lessonId) {
    return (
      <div className="fixed inset-0 z-[9999] bg-slate-950 text-slate-100 flex flex-col items-center justify-center gap-3">
        <div className="text-5xl">📺</div>
        <h1 className="text-2xl font-extrabold">
          {lang === 'zh' ? '大屏展台 · 等待课节' : 'Stage Display · Waiting for lesson'}
        </h1>
        <p className="text-slate-400 text-sm max-w-md text-center px-6">
          {lang === 'zh'
            ? '请在教师端「在线课堂」中选择要授课的课节，这里会自动接入对应课堂的实时数据。'
            : 'Select a lesson in the teacher console; the stage will connect to it automatically.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <StageDisplayPanel
        lessonId={lessonId}
        lessonTitle={lessonTitle}
        data={data}
        lang={lang}
        health={health}
        lastSyncedAt={lastSyncedAt}
        // 互评赏析接入真实数据（此前为空壳：只传 lessonTitle，弹窗内部全是空数组）
        peerReviewOpen={peerReviewOpen}
        onOpenPeerReview={() => setPeerReviewOpen(true)}
        onClosePeerReview={() => setPeerReviewOpen(false)}
        peerReview={peerReviewProps}
        // 独立窗口不提供「关闭」按钮：关掉标签页就是关闭，
        // 再给一个关当前页的按钮只是让教师误以为关闭了主窗口。
        showCloseButton={false}
      />
      <NoticeStack notices={notices} onDismiss={dismiss} lang={lang} />
    </>
  );
}
