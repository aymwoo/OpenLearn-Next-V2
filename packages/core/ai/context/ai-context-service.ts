/**
 * OpenLearn AI Infrastructure - AI Context Service
 * Aggregates Lesson, Stage, Whiteboard, Analytics, Student, and Teacher contexts into structured AI prompts.
 */

import { AIContextObject } from '../types/index.js';

export class AIContextService {
  /**
   * Build a unified system/context prompt string from individual context slices.
   */
  public buildCombinedContext(ctx: AIContextObject): string {
    const parts: string[] = [];

    if (ctx.teacherContext) {
      parts.push(`[Teacher Context]\n${ctx.teacherContext}`);
    }
    if (ctx.studentContext) {
      parts.push(`[Student Context]\n${ctx.studentContext}`);
    }
    if (ctx.lessonContext) {
      parts.push(`[Lesson Context]\n${ctx.lessonContext}`);
    }
    if (ctx.stageContext) {
      parts.push(`[Stage Context]\n${ctx.stageContext}`);
    }
    if (ctx.whiteboardContext) {
      parts.push(`[Whiteboard Context]\n${ctx.whiteboardContext}`);
    }
    if (ctx.analyticsContext) {
      parts.push(`[Analytics Context]\n${ctx.analyticsContext}`);
    }

    return parts.join('\n\n');
  }
}
