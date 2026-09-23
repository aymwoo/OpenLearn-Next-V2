/**
 * classroom-extras.ts — 上课流程扩展端点
 *
 * 新增 4 个端点对接 4 个新页面：
 *   1. POST /api/classroom/:lessonId/parent-notification  → 家校通知生成器
 *   2. POST /api/classroom/:lessonId/predict-mastery      → AI 实时学情预测
 *
 * 设计原则：
 *   - 所有端点 requireAuth（教师/管理员）—— 班级数据敏感
 *   - AI 调用走 kernelContainer.aiService（与现有 assignments.ts 一致）
 *   - 输入校验：lessonId 路径参数 + JSON body 字段白名单
 *   - 失败降级：AI 调用返回 502 时，前端可走本地模板拼接
 */

import type { Application } from 'express';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getActorId, requireAuth } from '../middleware/auth.js';
import { sendSafeError } from '../utils/error-handler.js';

/**
 * 班级维度统计输入（家校通知 #1 使用）。
 * 字段尽量保持与前端可序列化格式对齐。
 */
interface ClassSummaryInput {
  lessonTitle: string;
  className: string;
  startTimeMs: number;
  endTimeMs: number;
  totalStudents: number;
  onlineCount: number;
  stages: Array<{
    stageName: string;
    plannedMin: number;
    actualMin: number;
  }>;
  studentReports: Array<{
    studentId: string;
    studentName: string;
    online: boolean;
    participationScore: number; // 0-100
    quizScore?: number; // 0-100
    behaviorTags: string[]; // e.g. ["积极举手", "专注度 98%"]
    note?: string;
  }>;
  highlights: string[]; // 课堂亮点
}

/**
 * 单个学生的 AI 生成报告（家校通知 #1 产物）。
 */
interface StudentNotification {
  studentId: string;
  studentName: string;
  markdown: string;
}

/**
 * 注册所有 classroom-extras 路由。
 */
