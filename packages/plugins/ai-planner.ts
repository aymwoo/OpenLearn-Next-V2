import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IProcessServiceToken,
  IDatabaseToken,
  IEventBusServiceToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export const AiPlannerPlugin = {
  manifest: {
    id: '@openlearn/plugin-ai-planner',
    name: 'AI Planner Plugin',
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
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);
    const processManager = ctx.services.processManager;

    // 1. Setup the long-running task handler for generating content/schedules
    await processManager.registerHandler('ai_planner_task', async (processId, payload, state, log, updateState) => {
      log(`[AI Planner] Started generation task: ${payload.taskType}`);
      const duration = payload.duration || 5;

      for (let i = 0; i < duration; i++) {
        const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
        if (p && p.status === 'killed') {
          log(`Process was killed.`);
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
        updateState({ step: i + 1 });
        log(`[AI Planner] Analyzing data... step ${i+1}/${duration}`);
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
            content: proposalContent
          }
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
      description: 'Instruct AI Agent to automatically plan course schedule, assignments, or quizzes in the background. It returns a process ID. The AI will eventually propose the changes for teacher approval in the Approvals gateway.',
      capabilityRequired: 'process:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          taskType: { type: 'STRING', description: 'Type of generation: "schedule", "quiz", or "lesson_material"' },
          topic: { type: 'STRING', description: 'The subject/topic to generate' },
          classId: { type: 'STRING', description: 'Class ID (if applicable)' },
          duration: { type: 'NUMBER', description: 'Time it should take (in seconds)' }
        },
        required: ['taskType', 'topic', 'duration']
      }
    });

    await commandBus.registerHandler('ai.start_generation', {
      async execute(command) {
        const payload = command.payload as any;
        const processId = await processManager.spawn(
          `AI Generator: ${payload.topic}`,
          'ai_planner_task',
          { taskType: payload.taskType, topic: payload.topic, classId: payload.classId, duration: payload.duration }
        );
        return { processId, message: 'Process started in the background.' };
      }
    });

    // 3. High-Risk Action to apply recommendation (caught by Approval)
    await actionRegistry.register({
      id: 'ai-planner-apply',
      commandType: 'ai.apply_recommendation',
      description: 'Apply the AI suggested teaching plan, quiz, or material. HIGH RISK - REQUIRES APPROVAL.',
      capabilityRequired: 'lesson:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          taskType: { type: 'STRING' },
          topic: { type: 'STRING' },
          classId: { type: 'STRING' },
          title: { type: 'STRING' },
          content: { type: 'STRING' }
        },
        required: ['taskType', 'topic']
      }
    });

    await commandBus.registerHandler('ai.apply_recommendation', {
      async execute(command) {
        const payload = command.payload as any;
        const id = uuidv7();
        
        if (payload.taskType === 'lesson_material') {
          const stmt = db.prepare('INSERT INTO lessons (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
          stmt.run(id, payload.title, payload.content, Date.now(), Date.now());
        } else if (payload.taskType === 'quiz' || payload.taskType === 'assignment') {
          let cid = payload.classId;
          if (!cid) {
            const firstClass = db.prepare('SELECT id FROM classes LIMIT 1').get() as any;
            cid = firstClass ? firstClass.id : null;
          }
          if (cid) {
            const stmt = db.prepare('INSERT INTO assignments (id, class_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            stmt.run(id, cid, payload.title, 'AI Generated Quiz/Assignment', payload.content, Date.now());
          }
        } else if (payload.taskType === 'schedule') {
          let cid = payload.classId;
          if (!cid) {
            const firstClass = db.prepare('SELECT id FROM classes LIMIT 1').get() as any;
            cid = firstClass ? firstClass.id : null;
          }
          if (cid) {
            const stmt = db.prepare('INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)');
            const firstLesson = db.prepare('SELECT id FROM lessons LIMIT 1').get() as any;
            const lessonId = firstLesson ? firstLesson.id : null;
            const nextDay = new Date(Date.now() + 86400000).toISOString().split('T')[0];
            stmt.run(id, cid, lessonId, nextDay, Date.now());
          }
        }
        
        return { success: true, appliedId: id, details: `Applied ${payload.taskType} AI recommendation successfully.` };
      }
    });

    // 4. High-Risk Action for Grading (Teacher must approve and can edit score)
    await actionRegistry.register({
      id: 'ai-grade-apply',
      commandType: 'ai.apply_grade',
      description: 'Apply AI generated grade for a student submission. HIGH RISK - REQUIRES APPROVAL. Teacher can modify score.',
      capabilityRequired: 'assignment:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING' },
          studentId: { type: 'STRING' },
          score: { type: 'NUMBER' },
          feedback: { type: 'STRING' }
        },
        required: ['assignmentId', 'studentId', 'score', 'feedback']
      }
    });

    await commandBus.registerHandler('ai.apply_grade', {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare(`
          UPDATE assignment_submissions 
          SET score = ?, feedback = ?, graded_at = ?, status = 'graded'
          WHERE assignment_id = ? AND student_id = ?
        `).run(payload.score, payload.feedback, Date.now(), payload.assignmentId, payload.studentId);

        await eventBus.publish({
          id: uuidv7(),
          type: 'assignment.graded',
          source: 'ai.planner',
          payload: {
            assignmentId: payload.assignmentId,
            studentId: payload.studentId,
            score: payload.score,
            feedback: payload.feedback || ''
          },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, details: `Applied grade ${payload.score} successfully.` };
      }
    });
  },
  deactivate: async () => {
    // Handlers automatically disposed by ResourceTracker
  }
};

/** @deprecated Deprecated in Phase 8. Built-in plugins are auto-loaded by the Kernel using PluginHost. */
export function bootstrapAIPlannerPlugins() {
  // Deprecated. Left as no-op.
}
