/**
 * 大屏展台：课程状态变化检测与提示生成
 *
 * 独立窗口常驻副屏/投影，无人操作，因此状态突变必须**主动提示**，
 * 否则教师在讲台上不会发现「投票已经结束了 / 环节已经推进」。
 *
 * 纯函数 diff（便于单测），把 (上一帧, 当前帧) 翻译成一组提示。
 */
import type { StageDisplayData } from './useStageDisplayFeed';

// 便于测试与其他模块从本文件取类型（数据结构的归属在本文件，来源在 useStageDisplayFeed）
export type { StageDisplayData };

export type NoticeTone = 'info' | 'success' | 'warning' | 'accent';

export interface StageNotice {
  id: string;
  tone: NoticeTone;
  icon: string;
  title: string;
  detail?: string;
  /** 相同的 key 在短时间内合并计数，避免投票刷屏 */
  dedupeKey: string;
}

export const STAGE_LABELS: Record<string, { zh: string; en: string }> = {
  PRE_CLASS_READY: { zh: '课前就绪 · 准备上课', en: 'Pre-Class Preparation' },
  IN_CLASS_TEACHING: { zh: '课中授课 · 互动探索', en: 'Interactive Teaching' },
  WRAP_UP_EXIT_TICKET: { zh: '总结提升 · 结课通票', en: 'Wrap-Up & Exit Ticket' },
  ARCHIVED_REPORT: { zh: '下课归档 · 学情简报', en: 'Archived Report' },
};

export function stageLabel(stage: string, lang: 'zh' | 'en' = 'zh'): string {
  const hit = STAGE_LABELS[stage];
  if (!hit) return stage;
  return lang === 'zh' ? hit.zh : hit.en;
}