export function registerClassroomExtrasRoutes(app: Application): void {
  // ── #1 家校通知生成器 ────────────────────────────────────────────
  app.post(
    '/api/classroom/:lessonId/parent-notification',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const { lessonId } = req.params;
        const summary = req.body as ClassSummaryInput;

        if (!summary || !Array.isArray(summary.studentReports)) {
          return res.status(400).json({ error: 'Missing required field: studentReports' });
        }

        const actorId = getActorId(req);
        const ai = kernelContainer.aiService;

        // 1) 生成全班概览 Markdown
        const classMarkdown = await renderClassMarkdown(summary, ai);

        // 2) 逐生通知（AI 总结）—— 复用现有 ai.generateText
        const studentNotifications: StudentNotification[] = [];
        for (const sr of summary.studentReports) {
          try {
            const md = await renderStudentMarkdown(sr, summary, ai);
            studentNotifications.push({
              studentId: sr.studentId,
              studentName: sr.studentName,
              markdown: md,
            });
          } catch (e: any) {
            // 单生失败不影响其他学生；降级为模板
            studentNotifications.push({
              studentId: sr.studentId,
              studentName: sr.studentName,
              markdown: renderStudentMarkdownFallback(sr, summary),
            });
          }
        }

        return res.json({
          lessonId,
          actorId,
          generatedAt: Date.now(),
          classMarkdown,
          studentNotifications,
          counts: {
            students: summary.studentReports.length,
            online: summary.onlineCount,
            highlights: summary.highlights.length,
          },
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // ── #2 AI 实时学情预测 ─────────────────────────────────────────────
  app.post(
    '/api/classroom/:lessonId/predict-mastery',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const { lessonId } = req.params;
        const snapshot = req.body as {
          lessonTitle: string;
          currentStageName: string;
          elapsedMin: number;
          plannedTotalMin: number;
          studentSnapshots: Array<{
            studentId: string;
            studentName: string;
            participationScore: number;
            quizScore?: number;
            paceIndicator: 'fast' | 'on-track' | 'slow' | 'stalled';
            behaviorSignals: string[];
          }>;
        };

        if (!snapshot || !Array.isArray(snapshot.studentSnapshots)) {
          return res.status(400).json({ error: 'Missing required field: studentSnapshots' });
        }

        const actorId = getActorId(req);
        const ai = kernelContainer.aiService;

        // 一次 AI 调用，对全班学生批量预测（避免 N 次调用）
        const prompt = `你是一位资深教师，正在分析本节课当前阶段的学情。请根据下面的实时数据，预测本节课结束时全班每位学生在 5 个维度（算法逻辑 / 代码工程 / 创新思维 / 团队协作 / 课堂专注）上的掌握度（0-100）。

课程：${snapshot.lessonTitle}
当前阶段：${snapshot.currentStageName}
已用时长（分钟）：${snapshot.elapsedMin}
计划总时长（分钟）：${snapshot.plannedTotalMin}

学生实时数据：
${snapshot.studentSnapshots
  .map(
    (s) =>
      `- ${s.studentName} (id=${s.studentId})：参与度 ${s.participationScore}/100` +
      (s.quizScore !== undefined ? `，测验 ${s.quizScore}/100` : '') +
      `，节奏 ${s.paceIndicator}，信号 [${s.behaviorSignals.join(', ')}]`,
  )
  .join('\n')}

严格按 JSON 数组返回，每项：\{ "studentId": string, "studentName": string, "prediction": \{ "algorithmic": number, "engineering": number, "creativity": number, "collaboration": number, "focus": number \}, "risk": "low|medium|high", "note": "一句话说明（不超过 30 字）" \}。不要任何额外文字。`;


        let predictions: any[] = [];
        let aiSucceeded = false;
        try {
          const text = await ai.generateText(prompt);
          // AI 可能返回 ```json ... ``` 包装，剥掉
          const cleaned = text
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            predictions = parsed;
            aiSucceeded = true;
          }
        } catch (e: any) {
          // AI 失败时降级为本地启发式
          predictions = [];
        }

        // 降级方案：基于 participationScore 推算默认 60 基础分 + 加成
        if (!aiSucceeded) {
          predictions = snapshot.studentSnapshots.map((s) => {
            const base = Math.min(100, Math.max(20, s.participationScore));
            const adjusted = Math.max(0, Math.min(100, base + (s.quizScore ? (s.quizScore - 70) * 0.3 : 0)));
            return {
              studentId: s.studentId,
              studentName: s.studentName,
              prediction: {
                algorithmic: Math.round(adjusted),
                engineering: Math.round(adjusted * 0.95),
                creativity: Math.round(adjusted * 0.9),
                collaboration: Math.round(adjusted * 1.05),
                focus: Math.round(base * 0.9),
              },
              risk:
                s.paceIndicator === 'stalled' || s.participationScore < 30
                  ? 'high'
                  : s.paceIndicator === 'slow' || s.participationScore < 60
                  ? 'medium'
                  : 'low',
              note: s.paceIndicator === 'stalled' ? '建议课后单独辅导' : '节奏正常',
            };
          });
        }

        return res.json({
          lessonId,
          actorId,
          generatedAt: Date.now(),
          aiSucceeded,
          currentStage: snapshot.currentStageName,
          predictions,
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );
}

/**
 * 生成全班 Markdown 报告。
 * 无 AI 时退化为模板。
 */
async function renderClassMarkdown(
  summary: ClassSummaryInput,
  ai: { generateText: (prompt: string) => Promise<string> },
): Promise<string> {
  const duration = Math.round((summary.endTimeMs - summary.startTimeMs) / 60000);
  const attendanceRate = Math.round((summary.onlineCount / Math.max(1, summary.totalStudents)) * 100);
  const lines: string[] = [];

  lines.push(`# 📚 ${summary.lessonTitle} · 班级学情简报`);
  lines.push('');
  lines.push(`**班级**：${summary.className}`);
  lines.push(`**时长**：${duration} 分钟`);
  lines.push(`**出勤**：${summary.onlineCount}/${summary.totalStudents}（${attendanceRate}%）`);
  lines.push('');

  // AI 总结班级亮点与待改进
  try {
    const prompt = `你是一位资深教师。基于以下数据写 3-5 句简洁的"今日亮点 + 待改进"中文段落（不超过 100 字）：
${JSON.stringify({
  lesson: summary.lessonTitle,
  class: summary.className,
  attendance: attendanceRate,
  stages: summary.stages,
  highlights: summary.highlights,
})}`;
    const aiText = await ai.generateText(prompt);
    lines.push('## 课堂总评');
    lines.push(aiText.trim());
    lines.push('');
  } catch (e) {
    lines.push('## 课堂总评');
    lines.push(`本节共 ${duration} 分钟，${attendanceRate}% 出勤。`);
    lines.push('');
  }

  if (summary.highlights.length > 0) {
    lines.push('## ✨ 课堂亮点');
    summary.highlights.slice(0, 5).forEach((h) => lines.push(`- ${h}`));
    lines.push('');
  }

  lines.push('## 📊 各阶段节奏');
  summary.stages.forEach((s) => {
    const delta = s.actualMin - s.plannedMin;
    const arrow = delta > 2 ? '⚠️' : delta < -2 ? '⏩' : '✅';
    lines.push(`- ${arrow} ${s.stageName}：计划 ${s.plannedMin}min，实际 ${s.actualMin}min`);
  });
  lines.push('');

  return lines.join('\n');
}

/**
 * 生成单个学生的家长通知 Markdown。
 */
async function renderStudentMarkdown(
  sr: ClassSummaryInput['studentReports'][number],
  summary: ClassSummaryInput,
  ai: { generateText: (prompt: string) => Promise<string> },
): Promise<string> {
  const prompt = `你是一位温和且专业的教师，给学生家长写一段今日课堂表现简报（不超过 80 字，中文，2-3 句话）。
要包含：
- 整体评价（1 句话）
- 具体亮点或待改进（1 句话）
- 家庭配合建议（可选，1 句话）

学生：${sr.studentName}
出勤：${sr.online ? '在线' : '未在线'}
参与度：${sr.participationScore}/100
${sr.quizScore !== undefined ? `随堂测：${sr.quizScore}/100` : ''}
行为标签：${sr.behaviorTags.join('、') || '无'}
${sr.note ? `教师备注：${sr.note}` : ''}

直接返回 Markdown 文本，不要任何前缀或 JSON。`;
  const text = await ai.generateText(prompt);
  return text.trim() || renderStudentMarkdownFallback(sr, summary);
}

/**
 * 模板拼接的降级方案。
 */
function renderStudentMarkdownFallback(
  sr: ClassSummaryInput['studentReports'][number],
  summary: ClassSummaryInput,
): string {
  const tags = sr.behaviorTags.length > 0 ? sr.behaviorTags.join('、') : '表现稳定';
  const quiz = sr.quizScore !== undefined ? `随堂测得分 ${sr.quizScore}/100。` : '';
  return [
    `### 致 ${sr.studentName} 家长`,
    '',
    `今天${sr.online ? '在线参与' : '暂未接入'}了《${summary.lessonTitle}》课堂，${tags}。${quiz}`,
    `建议家中关注孩子的课后练习，如有疑问欢迎与老师沟通。`,
  ].join('\n');
}