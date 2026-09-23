import type { Express, Request, Response } from 'express';
import type { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { requireAuth, getActorId } from '../middleware/auth.js';
import type { ClassroomRuntimeService } from '../services/classroom-runtime-service.js';
import type { ServerContext } from '../context.js';

/**
 * 内置教学模式 —— 课堂启动门户「教学模式选择器」的兜底数据源。
 *
 * 不写进迁移 seed 的原因：模式文案需跟随 i18n 与产品迭代变化，写进迁移会造成
 * 「迁移与业务常量两处维护」。API 读取时以「数据库记录优先 + 本常量兜底」合并返回，
 * 因此管理员可在不发版的情况下改写文案或追加自定义模式。
 * color 存语义色名（非具体色值），由前端映射到主题 token，避免深色主题下失色。
 */
export interface TeachingMode {
  id: string;
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  icon: string;
  color: string;
  isBuiltin: boolean;
  sortOrder: number;
}

export const BUILTIN_TEACHING_MODES: TeachingMode[] = [
  {
    id: 'lecture',
    name: '讲授式',
    nameEn: 'Lecture',
    description: '教师主导讲解，学生跟随听讲与记录',
    descriptionEn: 'Teacher-led explanation with students following along',
    icon: 'Presentation',
    color: 'indigo',
    isBuiltin: true,
    sortOrder: 10,
  },
  {
    id: 'inquiry',
    name: '探究式',
    nameEn: 'Inquiry',
    description: '以问题驱动，学生自主提出假设并验证',
    descriptionEn: 'Question-driven: students form and test their own hypotheses',
    icon: 'FlaskConical',
    color: 'emerald',
    isBuiltin: true,
    sortOrder: 20,
  },
  {
    id: 'collaborative',
    name: '协作式',
    nameEn: 'Collaborative',
    description: '小组分工协作，共同产出并互评',
    descriptionEn: 'Group work with division of labour and peer review',
    icon: 'Users',
    color: 'amber',
    isBuiltin: true,
    sortOrder: 30,
  },
  {
    id: 'experiential',
    name: '体验式',
    nameEn: 'Experiential',
    description: '濉浸式交互体验，在做中学',
    descriptionEn: 'Immersive hands-on experience: learning by doing',
    icon: 'Sparkles',
    color: 'violet',
    isBuiltin: true,
    sortOrder: 40,
  },
  {
    id: 'drill',
    name: '练习式',
    nameEn: 'Drill',
    description: '针对性变式练习与即时反馈攻克',
    descriptionEn: 'Targeted varied practice with immediate feedback',
    icon: 'Target',
    color: 'rose',
    isBuiltin: true,
    sortOrder: 50,
  },
];

/** 教学模式 id 规范：与插件 id 同构，避免路径穿越与非法字符。 */
const TEACHING_MODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function registerClassroomRoutes(
  ctx: ServerContext,
  classroomService: ClassroomRuntimeService,
): void {
  const app: Express = ctx.app;
  const io: Server = (ctx as any).io;
  const db = kernelContainer.db;

  // ── 课堂倒计时管理（持久化 & 插件可扩展） ─────────────────────────
  interface ActiveCountdownState {
    lessonId: string;
    totalDuration: number;
    timeRemaining: number;
    isRunning: boolean;
    isPaused: boolean;
    label: string;
    endsAt: number | null;
    updatedAt: number;
  }

  const activeCountdowns = new Map<string, ActiveCountdownState>();

  const publishCountdownEvent = (type: string, payload: any) => {
    try {
      void kernelContainer.eventBus.publish({
        id: `evt-cd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        source: 'classroom.countdown',
        payload,
        timestamp: Date.now(),
      });
    } catch (_) {}
  };

  const getCountdownForLesson = (lessonId: string): ActiveCountdownState => {
    let state = activeCountdowns.get(lessonId);
    if (!state) {
      try {
        const session = db
          .prepare('SELECT settings_json FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(lessonId) as any;
        if (session && session.settings_json) {
          const settings = JSON.parse(session.settings_json);
          if (settings.countdown) {
            state = { ...settings.countdown, lessonId };
          }
        }
      } catch (_) {}
    }

    if (!state) {
      state = {
        lessonId,
        totalDuration: 0,
        timeRemaining: 0,
        isRunning: false,
        isPaused: false,
        label: '课堂任务',
        endsAt: null,
        updatedAt: Date.now(),
      };
      activeCountdowns.set(lessonId, state);
    }

    // 若当前正在运行，依据目标截止时间校准精确剩余秒数（杜绝浏览器休眠漂移）
    if (state.isRunning && state.endsAt) {
      const now = Date.now();
      const remaining = Math.max(0, Math.round((state.endsAt - now) / 1000));
      state.timeRemaining = remaining;
      if (remaining === 0) {
        state.isRunning = false;
        state.isPaused = false;
        state.endsAt = null;
        publishCountdownEvent('classroom.countdown.expired', {
          lessonId,
          label: state.label,
          totalDuration: state.totalDuration,
        });
      }
    }

    return state;
  };

  const persistAndBroadcastCountdown = (lessonId: string, state: ActiveCountdownState) => {
    state.updatedAt = Date.now();
    activeCountdowns.set(lessonId, state);

    // 持久化到数据库
    try {
      const session = db
        .prepare('SELECT id, settings_json FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId) as any;
      if (session) {
        let settings: Record<string, any> = {};
        try {
          settings = JSON.parse(session.settings_json || '{}');
        } catch (_) {}
        settings.countdown = state;
        db.prepare('UPDATE classroom_sessions SET settings_json = ? WHERE id = ?').run(
          JSON.stringify(settings),
          session.id,
        );
      }
    } catch (_) {}

    // 广播到所有连接的客户端与房间
    if (io) {
      io.to(`lesson-${lessonId}`).emit('classroom:countdown_updated', state);
      io.emit('classroom:countdown_updated', state);
    }

    // 触发内核事件总线，供第三方插件监听
    publishCountdownEvent('classroom.countdown.updated', { lessonId, countdown: state });
    return state;
  };

  const applyCountdownAction = (
    lessonId: string,
    action: 'start' | 'pause' | 'resume' | 'reset' | 'add_time' | 'set',
    params: { duration?: number; addSeconds?: number; label?: string } = {},
  ): ActiveCountdownState => {
    const current = getCountdownForLesson(lessonId);
    const now = Date.now();

    switch (action) {
      case 'start': {
        const duration = Number(params.duration) || current.totalDuration || 300;
        const label = params.label || current.label || '课堂任务';
        current.totalDuration = duration;
        current.timeRemaining = duration;
        current.endsAt = now + duration * 1000;
        current.isRunning = true;
        current.isPaused = false;
        current.label = label;
        publishCountdownEvent('classroom.countdown.started', {
          lessonId,
          duration,
          label,
          endsAt: current.endsAt,
        });
        break;
      }
      case 'pause': {
        if (current.isRunning && current.endsAt) {
          current.timeRemaining = Math.max(0, Math.round((current.endsAt - now) / 1000));
        }
        current.isRunning = false;
        current.isPaused = true;
        current.endsAt = null;
        publishCountdownEvent('classroom.countdown.paused', {
          lessonId,
          timeRemaining: current.timeRemaining,
        });
        break;
      }
      case 'resume': {
        const remaining = current.timeRemaining > 0 ? current.timeRemaining : current.totalDuration || 300;
        current.timeRemaining = remaining;
        current.endsAt = now + remaining * 1000;
        current.isRunning = true;
        current.isPaused = false;
        publishCountdownEvent('classroom.countdown.resumed', {
          lessonId,
          timeRemaining: remaining,
          endsAt: current.endsAt,
        });
        break;
      }
      case 'reset': {
        current.isRunning = false;
        current.isPaused = false;
        current.timeRemaining = current.totalDuration;
        current.endsAt = null;
        publishCountdownEvent('classroom.countdown.reset', { lessonId });
        break;
      }
      case 'add_time': {
        const add = Number(params.addSeconds) || 60;
        current.timeRemaining = Math.max(0, current.timeRemaining + add);
        current.totalDuration = Math.max(current.totalDuration, current.timeRemaining);
        if (current.isRunning && current.endsAt) {
          current.endsAt += add * 1000;
        }
        publishCountdownEvent('classroom.countdown.time_added', {
          lessonId,
          addSeconds: add,
          timeRemaining: current.timeRemaining,
        });
        break;
      }
      case 'set': {
        if (params.duration !== undefined) {
          current.totalDuration = Number(params.duration);
          current.timeRemaining = Number(params.duration);
        }
        if (params.label) {
          current.label = params.label;
        }
        current.isRunning = false;
        current.isPaused = false;
        current.endsAt = null;
        break;
      }
    }

    return persistAndBroadcastCountdown(lessonId, current);
  };

  // 注册命令总线处理器，使第三方插件可以通过 commandBus 控制倒计时
  try {
    kernelContainer.commandBus.registerHandler('classroom.countdown.start', {
      execute: async (cmd: any) => {
        const { lessonId, duration, label } = cmd.payload || {};
        if (lessonId) return applyCountdownAction(lessonId, 'start', { duration, label });
      },
    });
    kernelContainer.commandBus.registerHandler('classroom.countdown.pause', {
      execute: async (cmd: any) => {
        const { lessonId } = cmd.payload || {};
        if (lessonId) return applyCountdownAction(lessonId, 'pause');
      },
    });
    kernelContainer.commandBus.registerHandler('classroom.countdown.resume', {
      execute: async (cmd: any) => {
        const { lessonId } = cmd.payload || {};
        if (lessonId) return applyCountdownAction(lessonId, 'resume');
      },
    });
    kernelContainer.commandBus.registerHandler('classroom.countdown.reset', {
      execute: async (cmd: any) => {
        const { lessonId } = cmd.payload || {};
        if (lessonId) return applyCountdownAction(lessonId, 'reset');
      },
    });
    kernelContainer.commandBus.registerHandler('classroom.countdown.add_time', {
      execute: async (cmd: any) => {
        const { lessonId, addSeconds } = cmd.payload || {};
        if (lessonId) return applyCountdownAction(lessonId, 'add_time', { addSeconds });
      },
    });
  } catch (_) {}

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

      const activeCountdown = getCountdownForLesson(lessonId);

      res.json({
        hasActiveSession: true,
        stage: session.stage,
        session,
        activePoll,
        activeBuzzer,
        activeCountdown,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 获取课堂倒计时状态（支持学生、教师与第三方插件查询）
  app.get('/api/classroom/sessions/:lessonId/countdown', requireAuth('student', 'teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const countdown = getCountdownForLesson(lessonId);
      res.json({ success: true, countdown });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 操作课堂倒计时（启动、暂停、继续、重置、追加时长、自定义设置）
  app.post('/api/classroom/sessions/:lessonId/countdown', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { action = 'start', duration, addSeconds, label } = req.body;
      const countdown = applyCountdownAction(lessonId, action, { duration, addSeconds, label });
      res.json({ success: true, countdown });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 启动/初始化会话
  app.post('/api/classroom/sessions/:lessonId/init', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { classId, teachingModeId } = req.body;
      const teacherId = getActorId(req) || 'teacher';

      const session = await classroomService.getOrCreateSession(lessonId, teacherId, classId);

      // 课堂启动门户会在启动课堂时一并提交所选教学模式
      if (typeof teachingModeId === 'string' && teachingModeId.trim()) {
        db.prepare('UPDATE classroom_sessions SET teaching_mode_id = ? WHERE id = ?').run(
          teachingModeId.trim(),
          session.id,
        );
      }

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

      // ── 逐生真实明细（供学情简报 / CSV 导出） ──────────────────────
      // 口径：
      //   quizScore   = 该生本节所有随堂测得分的平均值（无作答 → null）
      //   accuracy    = 该生本节随堂测正确率（无作答 → null）
      //   pollsAnswered = 该生在本次会话中的投票次数（真实计数）
      //   exitRating  = 该生结课通票评分（未提交 → null）
      //   attendance  = 是否出现在投票/测验/通票任一真实互动记录中
      // 绝不使用前端伪计算（旧版曾用 score = 80 + ((i * 7) % 21)）。
      const quizByStudent = db
        .prepare(
          `SELECT student_id,
                  MAX(student_name) as student_name,
                  ROUND(AVG(score), 1) as avg_score,
                  ROUND(AVG(is_correct) * 100, 1) as accuracy,
                  COUNT(*) as quiz_count
           FROM lesson_quiz_submissions
           WHERE lesson_id = ?
           GROUP BY student_id`,
        )
        .all(lessonId) as Array<{
        student_id: string;
        student_name: string | null;
        avg_score: number | null;
        accuracy: number | null;
        quiz_count: number;
      }>;

      const votesByStudent = db
        .prepare(
          `SELECT v.student_id, COUNT(*) as votes
           FROM classroom_poll_votes v
           JOIN classroom_quick_polls p ON v.poll_id = p.id
           WHERE p.session_id = ?
           GROUP BY v.student_id`,
        )
        .all(session.id) as Array<{ student_id: string; votes: number }>;

      const exitByStudent = new Map<string, { rating: number | null; puzzledConcept: string | null }>();
      for (const t of exitTickets as Array<any>) {
        exitByStudent.set(t.student_id, {
          rating: typeof t.rating === 'number' ? t.rating : null,
          puzzledConcept: t.puzzled_concept ?? null,
        });
      }

      // 以「本节有真实互动记录的学生」为主键集合，并集上班级花名册
      const roster = db
        .prepare('SELECT id, name, student_number FROM students WHERE class_id = ? ORDER BY student_number, name')
        .all(session.class_id) as Array<{ id: string; name: string; student_number: string | null }>;

      const votesMap = new Map(votesByStudent.map((v) => [v.student_id, v.votes]));
      const quizMap = new Map(quizByStudent.map((q) => [q.student_id, q]));

      const seen = new Set<string>();
      const studentBreakdown: any[] = [];
      const pushStudent = (studentId: string, fallbackName?: string | null) => {
        if (seen.has(studentId)) return;
        seen.add(studentId);
        const q = quizMap.get(studentId);
        const votes = votesMap.get(studentId) ?? 0;
        const exit = exitByStudent.get(studentId);
        studentBreakdown.push({
          studentId,
          studentName: q?.student_name || fallbackName || studentId,
          attendance: Boolean(q) || votes > 0 || Boolean(exit),
          quizScore: q?.avg_score ?? null,
          quizCount: q?.quiz_count ?? 0,
          accuracy: q?.accuracy ?? null,
          pollsAnswered: votes,
          exitRating: exit?.rating ?? null,
          puzzledConcept: exit?.puzzledConcept ?? null,
        });
      };

      // 1) 先放有真实互动记录的学生（按成绩降序，便于简报排序）
      const interacted = new Set<string>([
        ...quizByStudent.map((q) => q.student_id),
        ...votesByStudent.map((v) => v.student_id),
        ...exitByStudent.keys(),
      ]);
      for (const id of Array.from(interacted).sort((a, b) => {
        const sa = quizMap.get(a)?.avg_score ?? -1;
        const sb = quizMap.get(b)?.avg_score ?? -1;
        return sb - sa;
      })) {
        pushStudent(id, quizMap.get(id)?.student_name);
      }
      // 2) 再补花名册中未产生互动的学生（attendance=false，成绩 null）
      for (const st of roster) pushStudent(st.id, st.name);

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
        students: studentBreakdown,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 8. 实时课堂情绪与参与度追踪 (Real-time Classroom Mood Tracker) ─────────

  // 获取当前所有活跃中的授课会话
  app.get('/api/classroom/active-sessions', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const activeSessions = db
        .prepare(`
          SELECT s.*, l.title as lesson_title, c.name as class_name
          FROM classroom_sessions s
          LEFT JOIN lessons l ON s.lesson_id = l.id
          LEFT JOIN classes c ON s.class_id = c.id
          WHERE s.stage != 'ARCHIVED_REPORT'
          ORDER BY s.created_at DESC
          LIMIT 10
        `)
        .all() as any[];

      res.json({ success: true, sessions: activeSessions });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 教学模式 (Teaching Modes — 课堂启动门户的模式选择器) ──────────
  // 内置模式以代码常量兜底，数据库记录优先，便于管理员与插件在不发版的情况下扩展。
  app.get('/api/classroom/teaching-modes', requireAuth(), (req: Request, res: Response) => {
    try {
      const rows = db
        .prepare('SELECT * FROM teaching_modes ORDER BY sort_order ASC, created_at ASC')
        .all() as any[];

      const stored: TeachingMode[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameEn: r.name_en,
        description: r.description ?? '',
        descriptionEn: r.description_en,
        icon: r.icon ?? 'BookOpen',
        color: r.color ?? 'indigo',
        isBuiltin: !!r.is_builtin,
        sortOrder: r.sort_order ?? 100,
      }));

      // 内置模式保持顺序与存在性；同 id 的数据库记录覆盖其文案
      const merged = BUILTIN_TEACHING_MODES.map((b) => stored.find((s) => s.id === b.id) ?? b);
      const extra = stored.filter((s) => !BUILTIN_TEACHING_MODES.some((b) => b.id === s.id));

      res.json({ success: true, modes: [...merged, ...extra].sort((a, b) => a.sortOrder - b.sortOrder) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classroom/teaching-modes', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const { id, name, nameEn, description, descriptionEn, icon, color, sortOrder } = req.body || {};
      if (typeof id !== 'string' || !TEACHING_MODE_ID_PATTERN.test(id)) {
        return res
          .status(400)
          .json({ error: 'Invalid id：仅允许字母数字与 . _ -，以字母数字开头，最长 64 字符' });
      }
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (BUILTIN_TEACHING_MODES.some((b) => b.id === id)) {
        return res.status(409).json({ error: `"${id}" 是内置教学模式 id，请改用其他 id` });
      }
      if (db.prepare('SELECT id FROM teaching_modes WHERE id = ?').get(id)) {
        return res.status(409).json({ error: `Teaching mode "${id}" already exists` });
      }

      const now = Date.now();
      db.prepare(
        `INSERT INTO teaching_modes
           (id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).run(
        id,
        name.trim(),
        nameEn || null,
        description || null,
        descriptionEn || null,
        icon || null,
        color || null,
        Number.isFinite(sortOrder) ? sortOrder : 100,
        now,
      );
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/classroom/teaching-modes/:id', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const id = decodeURIComponent(req.params.id);
      const { name, nameEn, description, descriptionEn, icon, color, sortOrder } = req.body || {};

      const builtin = BUILTIN_TEACHING_MODES.find((b) => b.id === id);
      const existing = db.prepare('SELECT id FROM teaching_modes WHERE id = ?').get(id);
      const now = Date.now();

      if (!existing) {
        // 首次改写内置模式的文案：以 upsert 落库，保留 is_builtin=1 语义
        if (!builtin) return res.status(404).json({ error: `Teaching mode "${id}" not found` });
        db.prepare(
          `INSERT INTO teaching_modes
             (id, name, name_en, description, description_en, icon, color, is_builtin, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        ).run(
          id,
          name || builtin.name,
          nameEn ?? builtin.nameEn,
          description ?? builtin.description,
          descriptionEn ?? builtin.descriptionEn,
          icon ?? builtin.icon,
          color ?? builtin.color,
          Number.isFinite(sortOrder) ? sortOrder : builtin.sortOrder,
          now,
        );
        return res.json({ success: true, id, created: true });
      }

      // 已有记录：只更新传入字段（内置记录不可被改动 is_builtin）
      const sets: string[] = [];
      const args: any[] = [];
      const assign = (col: string, value: unknown) => {
        if (value !== undefined) {
          sets.push(`${col} = ?`);
          args.push(value);
        }
      };
      assign('name', typeof name === 'string' && name.trim() ? name.trim() : undefined);
      assign('name_en', nameEn);
      assign('description', description);
      assign('description_en', descriptionEn);
      assign('icon', icon);
      assign('color', color);
      assign('sort_order', Number.isFinite(sortOrder) ? sortOrder : undefined);

      if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });
      sets.push('updated_at = ?');
      args.push(now, id);
      db.prepare(`UPDATE teaching_modes SET ${sets.join(', ')} WHERE id = ?`).run(...args);

      res.json({ success: true, id, created: false });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/classroom/teaching-modes/:id', requireAuth('administrator'), (req: Request, res: Response) => {
    try {
      const id = decodeURIComponent(req.params.id);
      if (BUILTIN_TEACHING_MODES.some((b) => b.id === id)) {
        return res.status(403).json({ error: `内置教学模式 "${id}" 不可删除（可改写其文案）` });
      }
      const info = db.prepare('DELETE FROM teaching_modes WHERE id = ?').run(id);
      if (!info.changes) return res.status(404).json({ error: `Teaching mode "${id}" not found` });
      res.json({ success: true, id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 设置当次课堂选用的教学模式。id 为空字符串表示清除选择。
  app.put(
    '/api/classroom/sessions/:lessonId/teaching-mode',
    requireAuth('teacher', 'administrator'),
    async (req: Request, res: Response) => {
      try {
        const { lessonId } = req.params;
        const { teachingModeId, classId } = req.body || {};
        const teacherId = getActorId(req) || 'teacher';

        const modeId = typeof teachingModeId === 'string' && teachingModeId.trim() ? teachingModeId.trim() : null;
        if (modeId && !TEACHING_MODE_ID_PATTERN.test(modeId)) {
          return res.status(400).json({ error: 'Invalid teachingModeId' });
        }
        if (modeId) {
          const known =
            BUILTIN_TEACHING_MODES.some((b) => b.id === modeId) ||
            !!db.prepare('SELECT id FROM teaching_modes WHERE id = ?').get(modeId);
          if (!known) return res.status(404).json({ error: `Teaching mode "${modeId}" not found` });
        }

        const session = await classroomService.getOrCreateSession(lessonId, teacherId, classId);
        db.prepare('UPDATE classroom_sessions SET teaching_mode_id = ? WHERE id = ?').run(modeId, session.id);

        res.json({ success: true, sessionId: session.id, teachingModeId: modeId });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  // 课堂情绪与专注度时间序列与统计聚合
  app.get('/api/classroom/sessions/:lessonId/mood-tracker', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const windowMinutes = Math.min(60, Math.max(5, parseInt(req.query.minutes as string) || 15));
      const now = Date.now();
      const startTime = now - windowMinutes * 60 * 1000;

      const session = db
        .prepare('SELECT * FROM classroom_sessions WHERE lesson_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(lessonId) as any;

      const sessionId = session ? session.id : null;

      let pacingSignals: any[] = [];
      let pollVotes: any[] = [];
      let buzzers: any[] = [];
      let exitTickets: any[] = [];

      if (sessionId) {
        pacingSignals = db
          .prepare('SELECT signal_type, created_at FROM classroom_pacing_signals WHERE session_id = ? AND created_at >= ? ORDER BY created_at ASC')
          .all(sessionId, startTime) as any[];

        pollVotes = db
          .prepare(`
            SELECT v.selected_option, v.voted_at
            FROM classroom_poll_votes v
            JOIN classroom_quick_polls p ON v.poll_id = p.id
            WHERE p.session_id = ? AND v.voted_at >= ?
            ORDER BY v.voted_at ASC
          `)
          .all(sessionId, startTime) as any[];

        buzzers = db
          .prepare('SELECT created_at, status FROM classroom_buzzers WHERE session_id = ? AND created_at >= ?')
          .all(sessionId, startTime) as any[];

        exitTickets = db
          .prepare('SELECT rating, created_at FROM classroom_exit_tickets WHERE session_id = ? AND created_at >= ?')
          .all(sessionId, startTime) as any[];
      }

      // 按分钟切片生成时间序列
      const bucketCount = windowMinutes;
      const bucketSizeMs = 60 * 1000;
      const timelineData = [];

      let clearCount = 0;
      let confusedCount = 0;
      let tooFastCount = 0;

      for (let i = bucketCount - 1; i >= 0; i--) {
        const bucketStart = now - (i + 1) * bucketSizeMs;
        const bucketEnd = now - i * bucketSizeMs;
        const dateObj = new Date(bucketEnd);
        const timeLabel = `${dateObj.getHours().toString().padStart(2, '0')}:${dateObj.getMinutes().toString().padStart(2, '0')}`;

        const sliceSignals = pacingSignals.filter((s) => s.created_at >= bucketStart && s.created_at < bucketEnd);
        const sliceVotes = pollVotes.filter((v) => v.voted_at >= bucketStart && v.voted_at < bucketEnd);
        const sliceBuzzers = buzzers.filter((b) => b.created_at >= bucketStart && b.created_at < bucketEnd);

        const sliceClear = sliceSignals.filter((s) => s.signal_type === 'CLEAR').length;
        const sliceConfused = sliceSignals.filter((s) => s.signal_type === 'CONFUSED').length;
        const sliceTooFast = sliceSignals.filter((s) => s.signal_type === 'TOO_FAST').length;

        clearCount += sliceClear;
        confusedCount += sliceConfused;
        tooFastCount += sliceTooFast;

        const interactionFrequency = sliceSignals.length + sliceVotes.length + sliceBuzzers.length;

        // 专注度与能量动态加权模型
        let rawScore = 68 + interactionFrequency * 5 + sliceClear * 4 - sliceConfused * 7 - sliceTooFast * 5;
        if (interactionFrequency === 0 && sliceSignals.length === 0) {
          rawScore = 72;
        }
        const engagementScore = Math.min(100, Math.max(20, Math.round(rawScore)));
        const energyLevel = Math.min(100, Math.max(10, Math.round(50 + interactionFrequency * 10)));

        timelineData.push({
          time: timeLabel,
          timestamp: bucketEnd,
          engagement: engagementScore,
          energy: energyLevel,
          interactions: interactionFrequency,
          clear: sliceClear,
          confused: sliceConfused,
          tooFast: sliceTooFast,
        });
      }

      // 晴雨表与脉搏分布
      const pulseTotal = clearCount + confusedCount + tooFastCount;
      const clearPercent = pulseTotal > 0 ? Math.round((clearCount / pulseTotal) * 100) : 75;
      const confusedPercent = pulseTotal > 0 ? Math.round((confusedCount / pulseTotal) * 100) : 15;
      const tooFastPercent = pulseTotal > 0 ? Math.round((tooFastCount / pulseTotal) * 100) : 10;

      const recentBuckets = timelineData.slice(-3);
      const currentEngagement = Math.round(
        recentBuckets.reduce((acc, cur) => acc + cur.engagement, 0) / (recentBuckets.length || 1),
      );

      let moodStatus: 'OPTIMAL' | 'HIGH_ENERGY' | 'CONFUSED' | 'TOO_FAST' | 'CALM' = 'OPTIMAL';
      let moodLabel = '课堂节奏良好 · 专注度高';
      let moodEmoji = '🌟';

      if (confusedCount > 0 && confusedCount >= clearCount) {
        moodStatus = 'CONFUSED';
        moodLabel = '存在疑虑 · 需放慢停顿讲解';
        moodEmoji = '💡';
      } else if (tooFastCount > 0 && tooFastCount > clearCount * 0.4) {
        moodStatus = 'TOO_FAST';
        moodLabel = '进度过快 · 学生要求减速';
        moodEmoji = '⚡';
      } else if (currentEngagement >= 85) {
        moodStatus = 'HIGH_ENERGY';
        moodLabel = '互动活跃 · 气氛极度高涨';
        moodEmoji = '🔥';
      } else if (currentEngagement < 60) {
        moodStatus = 'CALM';
        moodLabel = '注意力分散 · 建议发起提问';
        moodEmoji = '💤';
      }

      res.json({
        success: true,
        session: session
          ? {
              id: session.id,
              stage: session.stage,
              lessonId,
              startedAt: session.started_at,
            }
          : null,
        metrics: {
          currentEngagement,
          moodStatus,
          moodLabel,
          moodEmoji,
          totalInteractions: pacingSignals.length + pollVotes.length + buzzers.length,
          interactionFrequencyPerMin: (
            (pacingSignals.length + pollVotes.length + buzzers.length) /
            windowMinutes
          ).toFixed(1),
          pulseDistribution: {
            clearCount,
            confusedCount,
            tooFastCount,
            total: pulseTotal,
            clearPercent,
            confusedPercent,
            tooFastPercent,
          },
        },
        timeline: timelineData,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 教师发起即时脉搏快检 (Pulse Check)
  app.post('/api/classroom/sessions/:lessonId/pulse-check', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const { prompt = '当前教学节奏与理解度实时脉搏自检', durationSec = 30 } = req.body;
      const teacherId = getActorId(req) || 'teacher';

      const session = await classroomService.getOrCreateSession(lessonId, teacherId);

      const pulseCheckPayload = {
        sessionId: session.id,
        lessonId,
        prompt,
        durationSec,
        options: [
          { type: 'CLEAR', label: '听懂了，跟得上节奏 🟢' },
          { type: 'CONFUSED', label: '有疑问，希望能细讲 🟡' },
          { type: 'TOO_FAST', label: '讲太快，建议慢一点 🔴' },
        ],
        timestamp: Date.now(),
      };

      if (io) {
        io.to(`lesson-${lessonId}`).emit('classroom:pulse_check_requested', pulseCheckPayload);
        io.emit('classroom:pulse_check_requested', pulseCheckPayload);
      }

      res.json({ success: true, pulseCheck: pulseCheckPayload });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 课堂随堂测验优秀榜 (Top 5 Performers based on cumulative scores from live quiz responses) ──
  app.get('/api/classroom/sessions/:lessonId/top-performers', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 5));

      // 1. 从关系型 lesson_quiz_submissions 表查询当前课节学生的累计得分与作答统计
      let rows: any[] = [];
      try {
        rows = db
          .prepare(`
            SELECT 
              s.student_id,
              COALESCE(s.student_name, stu.name, s.student_id) as student_name,
              SUM(s.score) as cumulative_score,
              COUNT(s.id) as total_quizzes_answered,
              SUM(s.is_correct) as correct_count,
              ROUND(AVG(s.is_correct) * 100, 1) as accuracy,
              ROUND(AVG(s.time_spent_ms), 0) as avg_time_spent_ms,
              MAX(s.submitted_at) as last_submitted_at
            FROM lesson_quiz_submissions s
            LEFT JOIN students stu ON s.student_id = stu.id
            WHERE s.lesson_id = ?
            GROUP BY s.student_id
            ORDER BY cumulative_score DESC, accuracy DESC, correct_count DESC
            LIMIT ?
          `)
          .all(lessonId, limit) as any[];
      } catch (err: any) {
        console.warn('[top-performers] query from lesson_quiz_submissions failed:', err?.message);
      }

      // 2. 如果关系表暂时无作答数据，补充从 whiteboard_elements (type='quiz') 摄取聚合
      if (!rows || rows.length === 0) {
        try {
          const quizElements = db
            .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'quiz'")
            .all(lessonId) as { data: string }[];

          if (quizElements.length > 0) {
            const studentMap: Record<
              string,
              {
                studentId: string;
                studentName: string;
                cumulativeScore: number;
                totalQuizzesAnswered: number;
                correctCount: number;
                lastSubmittedAt: number;
              }
            > = {};

            for (const el of quizElements) {
              try {
                const parsed = JSON.parse(el.data || '{}');
                const subs = parsed.submissions || {};
                const correctAnswer = parsed.correctAnswer;
                for (const [stId, subData] of Object.entries(subs) as [string, any][]) {
                  if (!studentMap[stId]) {
                    const stRow = db.prepare('SELECT name FROM students WHERE id = ?').get(stId) as any;
                    studentMap[stId] = {
                      studentId: stId,
                      studentName: stRow?.name || stId,
                      cumulativeScore: 0,
                      totalQuizzesAnswered: 0,
                      correctCount: 0,
                      lastSubmittedAt: subData.time || Date.now(),
                    };
                  }
                  const score =
                    typeof subData.score === 'number'
                      ? subData.score
                      : subData.answer === correctAnswer
                        ? 100
                        : 0;
                  studentMap[stId].cumulativeScore += score;
                  studentMap[stId].totalQuizzesAnswered += 1;
                  if (score > 0) studentMap[stId].correctCount += 1;
                  if (subData.time && subData.time > studentMap[stId].lastSubmittedAt) {
                    studentMap[stId].lastSubmittedAt = subData.time;
                  }
                }
              } catch (_) {}
            }

            rows = Object.values(studentMap)
              .map((s) => ({
                student_id: s.studentId,
                student_name: s.studentName,
                cumulative_score: s.cumulativeScore,
                total_quizzes_answered: s.totalQuizzesAnswered,
                correct_count: s.correctCount,
                accuracy:
                  s.totalQuizzesAnswered > 0 ? Math.round((s.correctCount / s.totalQuizzesAnswered) * 100) : 0,
                avg_time_spent_ms: 12000,
                last_submitted_at: s.lastSubmittedAt,
              }))
              .sort((a, b) => b.cumulative_score - a.cumulative_score || b.accuracy - a.accuracy)
              .slice(0, limit);
          }
        } catch (_) {}
      }

      // 3. 统计全班答题总览
      let totalResponses = 0;
      let averageScore = 0;
      try {
        const stats = db
          .prepare('SELECT COUNT(*) as count, AVG(score) as avg_score FROM lesson_quiz_submissions WHERE lesson_id = ?')
          .get(lessonId) as any;
        totalResponses = stats?.count || 0;
        averageScore = Math.round(stats?.avg_score || 0);
      } catch (_) {}

      res.json({
        success: true,
        lessonId,
        topPerformers: (rows || []).map((r, index) => ({
          rank: index + 1,
          studentId: r.student_id,
          studentName: r.student_name || `Student ${String(r.student_id).slice(-4)}`,
          cumulativeScore: Number(r.cumulative_score) || 0,
          totalQuizzesAnswered: Number(r.total_quizzes_answered) || 0,
          correctCount: Number(r.correct_count) || 0,
          accuracy: Number(r.accuracy) || 0,
          avgTimeSpentMs: Number(r.avg_time_spent_ms) || 0,
          lastSubmittedAt: Number(r.last_submitted_at) || Date.now(),
        })),
        summary: {
          totalParticipants: rows ? rows.length : 0,
          totalResponses,
          averageScore,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 通用顶尖答题表现榜单查询
  app.get('/api/classroom/top-performers', requireAuth('teacher', 'administrator'), (req: Request, res: Response) => {
    try {
      const lessonId = req.query.lessonId as string;
      if (lessonId) {
        // 重定向/复用具体课节查询逻辑
        return res.redirect(`/api/classroom/sessions/${lessonId}/top-performers`);
      }

      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 5));
      const rows = db
        .prepare(`
          SELECT 
            s.student_id,
            COALESCE(s.student_name, stu.name, s.student_id) as student_name,
            SUM(s.score) as cumulative_score,
            COUNT(s.id) as total_quizzes_answered,
            SUM(s.is_correct) as correct_count,
            ROUND(AVG(s.is_correct) * 100, 1) as accuracy,
            ROUND(AVG(s.time_spent_ms), 0) as avg_time_spent_ms,
            MAX(s.submitted_at) as last_submitted_at
          FROM lesson_quiz_submissions s
          LEFT JOIN students stu ON s.student_id = stu.id
          GROUP BY s.student_id
          ORDER BY cumulative_score DESC, accuracy DESC, correct_count DESC
          LIMIT ?
        `)
        .all(limit) as any[];

      res.json({
        success: true,
        topPerformers: (rows || []).map((r, index) => ({
          rank: index + 1,
          studentId: r.student_id,
          studentName: r.student_name || `Student ${String(r.student_id).slice(-4)}`,
          cumulativeScore: Number(r.cumulative_score) || 0,
          totalQuizzesAnswered: Number(r.total_quizzes_answered) || 0,
          correctCount: Number(r.correct_count) || 0,
          accuracy: Number(r.accuracy) || 0,
          avgTimeSpentMs: Number(r.avg_time_spent_ms) || 0,
          lastSubmittedAt: Number(r.last_submitted_at) || Date.now(),
        })),
        summary: {
          totalParticipants: rows.length,
          totalResponses: rows.reduce((acc, cur) => acc + (Number(cur.total_quizzes_answered) || 0), 0),
          averageScore:
            rows.length > 0
              ? Math.round(rows.reduce((acc, cur) => acc + (Number(cur.cumulative_score) || 0), 0) / rows.length)
              : 0,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 模拟产生实时随堂测验作答数据（供教师端测试、预览与演示）
  app.post('/api/classroom/sessions/:lessonId/simulate-quiz-responses', requireAuth('teacher', 'administrator'), async (req: Request, res: Response) => {
    try {
      const { lessonId } = req.params;
      const studentsList = db.prepare('SELECT id, name FROM students LIMIT 8').all() as { id: string; name: string }[];

      if (studentsList.length === 0) {
        return res.status(400).json({ error: 'No students found in system' });
      }

      const dummyElementId = `quiz_sim_${Date.now()}`;
      const questions = [
        'Newton Second Law F=ma',
        'Kinetic Energy Formula 1/2mv^2',
        'Gravitational Constant G',
        'Conservation of Momentum',
      ];
      const chosenQuestion = questions[Math.floor(Math.random() * questions.length)];

      const results = [];
      for (const st of studentsList) {
        const isCorrect = Math.random() > 0.2;
        const score = isCorrect ? Math.floor(Math.random() * 20 + 80) : Math.floor(Math.random() * 40);
        const timeSpent = Math.floor(Math.random() * 15000 + 4000);
        const subId = `sim-quiz-${lessonId}-${st.id}-${Date.now()}`;

        try {
          db.prepare(`
            INSERT INTO lesson_quiz_submissions
              (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, time_spent_ms, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE SET
              score = lesson_quiz_submissions.score + excluded.score,
              is_correct = excluded.is_correct,
              time_spent_ms = excluded.time_spent_ms,
              submitted_at = excluded.submitted_at
          `).run(subId, lessonId, dummyElementId, st.id, st.name, 'A', score, isCorrect ? 1 : 0, timeSpent, Date.now());
        } catch (_) {}

        const eventPayload = {
          lessonId,
          elementId: dummyElementId,
          studentId: st.id,
          studentName: st.name,
          answer: 'A',
          score,
          isCorrect,
          time: Date.now(),
          question: chosenQuestion,
        };

        if (io) {
          io.to(`lesson-${lessonId}`).emit('whiteboard-quiz-answered', eventPayload);
          io.emit('whiteboard-quiz-answered', eventPayload);
        }

        results.push({ studentId: st.id, name: st.name, score, isCorrect });
      }

      res.json({ success: true, count: results.length, submissions: results });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
