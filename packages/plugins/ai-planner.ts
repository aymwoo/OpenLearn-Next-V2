import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IProcessServiceToken,
  IDatabaseToken,
  IEventBusServiceToken,
} from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';
import { applyGradeChange, isPrivilegedGradeActor } from '../core/db/assignment-grade-writer.js';

interface AiPlannerPayload {
  taskType: string;
  topic?: string;
  classId?: string;
  duration?: number;
}

export const AiPlannerPlugin = {
  manifest: {
    id: '@openlearn/plugin-ai-planner',
    name: 'AI 规划器插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IProcessService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
    ],
    capabilitiesProposed: ['process:write', 'lesson:write', 'assignment:write'],
    engines: { openlearn: '>=0.2.5' },
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);
    const processManager = ctx.services.processManager;

    // 1. Setup the long-running task handler for generating content/schedules
    await processManager.registerHandler('ai_planner_task', async (processId, payloadArg, state, log, updateState) => {
      const payload = payloadArg as AiPlannerPayload;
      log(`[AI Planner] Started generation task: ${payload.taskType}`);
      const duration = payload.duration || 5;

      for (let i = 0; i < duration; i++) {
        const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
        if (p && p.status === 'killed') {
          log(`Process was killed.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
        updateState({ step: i + 1 });
        log(`[AI Planner] Analyzing payload... step ${i + 1}/${duration}`);
      }

      log(`[AI Planner] Analysis complete. Generating proposal...`);

      const proposalTitle = `AI Suggested ${payload.taskType === 'quiz' ? 'Quiz' : 'Plan'}: ${payload.topic}`;
      const proposalContent = `This is an auto-generated content/extension for ${payload.topic} produced by the AI Agent. Please review and approve.`;

      try {
        await commandBus.execute({
          id: uuidv7(),
          type: 'ai.apply_recommendation',
          actorId: 'system',
          timestamp: Date.now(),
          payload: {
            taskType: payload.taskType,
            topic: payload.topic,
            classId: payload.classId,
            title: proposalTitle,
            content: proposalContent,
          },
        });
        log(`[AI Planner] Proposal automatically approved and applied.`);
      } catch (e: any) {
        log(`[AI Planner] Proposal sent to Approvals Gateway. Waiting for teacher's approval.`);
      }
      log(`Process completed.`);
    });

    // 2. Action to spawn the AI Planner process
    await actionRegistry.register({
      id: 'ai-planner-generate',
      commandType: 'ai.start_generation',
      description:
        '指示 AI Agent 在后台自动规划课程表、作业或测验，返回进程 ID。AI 将生成方案并在审批网关中等待教师审批。',
      capabilityRequired: 'process:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          taskType: {
            type: 'STRING',
            description: '生成类型："schedule"（排课）、"quiz"（测验）或 "lesson_material"（课程资料）',
          },
          topic: { type: 'STRING', description: '要生成的主题/科目' },
          classId: { type: 'STRING', description: '班级 ID（如适用）' },
          duration: { type: 'NUMBER', description: '预计所需时间（秒）' },
        },
        required: ['taskType', 'topic', 'duration'],
      },
    });

    await commandBus.registerHandler('ai.start_generation', {
      async execute(command) {
        const payload = command.payload as any;
        const processId = await processManager.spawn(`AI Generator: ${payload.topic}`, 'ai_planner_task', {
          taskType: payload.taskType,
          topic: payload.topic,
          classId: payload.classId,
          duration: payload.duration,
        });
        return { processId, message: 'Process started in the background.' };
      },
    });

    // 3. High-Risk Action to apply recommendation (caught by Approval)
    await actionRegistry.register({
      id: 'ai-planner-apply',
      commandType: 'ai.apply_recommendation',
      description: '应用 AI 建议的教学计划、测验或课件。高风险操作 - 需要审批。',
      capabilityRequired: 'lesson:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          taskType: { type: 'STRING' },
          topic: { type: 'STRING' },
          classId: { type: 'STRING' },
          title: { type: 'STRING' },
          content: { type: 'STRING' },
        },
        required: ['taskType', 'topic'],
      },
    });

    await commandBus.registerHandler('ai.apply_recommendation', {
      async execute(command) {
        const payload = command.payload as any;
        const id = uuidv7();

        if (payload.taskType === 'lesson_material') {
          const stmt = db.prepare(
            'INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          );
          stmt.run(id, payload.title, payload.content, Date.now(), Date.now());
        } else if (payload.taskType === 'quiz' || payload.taskType === 'assignment') {
          let cid = payload.classId;
          if (!cid) {
            const firstClass = db.prepare('SELECT id FROM classes LIMIT 1').get() as any;
            cid = firstClass ? firstClass.id : null;
          }
          if (cid) {
            const stmt = db.prepare(
              'INSERT INTO assignments (id, class_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            );
            stmt.run(id, cid, payload.title, 'AI Generated Quiz/Assignment', payload.content, Date.now());
          }
        } else if (payload.taskType === 'schedule') {
          let cid = payload.classId;
          if (!cid) {
            const firstClass = db.prepare('SELECT id FROM classes LIMIT 1').get() as any;
            cid = firstClass ? firstClass.id : null;
          }
          if (cid) {
            const stmt = db.prepare(
              'INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)',
            );
            const firstLesson = db.prepare('SELECT id FROM lessons LIMIT 1').get() as any;
            const lessonId = firstLesson ? firstLesson.id : null;
            const nextDay = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            stmt.run(id, cid, lessonId, nextDay, Date.now());
          }
        }

        return { success: true, appliedId: id, details: `Applied ${payload.taskType} AI recommendation successfully.` };
      },
    });

    // 4. High-Risk Action for Grading (Teacher must approve and can edit score)
    await actionRegistry.register({
      id: 'ai-grade-apply',
      commandType: 'ai.apply_grade',
      description: '应用 AI 生成的学生作业成绩。高风险操作 - 需要审批，教师可修改分数。',
      capabilityRequired: 'assignment:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING' },
          studentId: { type: 'STRING' },
          score: { type: 'NUMBER' },
          feedback: { type: 'STRING' },
          overrideManual: {
            type: 'BOOLEAN',
            description: '是否允许覆盖教师手动分（仅教师/管理员显式确认时生效）',
          },
        },
        required: ['assignmentId', 'studentId', 'score', 'feedback'],
      },
    });

    await commandBus.registerHandler('ai.apply_grade', {
      async execute(command) {
        const payload = command.payload as any;
        const actorId = command.actorId || 'system';
        // AI 默认只覆盖自动/AI 生成的成绩；只有教师/管理员显式要求改判时才越过手动分。
        const result = applyGradeChange(db, {
          assignmentId: payload.assignmentId,
          studentId: payload.studentId,
          score: payload.score,
          feedback: payload.feedback || '',
          status: 'graded',
          source: 'ai',
          actorId,
          reason: 'ai-apply-grade',
          createIfMissing: false,
          overrideProtected: payload.overrideManual === true && isPrivilegedGradeActor(actorId),
        });

        if (!result.ok) {
          const message =
            result.reason === 'manual-protected'
              ? '教师已手动录入该生成绩，AI 批改未覆盖（如需改判请由教师显式确认）'
              : result.reason === 'absent-protected'
                ? '该生已被标记缺考，AI 批改未覆盖'
                : result.reason === 'submission-not-found'
                  ? '学生尚未提交该作业，无法应用成绩'
                  : 'AI 成绩无效或目标不存在';
          const err: any = new Error(message);
          err.reason = result.reason;
          throw err;
        }

        await eventBus.publish({
          id: uuidv7(),
          type: 'assignment.graded',
          source: 'ai.planner',
          payload: {
            assignmentId: payload.assignmentId,
            studentId: payload.studentId,
            score: result.newScore,
            feedback: payload.feedback || '',
          },
          timestamp: Date.now(),
          correlationId: command.id,
        });

        return {
          success: true,
          details: `Applied grade ${result.newScore} successfully.`,
          changed: result.changed,
          historyId: result.historyId,
        };
      },
    });
  },
  deactivate: async () => {
    // Handlers automatically disposed by ResourceTracker
  },
};

/** @deprecated Deprecated in Phase 8. Built-in plugins are auto-loaded by the Kernel using PluginHost. */
export function bootstrapAIPlannerPlugins() {
  // Deprecated. Left as no-op.
}
