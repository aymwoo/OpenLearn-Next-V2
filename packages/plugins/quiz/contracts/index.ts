/**
 * ext-quiz-generator 类型契约（V3.2）
 *
 * 向其他插件暴露可复用的评分统计服务。
 * 消费方通过 import type + ctx.resolve(Token) 获得编译期类型安全和运行时实例。
 */

import { Token } from '@openlearn/plugin-sdk';

// ── 接口 ────────────────────────────────────────────────────────────────

export interface QuizSubmission {
  studentId: string;
  lessonId: string;
  answer: string;
  correct: boolean;
  timestamp: number;
}

export interface QuizStats {
  totalSubmissions: number;
  correctCount: number;
  accuracy: number; // 0-100
}

export interface IQuizStatsService {
  /** 记录一次提交 */
  recordSubmission(submission: QuizSubmission): void;
  /** 获取某课程的统计 */
  getStats(lessonId: string): QuizStats;
  /** 获取全部提交记录 */
  getAllSubmissions(): QuizSubmission[];
}

// ── Token ────────────────────────────────────────────────────────────────

export const QuizStatsServiceToken = new Token<IQuizStatsService>(
  'ext-quiz-generator:IQuizStatsService',
  '1.0.0',
);
