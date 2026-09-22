import type { Express, Request, Response } from 'express';
import type { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import type { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import type { ServerContext } from '../context.js';

export function registerClassroomRoutes(
  ctx: ServerContext,
  classroomService: ClassroomRuntimeService,
): void {
  const app: Express = ctx.app;
  const io: Server = (ctx as any).io;
  const db = kernelContainer.db;

  // ── 1. 课堂会话与生命周期阶段 ──────────────────────────────────────────

  // 获取指定课程当前活动会话
  app.get('/api/classroom/sessions/:lessonId', requireAuth('student', 'teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const session = db
        .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? AND stage != ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId, 'ARCHIVED_REPORT') as any;

      if (!session) {
        return res.json({
          hasActiveSession: false,
          stage: 'PRE_CLASS_READY',
          session: null,
        });
      }

      // 附加当前活动互动（如果有）
      const activePoll = db
        .prepare('SELECT * FROM classroom_quick_polls WHERE session_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1')
        .get(session.id, 'ACTIVE') as any;

      if (activePoll) {
        try {
          activePoll.options = JSON.parse(activePoll.options_json);
        } catch (_) {
          activePoll.options = [];
        }
      }

      const activeBuzzer = db
        .prepare('SELECT * FROM classroom_buzzers WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(session.id) as any;

      res.json({
        hasActiveSession: true,
        stage: session.stage,
        session,
        activePoll,
        activeBuzzer,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 启动/初始化会话
  app.post('/api/classroom/sessions/:lessonId/init', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { classId } = req.body;
      const teacherId = getActorId(req) || 'teacher';

      const session = await classroomService.getOrCreateSession(lessonId, teacherId, classId);
      res.json({ success: true, session });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 推进课堂阶段 (PRE_CLASS_READY -> IN_CLASS_TEACHING -> WRAP_UP_EXIT_TICKET -> ARCHIVED_REPORT)
  app.post('/api/classroom/sessions/:lessonId/stage', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { stage, classId } = req.body;
      const teacherId = getActorId(req) || 'teacher';

      if (!['PRE_CLASS_READY', 'IN_CLASS_TEACHING', 'WRAP_UP_EXIT_TICKET', 'ARCHIVED_REPORT'].includes(stage)) {
        return res.status(400).json({ error: `Invalid stage: ${stage}` });
      }

      const result = await classroomService.transitionStage(lessonId, stage, teacherId, classId);
      if (!result.success) {
        return res.status(403).json({ error: result.reason || 'Stage transition blocked' });
      }

      res.json({ success: true, stage: result.stage });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 2. 课堂口播极速投票 (Quick Poll) ──────────────────────────────────

  // 教师发起极速投票
  app.post('/api/classroom/sessions/:lessonId/quick-poll', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { questionType = 'ABCD', title = '课堂极速单选投票', options = ['A', 'B', 'C', 'D'], correctOption } = req.body;
      const teacherId = getActorId(req) || 'teacher';

      const session = await classroomService.getOrCreateSession(lessonId, teacherId);

      // 将之前未关闭的投票置为 CLOSED
      db.prepare('UPDATE classroom_quick_polls SET status = ? WHERE session_id = ? AND status = ?').run(
        'CLOSED',
        session.id,
        'ACTIVE',
      );

      const pollId = `poll_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = Date.now();

      db.prepare(`
        INSERT INTO classroom_quick_polls (id, session_id, lesson_id, question_type, title, options_json, correct_option, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
      `).run(pollId, session.id, lessonId, questionType, title, JSON.stringify(options), correctOption || null, now);

      const pollData = {
        id: pollId,
        sessionId: session.id,
        lessonId,
        questionType,
        title,
        options,
        correctOption: correctOption || null,
        status: 'ACTIVE',
        votes: {},
        totalVotes: 0,
      };

      // 广播给学生端和大屏展台
      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:quick_poll_started', pollData);
        io.emit('classroom:quick_poll_started', pollData);
      }

      res.json({ success: true, poll: pollData });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 学生投票
  app.post('/api/classroom/sessions/:lessonId/quick-poll/:pollId/vote', requireAuth('student', 'teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId, pollId } = req.params;
      const { option, selectedOption } = req.body;
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || getActorId(req) || 'student';
      const studentName = session.studentName || session.name || studentId;

      // 兼容两种字段名（服务端契约为 option，早期前端发的是 selectedOption）
      const votedOption =
        typeof option === 'string' && option.length > 0
          ? option
          : typeof selectedOption === 'string' && selectedOption.length > 0
            ? selectedOption
            : '';

      const poll = db.prepare('SELECT * FROM classroom_quick_polls WHERE id = ?').get(pollId) as any;
      if (!poll || poll.status !== 'ACTIVE') {
        return res.status(400).json({ error: 'Poll is closed or not found' });
      }

      if (!votedOption) {
        return res.status(400).json({ error: 'Missing vote option' });
      }

      // 选项必须是该投票的可选项之一，否则会落库 "undefined" 之类的脏值
      let allowedOptions: unknown = [];
      try {
        allowedOptions = poll.options_json ? JSON.parse(poll.options_json) : [];
      } catch {
        allowedOptions = [];
      }
      if (Array.isArray(allowedOptions) && allowedOptions.length > 0 && !allowedOptions.includes(votedOption)) {
        return res.status(400).json({ error: 'Invalid vote option' });
      }

      const voteId = `vote_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = Date.now();

      db.prepare(`
        INSERT INTO classroom_poll_votes (id, poll_id, student_id, student_name, selected_option, voted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(poll_id, student_id) DO UPDATE SET
          selected_option = excluded.selected_option,
          voted_at = excluded.voted_at
      `).run(voteId, pollId, studentId, studentName, votedOption, now);

      // 计算实时汇总聚合（保护学生隐私）
      const rows = db.prepare('SELECT selected_option, COUNT(*) as count FROM classroom_poll_votes WHERE poll_id = ? GROUP BY selected_option').all(pollId) as { selected_option: string; count: number }[];
      const distribution: Record<string, number> = {};
      let total = 0;
      rows.forEach((r) => {
        distribution[r.selected_option] = r.count;
        total += r.count;
      });

      // 实时广播聚合数据
      if (io) {
        const updatePayload = {
          pollId,
          lessonId,
          distribution,
          totalVotes: total,
          latestVoter: studentName,
        };
        io.to(`lesson-${lessonId}`).emit('classroom:quick_poll_updated', updatePayload);
        io.emit('classroom:quick_poll_updated', updatePayload);
      }

      res.json({ success: true, distribution, totalVotes: total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 教师结束投票
  app.post('/api/classroom/sessions/:lessonId/quick-poll/:pollId/close', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId, pollId } = req.params;
      db.prepare('UPDATE classroom_quick_polls SET status = ? WHERE id = ?').run('CLOSED', pollId);

      const rows = db.prepare('SELECT selected_option, COUNT(*) as count FROM classroom_poll_votes WHERE poll_id = ? GROUP BY selected_option').all(pollId) as { selected_option: string; count: number }[];
      const distribution: Record<string, number> = {};
      let total = 0;
      rows.forEach((r) => {
        distribution[r.selected_option] = r.count;
        total += r.count;
      });

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:quick_poll_closed', { pollId, distribution, totalVotes: total });
        io.emit('classroom:quick_poll_closed', { pollId, distribution, totalVotes: total });
      }

      res.json({ success: true, distribution, totalVotes: total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 3. 毫秒级竞技抢答器 (Buzzer) ──────────────────────────────────────

  // 教师启动抢答
  app.post('/api/classroom/sessions/:lessonId/buzzer', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { title = '全班极速抢答' } = req.body;
      const teacherId = getActorId(req) || 'teacher';
      const session = await classroomService.getOrCreateSession(lessonId, teacherId);

      const buzzerId = `bz_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = Date.now();

      db.prepare(`
        INSERT INTO classroom_buzzers (id, session_id, lesson_id, title, status, created_at)
        VALUES (?, ?, ?, ?, 'READY', ?)
      `).run(buzzerId, session.id, lessonId, title, now);

      const buzzerData = {
        id: buzzerId,
        sessionId: session.id,
        lessonId,
        title,
        status: 'READY',
        winner: null,
        startTime: now,
      };

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:buzzer_ready', buzzerData);
        io.emit('classroom:buzzer_ready', buzzerData);
      }

      res.json({ success: true, buzzer: buzzerData });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 学生按下抢答按钮（原子裁决：先到先得）
  app.post('/api/classroom/sessions/:lessonId/buzzer/:buzzerId/buzz', requireAuth('student', 'teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId, buzzerId } = req.params;
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || getActorId(req) || 'student';
      const studentName = session.studentName || session.name || studentId;

      const buzzer = db.prepare('SELECT * FROM classroom_buzzers WHERE id = ?').get(buzzerId) as any;
      if (!buzzer) {
        return res.status(404).json({ error: 'Buzzer not found' });
      }

      if (buzzer.status === 'LOCKED') {
        return res.json({
          success: false,
          won: false,
          winner: {
            studentId: buzzer.winner_student_id,
            studentName: buzzer.winner_student_name,
            responseTimeMs: buzzer.winner_response_time_ms,
          },
        });
      }

      const responseTimeMs = Math.max(0, Date.now() - buzzer.created_at);

      // 原子性 UPDATE：仅当 status 仍为 READY 时生效
      const updateResult = db.prepare(`
        UPDATE classroom_buzzers
        SET status = 'LOCKED', winner_student_id = ?, winner_student_name = ?, winner_response_time_ms = ?
        WHERE id = ? AND status = 'READY'
      `).run(studentId, studentName, responseTimeMs, buzzerId);

      const won = updateResult.changes > 0;

      if (won) {
        const winnerPayload = {
          buzzerId,
          lessonId,
          winnerStudentId: studentId,
          winnerStudentName: studentName,
          responseTimeMs,
        };
        if (io) {
          io.to(`lesson-${lessonId}`).emit('classroom:buzzer_winner', winnerPayload);
          io.emit('classroom:buzzer_winner', winnerPayload);
        }
      }

      res.json({
        success: true,
        won,
        winner: won
          ? { studentId, studentName, responseTimeMs }
          : { studentId: buzzer.winner_student_id, studentName: buzzer.winner_student_name },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 教师重置抢答器
  app.post('/api/classroom/sessions/:lessonId/buzzer/:buzzerId/reset', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId, buzzerId } = req.params;
      const now = Date.now();
      db.prepare(`
        UPDATE classroom_buzzers
        SET status = 'READY', winner_student_id = NULL, winner_student_name = NULL, winner_response_time_ms = NULL, created_at = ?
        WHERE id = ?
      `).run(now, buzzerId);

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:buzzer_reset', { buzzerId, lessonId });
        io.emit('classroom:buzzer_reset', { buzzerId, lessonId });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 4. 听懂反馈晴雨表 (Pacing Signal) ──────────────────────────────────

  // 学生发送学习节奏信号
  app.post('/api/classroom/sessions/:lessonId/pacing', requireAuth('student', 'teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { signal, signalType } = req.body; // 'TOO_FAST' | 'CONFUSED' | 'CLEAR'
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || getActorId(req) || 'student';

      // 兼容两种字段名（服务端契约为 signal，早期前端发的是 signalType）
      const pacingSignal = signal ?? signalType;
      if (!['TOO_FAST', 'CONFUSED', 'CLEAR'].includes(pacingSignal)) {
        return res.status(400).json({ error: 'Invalid pacing signal' });
      }

      const activeSession = db.prepare('SELECT id FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1').get(lessonId) as any;
      const sessionId = activeSession ? activeSession.id : `s_${lessonId}`;

      const signalId = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      db.prepare(`
        INSERT INTO classroom_pacing_signals (id, session_id, student_id, signal_type, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(signalId, sessionId, studentId, pacingSignal, Date.now());

      // 计算过去 5 分钟内的信号聚合
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      const counts = db.prepare(`
        SELECT signal_type, COUNT(*) as count
        FROM classroom_pacing_signals
        WHERE session_id = ? AND created_at > ?
        GROUP BY signal_type
      `).all(sessionId, fiveMinsAgo) as { signal_type: string; count: number }[];

      const summary: Record<string, number> = { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 };
      counts.forEach((c) => {
        summary[c.signal_type] = c.count;
      });

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:pacing_updated', { lessonId, summary });
        io.emit('classroom:pacing_updated', { lessonId, summary });
      }

      res.json({ success: true, summary });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 5. 结课通票 (Exit Ticket) ──────────────────────────────────────────

  // 学生提交 60s 结课通票
  app.post('/api/classroom/sessions/:lessonId/exit-ticket', requireAuth('student', 'teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { rating = 5, puzzledConcept = '', feedback = '', feedbackNotes = '' } = req.body;
      const session = (req as any).session;
      const studentId = session.studentId || session.userId || getActorId(req) || 'student';
      const studentName = session.studentName || session.name || studentId;

      const activeSession = db.prepare('SELECT id FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1').get(lessonId) as any;
      const sessionId = activeSession ? activeSession.id : `s_${lessonId}`;

      const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const now = Date.now();

      db.prepare(`
        INSERT INTO classroom_exit_tickets (id, session_id, lesson_id, student_id, student_name, rating, puzzled_concept, feedback, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, student_id) DO UPDATE SET
          rating = excluded.rating,
          puzzled_concept = excluded.puzzled_concept,
          feedback = excluded.feedback,
          created_at = excluded.created_at
      `).run(ticketId, sessionId, lessonId, studentId, studentName, rating, puzzledConcept, feedback || feedbackNotes, now);

      const countRow = db.prepare('SELECT COUNT(*) as count FROM classroom_exit_tickets WHERE session_id = ?').get(sessionId) as any;

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:exit_ticket_submitted', {
          lessonId,
          totalSubmitted: countRow?.count || 1,
        });
      }

      res.json({ success: true, totalSubmitted: countRow?.count || 1 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 6. 大屏公开脱敏数据接口 (Stage Display) ────────────────────────────

  app.get('/api/classroom/stage/:lessonId/data', requireAuth(), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;

      const session = db
        .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId) as any;

      // 提取活动投票（仅聚合，脱敏）
      let activePollData = null;
      if (session) {
        const poll = db
          .prepare('SELECT * FROM classroom_quick_polls WHERE session_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1')
          .get(session.id, 'ACTIVE') as any;

        if (poll) {
          const rows = db.prepare('SELECT selected_option, COUNT(*) as count FROM classroom_poll_votes WHERE poll_id = ? GROUP BY selected_option').all(poll.id) as { selected_option: string; count: number }[];
          const distribution: Record<string, number> = {};
          let total = 0;
          rows.forEach((r) => {
            distribution[r.selected_option] = r.count;
            total += r.count;
          });

          let parsedOptions = [];
          try {
            parsedOptions = JSON.parse(poll.options_json);
          } catch (_) {}

          activePollData = {
            id: poll.id,
            title: poll.title,
            questionType: poll.question_type,
            options: parsedOptions,
            distribution,
            totalVotes: total,
          };
        }
      }

      // 提取活动抢答器（仅展示胜出者昵称，不暴露敏感身份）
      let activeBuzzerData = null;
      if (session) {
        const buzzer = db.prepare('SELECT * FROM classroom_buzzers WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.id) as any;
        if (buzzer) {
          activeBuzzerData = {
            id: buzzer.id,
            title: buzzer.title,
            status: buzzer.status,
            winnerName: buzzer.winner_student_name || null,
            responseTimeMs: buzzer.winner_response_time_ms || null,
          };
        }
      }

      // 提取课堂节奏晴雨表（过去 10 分钟脱敏汇总）
      const tenMinsAgo = Date.now() - 10 * 60 * 1000;
      const pacingRows = session
        ? (db.prepare(`
            SELECT signal_type, COUNT(*) as count
            FROM classroom_pacing_signals
            WHERE session_id = ? AND created_at > ?
            GROUP BY signal_type
          `).all(session.id, tenMinsAgo) as { signal_type: string; count: number }[])
        : [];

      const pacingSummary: Record<string, number> = { TOO_FAST: 0, CONFUSED: 0, CLEAR: 0 };
      pacingRows.forEach((r) => {
        pacingSummary[r.signal_type] = r.count;
      });

      res.json({
        lessonId,
        stage: session?.stage || 'PRE_CLASS_READY',
        checkinCode: session?.checkin_code || null,
        activePoll: activePollData,
        activeBuzzer: activeBuzzerData,
        pacing: pacingSummary,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 7. 全景课堂学情简报 (Panoramic Report) ─────────────────────────────

  app.get('/api/classroom/sessions/:lessonId/panoramic-report', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;

      const session = db
        .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId) as any;

      if (!session) {
        return res.status(404).json({ error: 'No classroom session found for this lesson' });
      }

      // 测验表现汇总
      const quizSubmissions = db
        .prepare('SELECT score, is_correct, time_spent_ms FROM lesson_quiz_submissions WHERE lesson_id = ?')
        .all(lessonId) as { score: number; is_correct: number; time_spent_ms: number }[];

      const totalQuizSubmissions = quizSubmissions.length;
      const correctQuizSubmissions = quizSubmissions.filter((s) => s.is_correct === 1).length;
      const avgQuizAccuracy = totalQuizSubmissions > 0 ? Math.round((correctQuizSubmissions / totalQuizSubmissions) * 100) : 0;

      // 投票参与汇总
      const pollVotesCount = (
        db.prepare(`
          SELECT COUNT(*) as count
          FROM classroom_poll_votes v
          JOIN classroom_quick_polls p ON v.poll_id = p.id
          WHERE p.session_id = ?
        `).get(session.id) as any
      )?.count || 0;

      // 结课通票汇总
      const exitTickets = db
        .prepare('SELECT rating, puzzled_concept, feedback FROM classroom_exit_tickets WHERE session_id = ?')
        .all(session.id) as { rating: number; puzzled_concept: string; feedback: string }[];

      const avgRating = exitTickets.length > 0
        ? (exitTickets.reduce((sum, t) => sum + (t.rating || 5), 0) / exitTickets.length).toFixed(1)
        : '5.0';

      const puzzledConcepts = exitTickets
        .map((t) => t.puzzled_concept?.trim())
        .filter((c) => Boolean(c));

      res.json({
        success: true,
        session: {
          id: session.id,
          lessonId,
          stage: session.stage,
          startedAt: session.started_at,
          endedAt: session.ended_at,
          durationMin: session.started_at && session.ended_at ? Math.round((session.ended_at - session.started_at) / 60000) : 0,
        },
        metrics: {
          quizCount: totalQuizSubmissions,
          quizAccuracy: avgQuizAccuracy,
          pollVotesTotal: pollVotesCount,
          exitTicketsCount: exitTickets.length,
          exitTicketsAvgRating: parseFloat(avgRating),
          topPuzzledConcepts: puzzledConcepts.slice(0, 10),
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