/** 生成一次对比的稳定 id：同一状态重复出现时提示会收敛而不是无限增长 */
let noticeSeq = 0;
function nextId(prefix: string): string {
  noticeSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${noticeSeq}`;
}

export interface DiffOptions {
  lang?: 'zh' | 'en';
  /** 首帧为 true 时不提示（首次加载不是"变化"） */
  isFirstFrame?: boolean;
}

/**
 * 比较前后两帧，产出一组状态变化提示。
 *
 * 覆盖的"课程状态"：
 *  - 课堂环节推进（stage）
 *  - 极速投票：开始 / 结束
 *  - 抢答：开始 / 产生赢家 / 重置
 *  - 结课通票阶段的到来（由 stage 变化体现）
 */
export function diffStageNotices(
  prev: StageDisplayData | null,
  next: StageDisplayData,
  options: DiffOptions = {},
): StageNotice[] {
  const { lang = 'zh', isFirstFrame = false } = options;
  const zh = lang === 'zh';
  const notices: StageNotice[] = [];

  if (!prev || isFirstFrame) return notices;

  // ── 1. 环节推进 ──────────────────────────────────────────────
  if (prev.stage !== next.stage) {
    const label = stageLabel(next.stage, lang);
    const isEnding = next.stage === 'ARCHIVED_REPORT';
    const isWrapUp = next.stage === 'WRAP_UP_EXIT_TICKET';

    // 逐项判断而非嵌套三元：嵌套三元在混排中括号极易读错
    let detail: string | undefined;
    if (isWrapUp) {
      detail = zh ? '请提醒学生在设备上完成 60 秒结课通票' : 'Remind students to complete the 60s exit ticket';
    } else if (isEnding) {
      detail = zh ? '本课节已归档，大屏将展示学情简报' : 'Lesson archived; the stage will show the learning report';
    }

    let tone: NoticeTone = 'info';
    let icon = '🎓';
    if (isWrapUp) {
      tone = 'accent';
      icon = '🎫';
    } else if (isEnding) {
      tone = 'warning';
      icon = '📦';
    }

    notices.push({
      id: nextId('stage'),
      tone,
      icon,
      title: zh ? `课堂环节已切换：${label}` : `Stage changed: ${label}`,
      detail,
      dedupeKey: `stage:${next.stage}`,
    });
  }

  // ── 2. 极速投票 ──────────────────────────────────────────────
  const prevPollId = prev.activePoll?.id ?? null;
  const nextPollId = next.activePoll?.id ?? null;

  if (nextPollId && nextPollId !== prevPollId) {
    notices.push({
      id: nextId('poll-start'),
      tone: 'accent',
      icon: '⚡',
      title: zh ? '课堂极速投票已开始' : 'Quick poll started',
      detail: next.activePoll?.title ? String(next.activePoll.title) : undefined,
      dedupeKey: `poll-start:${nextPollId}`,
    });
  } else if (prevPollId && !nextPollId) {
    const total = prev.activePoll?.totalVotes ?? 0;
    notices.push({
      id: nextId('poll-end'),
      tone: 'info',
      icon: '📊',
      title: zh ? '课堂投票已结束' : 'Quick poll closed',
      detail: zh ? `本轮共 ${total} 人作答` : `${total} responded in this round`,
      dedupeKey: `poll-end:${prevPollId}`,
    });
  }

  // ── 3. 抢答器 ────────────────────────────────────────────────
  const prevBuzzerId = prev.activeBuzzer?.id ?? null;
  const nextBuzzerId = next.activeBuzzer?.id ?? null;
  const prevBuzzerStatus = prev.activeBuzzer?.status ?? null;
  const nextBuzzerStatus = next.activeBuzzer?.status ?? null;

  if (nextBuzzerId && nextBuzzerId !== prevBuzzerId) {
    notices.push({
      id: nextId('buzz-start'),
      tone: 'accent',
      icon: '🔔',
      title: zh ? '抢答已开始' : 'Buzz-in started',
      detail: next.activeBuzzer?.title ? String(next.activeBuzzer.title) : undefined,
      dedupeKey: `buzz-start:${nextBuzzerId}`,
    });
  } else if (
    nextBuzzerId &&
    nextBuzzerId === prevBuzzerId &&
    nextBuzzerStatus === 'LOCKED' &&
    prevBuzzerStatus !== 'LOCKED'
  ) {
    const winner = next.activeBuzzer?.winnerName;
    const ms = next.activeBuzzer?.responseTimeMs;
    notices.push({
      id: nextId('buzz-winner'),
      tone: 'success',
      icon: '🏆',
      title: zh ? '抢答已产生赢家' : 'Buzz-in winner decided',
      detail: winner
        ? zh
          ? `${winner}${ms ? ` · 响应用时 ${ms} 毫秒` : ''}`
          : `${winner}${ms ? ` · ${ms} ms` : ''}`
        : undefined,
      dedupeKey: `buzz-winner:${nextBuzzerId}`,
    });
  } else if (
    nextBuzzerId &&
    nextBuzzerId === prevBuzzerId &&
    nextBuzzerStatus === 'READY' &&
    prevBuzzerStatus === 'LOCKED'
  ) {
    notices.push({
      id: nextId('buzz-reset'),
      tone: 'info',
      icon: '♻️',
      title: zh ? '抢答已重置，可以开始新一轮' : 'Buzzer reset — ready for a new round',
      dedupeKey: `buzz-reset:${nextBuzzerId}`,
    });
  }
  void prevBuzzerId;
  void nextBuzzerId;

  return notices;
}

/**
 * 连接状态变化的提示文案（与课程状态提示共用一套队列）。
 */
export function connectionNotice(
  health: 'live' | 'reconnecting' | 'polling' | 'error',
  previous: 'live' | 'reconnecting' | 'polling' | 'error' | null,
  lang: 'zh' | 'en' = 'zh',
): StageNotice | null {
  const zh = lang === 'zh';
  if (health === previous) return null;

  if (health === 'reconnecting') {
    return {
      id: nextId('conn'),
      tone: 'warning',
      icon: '📡',
      title: zh ? '实时连接已断开，正在重连' : 'Live connection lost, reconnecting…',
      detail: zh ? '大屏内容可能不是最新，将以低频轮询兜底' : 'Falling back to low-frequency polling',
      dedupeKey: 'conn:reconnecting',
    };
  }
  if (health === 'live' && previous === 'reconnecting') {
    return {
      id: nextId('conn'),
      tone: 'success',
      icon: '✅',
      title: zh ? '实时连接已恢复' : 'Live connection restored',
      dedupeKey: 'conn:live',
    };
  }
  return null;
}
