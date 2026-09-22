import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { sendSafeError } from '../utils/error-handler.js';

export function registerAssignmentsRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/classes/:classId/assignments', requireAuth(), (req, res) => {
    try {
      const assignments = kernelContainer.db
        .prepare('SELECT * FROM assignments WHERE class_id = ? ORDER BY created_at DESC')
        .all(req.params.classId);
      res.json(assignments);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/assignments/generate', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { topic, lessonId } = req.body;
      const ai = kernelContainer.aiService;
      const prompt = `You are an expert teacher. Generate a short 1-question quiz or assignment about "${topic}". Output in this JSON format: {"title": "...", "description": "...", "content": "..."} without markdown blocks.`;
      const text = await ai.generateText(prompt);
      const cleanText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      let gen = { title: 'Untitled Quiz', description: '', content: '' };
      try {
        gen = JSON.parse(cleanText);
      } catch (e) {}

      const id = 'ast-' + Date.now().toString(36);
      kernelContainer.db
        .prepare(
          'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          req.params.classId,
          lessonId || null,
          gen.title || `Quiz: ${topic}`,
          gen.description || '',
          gen.content || '',
          Date.now(),
        );
      res.json({
        success: true,
        assignment: {
          id,
          class_id: req.params.classId,
          lesson_id: lessonId || null,
          title: gen.title,
          description: gen.description,
          content: gen.content,
        },
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/:classId/assignments/suggest', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId } = req.body;
      const lesson = kernelContainer.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
      if (!lesson) {
        return res.status(404).json({ error: 'Lesson not found' });
      }

      const ai = kernelContainer.aiService;

      const prompt = `You are an expert curriculum developer and instructional designer. 
Analyze the following lesson content and:
1. Identify 3 to 5 key learning objectives covered in this lesson.
2. Automatically write exactly 3 to 4 multiple-choice questions mapped to those key learning objectives based on the lesson content.
   Each question must test a specific learning objective, have 4 realistic options, and one correct answer that corresponds exactly to one of the options.

Lesson Title: ${lesson.title}
Lesson Content:
${lesson.content}

Output pure JSON only without markdown code blocks, matching this structure:
{
  "learningObjectives": ["objective 1", "objective 2"],
  "questions": [
    {
      "objective": "objective 1",
      "question": "question text",
      "options": ["A) opt1", "B) opt2", "C) opt3", "D) opt4"],
      "correctAnswer": "A) opt1"
    }
  ]
}`;

      const text = await ai.generateText(prompt);
      const cleanText = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      res.json(JSON.parse(cleanText));
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/classes/:classId/assignments/create-suggested-quiz',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const { title, description, questions, learningObjectives, timeLimit, lessonId } = req.body;
        const id = 'ast-' + Date.now().toString(36);

        const contentJson = JSON.stringify({
          quizType: 'mcq_learning_objectives',
          questions,
          learningObjectives: learningObjectives || [],
          timeLimit: timeLimit || 0,
        });

        kernelContainer.db
          .prepare(
            'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            req.params.classId,
            lessonId || null,
            title || 'AI Suggested Quiz',
            description || '',
            contentJson,
            Date.now(),
          );

        res.json({ success: true, assignmentId: id });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  app.post('/api/assignments/:id/submissions', requireAuth(), (req, res) => {
    try {
      const { studentId, content } = req.body;
      const session = (req as any).session;
      const isPrivileged = session && (session.role === 'teacher' || session.role === 'administrator');
      const currentUserId = session?.userId || session?.studentId;

      const studentRow = kernelContainer.db
        .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
        .get(studentId, studentId) as any;

      const isSelf =
        studentRow
          ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
          : currentUserId === studentId;

      if (!isPrivileged && !isSelf) {
        return res.status(403).json({ error: 'Cannot submit assignment on behalf of another student' });
      }

      const targetStudentId = studentRow ? studentRow.id : studentId;

      kernelContainer.db
        .prepare(
          `
        INSERT INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status)
        VALUES (?, ?, ?, ?, 'submitted')
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET content = excluded.content, submitted_at = excluded.submitted_at, status = 'submitted'
      `,
        )
        .run(req.params.id, targetStudentId, content, Date.now());
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/assignments/:id/submissions', requireAuth(), (req, res) => {
    try {
      const submissions = kernelContainer.db
        .prepare(
          `
        SELECT asb.*, s.name as student_name
        FROM assignment_submissions asb
        JOIN students s ON asb.student_id = s.id
        WHERE asb.assignment_id = ?
        ORDER BY asb.submitted_at DESC
      `,
        )
        .all(req.params.id);
      res.json(submissions);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post(
    '/api/assignments/:id/submissions/:studentId/grade',
    requireAuth('teacher', 'administrator'),
    async (req, res) => {
      try {
        const asb = kernelContainer.db
          .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
          .get(req.params.id, req.params.studentId) as any;
        const ast = kernelContainer.db.prepare('SELECT * FROM assignments WHERE id = ?').get(req.params.id) as any;
        if (!asb || !ast) throw new Error('Submission or assignment not found');

        const ai = kernelContainer.aiService;
        let grade = { score: 0, feedback: '' };

        let isMcqQuiz = false;
        let autoScore: number | null = null;
        let autoFeedback = '';

        try {
          const quizObj = JSON.parse(ast.content);
          if (quizObj && quizObj.quizType === 'mcq_learning_objectives') {
            isMcqQuiz = true;
            const studentAnswers = JSON.parse(asb.content);
            const questions = quizObj.questions;
            let correctCount = 0;
            let feedbackParts: string[] = [];

            questions.forEach((q: any, idx: number) => {
              const studentAns = studentAnswers[idx];
              const isCorrect = studentAns === q.correctAnswer;
              if (isCorrect) {
                correctCount++;
                feedbackParts.push(
                  `Q${idx + 1}: Correct! Option: "${q.correctAnswer}" (Tests Objective: ${q.objective})`,
                );
              } else {
                feedbackParts.push(
                  `Q${idx + 1}: Incorrect. Your Answer: "${studentAns || 'None'}". Correct Option: "${q.correctAnswer}" (Tests Objective: ${q.objective})`,
                );
              }
            });

            autoScore = Math.round((correctCount / questions.length) * 100);
            autoFeedback = `Auto-Graded Multiple Choice Quiz.\nScore: ${autoScore}%\n\nDetails:\n${feedbackParts.join('\n')}`;
          }
        } catch (e) {
          // Not a structured MCQ quiz
        }

        if (isMcqQuiz && autoScore !== null) {
          const prompt = `You are a warm and helpful AI tutor. A student has taken a multiple-choice quiz mapped to lesson learning objectives.
Questions & Answers: ${ast.content}
Student's Selected Choices: ${asb.content}
Calculated Score: ${autoScore}%

Write an encouraging message explaining why their correct answers are correct, and gently explaining why the correct concept is correct for any questions they got incorrect. Connect it directly back to the key learning objectives.
Provide a grade score (${autoScore}) and tutoring feedback. You MUST output in this exact JSON format: {"score": ${autoScore}, "feedback": "tutoring feedback..."} without markdown formatting or backticks.`;

          const text = await ai.generateText(prompt);
          const cleanText = text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
          try {
            grade = JSON.parse(cleanText);
            grade.score = autoScore;
          } catch (e) {
            grade = { score: autoScore, feedback: autoFeedback };
          }
        } else {
          const prompt = `You are a strict but fair teacher grading a student's answer.
Assignment Question: ${ast.content}
Student's Answer: ${asb.content}
Provide a grade score (0-100) and brief feedback. Ensure you output in this exact JSON format: {"score": 85, "feedback": "Good job..."} without markdown formatting or backticks.`;

          const text = await ai.generateText(prompt);
          const cleanText = text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
          try {
            grade = JSON.parse(cleanText);
          } catch (e) {}
        }

        const { v7: uuidv7 } = await import('uuid');
        await kernelContainer.commandBus.execute({
          id: uuidv7(),
          type: 'ai.apply_grade',
          actorId: 'system',
          timestamp: Date.now(),
          payload: {
            assignmentId: req.params.id,
            studentId: req.params.studentId,
            score: grade.score,
            feedback: grade.feedback,
          },
        });

        res.json({
          success: true,
          pendingApproval: true,
          message: 'Grade generated and sent for approval.',
          score: grade.score,
          feedback: grade.feedback,
        });
      } catch (e: any) {
        sendSafeError(res, e);
      }
    },
  );

  // Scheduling & Attendance
}
