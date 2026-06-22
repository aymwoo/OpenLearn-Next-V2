import { ICommandBusServiceToken, IActionRegistryServiceToken, ISemesterGradeServiceToken, IDatabaseToken } from '../../core/di/interfaces.js';
import type { PluginContext } from '../../core/plugin-host/types.js';

export default {
  manifest: {
    id: "ext-ai-quiz-pro",
    name: "AI Quiz Pro",
    version: "1.0.0"
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;

    // 1. Register Action for Creating Quizzes
    await actionRegistry.register({
      id: 'ext-quiz-pro-create',
      commandType: 'quiz_pro.create',
      description: 'Create an interactive quiz on the whiteboard (Pro)',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          question: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          correctAnswer: { type: 'STRING', description: 'Standard answer option (e.g. "A" or the exact option text)' }
        },
        required: ['lessonId', 'question', 'options', 'correctAnswer']
      }
    });

    // 2. Register Action for Submitting Quiz Answer
    await actionRegistry.register({
      id: 'ext-quiz-pro-submit',
      commandType: 'quiz_pro.submit_answer',
      description: 'Submit an answer to a quiz and sync to semester grades (Pro)',
      capabilityRequired: 'whiteboard:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          elementId: { type: 'STRING' },
          studentId: { type: 'STRING' },
          answer: { type: 'STRING' }
        },
        required: ['lessonId', 'elementId', 'studentId', 'answer']
      }
    });

    // 3. Register Quiz Create Handler
    await commandBus.registerHandler('quiz_pro.create', {
      execute: async (command) => {
        const payload = command.payload as any;
        const result = await commandBus.execute({
          id: 'int_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.draw',
          actorId: command.actorId || 'agent-system-0',
          payload: {
            lessonId: payload.lessonId,
            type: 'quiz',
            data: JSON.stringify({
              question: payload.question,
              options: payload.options,
              correctAnswer: payload.correctAnswer,
              submissions: {},
              x: payload.x || 120,
              y: payload.y || 120,
              width: 320,
              height: 280,
              isMinimized: false
            })
          }
        }) as any;
        return { success: true, elementId: result?.elementId };
      }
    });

    // 4. Register Quiz Submit Handler
    await commandBus.registerHandler('quiz_pro.submit_answer', {
      execute: async (command) => {
        const payload = command.payload as any;
        const { lessonId, elementId, studentId, answer } = payload;

        // A. Resolve Database and Retrieve original Element Data
        const db = await ctx.resolve(IDatabaseToken) as any;
        const row = db.prepare('SELECT data FROM whiteboard_elements WHERE id = ? AND lesson_id = ?').get(elementId, lessonId) as { data: string } | undefined;
        if (!row) {
          throw new Error(`Whiteboard element not found: ${elementId}`);
        }

        const dataObj = JSON.parse(row.data);
        const correctAnswer = dataObj.correctAnswer;

        // B. Determine Grade (100 for correct answer, 0 for incorrect)
        const isCorrect = String(answer).trim().toLowerCase() === String(correctAnswer).trim().toLowerCase();
        const score = isCorrect ? 100 : 0;

        // C. Update submission records inside element data payload
        if (!dataObj.submissions) {
          dataObj.submissions = {};
        }
        dataObj.submissions[studentId] = {
          answer,
          score,
          time: Date.now()
        };

        // D. Save updated data back via CommandBus
        await commandBus.execute({
          id: 'int_upd_' + Math.random().toString(36).slice(2),
          type: 'whiteboard.update',
          actorId: command.actorId || studentId,
          payload: {
            lessonId,
            elementId,
            data: JSON.stringify(dataObj)
          }
        });

        // E. Sync score to Host Semester Grades system
        try {
          const gradeService = await ctx.resolve(ISemesterGradeServiceToken) as any;
          if (gradeService) {
            await gradeService.saveSemesterGrade(lessonId, studentId, score);
            console.log(`[AI Quiz Pro] Successfully synced grade for student ${studentId}: ${score} to semester grades`);
          } else {
            console.warn('[AI Quiz Pro] SemesterGradeService not resolved, skipping grade sync');
          }
        } catch (e) {
          console.error('[AI Quiz Pro] Error syncing grade to semester grades:', e);
        }

        return { success: true, score, isCorrect };
      }
    });
  },
  deactivate: async () => {
    // Cleanups automatically handled by ResourceTracker
  }
};
