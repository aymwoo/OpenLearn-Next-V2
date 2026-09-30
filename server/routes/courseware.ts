import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { injectLmsSdk } from './shared.js';
import { aggregateAttemptScore, describeAggregation } from '../../packages/plugins/courseware-score.js';
import { sendSafeError } from '../utils/error-handler.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';
import { extractScoreCommentCompletion } from '../utils/score-extract.js';
import { mintCoursewareToken, verifyCoursewareToken } from '../utils/courseware-access.js';
import {
  autoRecordAttempt,
  autoRecordForLesson,
  describePromoteReason,
  findActiveLessonForStudent,
  promoteAttemptToGrade,
} from '../utils/auto-record-score.js';

export function registerCoursewareRoutes(ctx: ServerContext) {
  const { app, io } = ctx;

  /** 课件 attempt 变更的统一发布入口（log / submit / adopt 三类）。 */
  const publishAttemptUpdated = (attemptId: string, type: 'log' | 'submit' | 'adopt') =>
    publishClassroomEvent(
      CLASSROOM_EVENTS.COURSEWARE_ATTEMPT_UPDATED,
      { attemptId, type },
      { correlationId: attemptId },
    );

  app.post('/api/courseware/upload', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { name, filename, base64Data } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand(
        'courseware.upload',
        { name, filename, base64Data },
        actorId,
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/confirm', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { uuid, name, entry } = req.body;
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand('courseware.confirm', { uuid, name, entry }, actorId);
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware', requireAuth(), async (req, res) => {
    try {
      const actorId = getActorId(req) || 'system';
      const cmd = kernelContainer.commandBus.createCommand('courseware.list', {}, actorId, { silent: true });
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/courseware/:id', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const actorId = getActorId(req) || 'teacher';
      const cmd = kernelContainer.commandBus.createCommand('courseware.delete', { id: req.params.id }, actorId);
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/log', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { eventType, payload } = req.body;

      // SEC-FIX: 会话与所属权检查，防止未授权恶意刷分/覆写日志
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);
      if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      if (session.role !== 'teacher' && session.role !== 'administrator') {
        const attemptRow = kernelContainer.db
          .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
          .get(attemptId) as { student_id: string } | undefined;
        if (attemptRow && attemptRow.student_id !== session.userId) {
          return res.status(403).json({ error: 'Forbidden: Cannot modify logs for another student' });
        }
      }

      const rawId = 'raw_' + crypto.randomBytes(8).toString('hex');
      kernelContainer.db
        .prepare(
          'INSERT INTO submission_raw (id, attempt_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(rawId, attemptId, eventType, JSON.stringify(payload), Date.now());

      const extracted = extractScoreCommentCompletion(payload);
      const comment = extracted.comment;
      const completion = extracted.completion;

      // 原生成绩归集：按课件成绩配置的策略（默认取最后一次）从样本历史算出官方成绩，
      // 这样 «最高分» / «平均分» 之类的策略才能真正生效（此前只保留最后一次）。
      let aggregatedScore: number | null = null;
      let aggregationExtra: Record<string, unknown> = {};
      try {
        const aggregation = aggregateAttemptScore(kernelContainer.db as any, attemptId);
        if (aggregation.finalScore !== null) aggregatedScore = aggregation.finalScore;
        aggregationExtra = { score_aggregation: describeAggregation(aggregation) };
      } catch (aggErr) {
        console.warn('[courseware.log] score aggregation failed, fallback to latest score:', aggErr);
      }

      if (aggregatedScore !== null || comment !== undefined || completion !== undefined) {
        let parsedScore: number | null = null;
        if (extracted.score !== undefined && extracted.score !== null) {
          const num = parseFloat(extracted.score);
          if (!isNaN(num)) {
            parsedScore = num;
          }
        }
        let parsedCompletion: number | null = null;
        if (completion !== undefined && completion !== null) {
          const num = parseFloat(completion);
          if (!isNaN(num)) {
            parsedCompletion = num;
          }
        }

        const existing = kernelContainer.db
          .prepare('SELECT * FROM submission_result WHERE attempt_id = ?')
          .get(attemptId) as any;
        if (!existing) {
          kernelContainer.db
            .prepare(
              'INSERT INTO submission_result (id, attempt_id, score, comment, completion, extra_json) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(
              'res_' + crypto.randomBytes(8).toString('hex'),
              attemptId,
              aggregatedScore !== null ? aggregatedScore : parsedScore,
              comment || null,
              parsedCompletion,
              JSON.stringify({
                ...(payload && typeof payload === 'object' ? payload : {}),
                ...aggregationExtra,
              }),
            );
        } else {
          const finalScore =
            aggregatedScore !== null ? aggregatedScore : parsedScore !== null ? parsedScore : existing.score;
          const finalComment = comment || existing.comment;
          const finalCompletion = parsedCompletion !== null ? parsedCompletion : existing.completion;

          let mergedExtra = {};
          try {
            mergedExtra = JSON.parse(existing.extra_json || '{}');
          } catch (e) {}
          if (payload && typeof payload === 'object') {
            mergedExtra = { ...mergedExtra, ...payload };
          }
          mergedExtra = { ...mergedExtra, ...aggregationExtra };

          kernelContainer.db
            .prepare(
              'UPDATE submission_result SET score = ?, comment = ?, completion = ?, extra_json = ? WHERE attempt_id = ?',
            )
            .run(finalScore, finalComment, finalCompletion, JSON.stringify(mergedExtra), attemptId);
        }
      }

      await publishAttemptUpdated(attemptId, 'log');
      void kernelContainer.eventBus.publish({
        id: 'evt_' + crypto.randomBytes(8).toString('hex'),
        type: 'courseware.event_logged',
        source: 'builtin.courseware',
        payload: { attemptId, eventType, payload },
        timestamp: Date.now(),
        correlationId: attemptId,
      });
      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/submit', async (req, res) => {
    try {
      const { attemptId } = req.params;
      let { score, comment, completion, status, extra = {} } = req.body;

      // SEC-FIX: 会话与所属权检查，防止未授权改分或冒名提交
      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);
      if (!session) {
        return res.status(401).json({ error: 'Authentication required to submit attempt scores' });
      }
      const attemptRow = kernelContainer.db
        .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { student_id: string } | undefined;
      if (session.role !== 'teacher' && session.role !== 'administrator') {
        if (attemptRow && attemptRow.student_id !== session.userId) {
          return res.status(403).json({ error: 'Forbidden: Cannot submit scores for another student' });
        }
      }

      const extracted = extractScoreCommentCompletion({ ...req.body, ...extra });
      if (score === undefined || score === null) score = extracted.score;
      if (comment === undefined || comment === null) comment = extracted.comment;
      if (completion === undefined || completion === null) completion = extracted.completion;

      let parsedScore: number | null = null;
      if (score !== undefined && score !== null) {
        const num = parseFloat(score);
        if (!isNaN(num)) {
          parsedScore = num;
        }
      }
      let parsedCompletion: number | null = null;
      if (completion !== undefined && completion !== null) {
        const num = parseFloat(completion);
        if (!isNaN(num)) {
          parsedCompletion = num;
        }
      }

      // CapabilityGuard 的角色兜底依赖 actorId 的 `:role` 后缀（见 packages/core/capability-system）。
      // 直接传裸 session.userId 会让 `courseware.submit_attempt` 的 student:write 校验失败，
      // 学生真实提交与教师课件预览提交都会 500（历史缺陷，见 courseware-submit-actor.test.ts）。
      const normalizedActorId = getActorId(req);
      const actorId =
        normalizedActorId && normalizedActorId !== 'anonymous'
          ? normalizedActorId
          : `user:${session.userId || session.studentId || 'student'}:${session.role || 'student'}`;
      // 命令 payload 需剔空：validateJsonSchema 把显式 null 当作已提供值校验
      // （`key in data && data[key] !== undefined`），completion/score 传 null 会 500 PayloadValidationError。
      const payload: Record<string, any> = { attemptId };
      if (parsedScore !== null) payload.score = parsedScore;
      if (parsedCompletion !== null) payload.completion = parsedCompletion;
      if (comment !== undefined && comment !== null) payload.comment = comment;
      if (status !== undefined && status !== null) payload.status = status;
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) payload.extra = extra;

      const cmd = kernelContainer.commandBus.createCommand('courseware.submit_attempt', payload, actorId);
      const result = await kernelContainer.commandBus.execute(cmd);
      await publishAttemptUpdated(attemptId, 'submit');

      // 自动录入（实时路径）：教师预设规则后，学生提交即刻写入学期成绩。
      //
      // 安全边界：规则由教师在设置里开启；这里只会录入**调用者自己** attempt 的分数
      // （上方已校验 attempt 归属），且 promoteAttemptToGrade 对同一 (作业, 学生) 幂等覆盖，
      // 因此重复提交不会刷分、不会叠加。
      // 任何异常都必须吞掉 —— 成绩录入是附加能力，绝不能让学生提交失败。
      let autoRecord: { recorded: boolean; reason?: string } | null = null;
      try {
        const studentId = attemptRow?.student_id || session.userId || session.studentId;
        const activeLesson = studentId ? findActiveLessonForStudent(kernelContainer.db as any, studentId) : null;
        if (activeLesson) {
          const outcome = autoRecordAttempt(kernelContainer.db as any, attemptId, activeLesson);
          autoRecord = outcome.ok ? { recorded: true } : { recorded: false, reason: outcome.reason };
        } else {
          // 上课之外（或查不到进行中的课节）不实时录入，交由「学生提交数据」页补录兜底
          autoRecord = { recorded: false, reason: 'no-active-lesson' };
        }
      } catch (autoErr) {
        console.warn('[courseware.submit] auto-record skipped:', autoErr);
        autoRecord = { recorded: false, reason: 'auto-record-error' };
      }

      res.json({ ...(result as object), autoRecord });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * POST /api/courseware/attempts/:attemptId/adopt
   *
   * 归属认领。
   *
   * 背景：课件 iframe 以 `credentialless` + `sandbox`（无 allow-same-origin）加载，
   * 访问 `/runtime/:uuid/` 时**不携带会话 cookie**，`injectLmsSdk` 只能把访问者识别为匿名，
   * 建出一条 `student_id='guest'` 的共享 attempt（同一课件的所有匿名访问者复用同一条）。
   * 于是所有学生共用一个 attempt，真实学生 `POST /submit` 时因
   * `attempt.student_id('guest') !== session.userId` 被 403 丢弃。
   *
   * 持有会话 cookie 的父窗口在转发上报前先调用本接口，把 attempt 认领到当前学生名下：
   *   - 已是本人 attempt  → 原样返回（幂等）
   *   - 无主 attempt（guest/teacher 哨兵）→ 直接改归属，保留已产生的原始流水
   *   - 已被其他真实学生占用 → 为当前学生复用/新建自己的 active attempt，返回新 id
   *
   * 教师/管理员预览不受归属约束，原样返回。
   */
  app.post('/api/courseware/attempts/:attemptId/adopt', async (req, res) => {
    try {
      const { attemptId } = req.params;

      const token = getCookieToken(req);
      const session = (req as any).session || (token ? getValidSession(token) : null);
      if (!session) {
        return res.status(401).json({ error: 'Authentication required to adopt an attempt' });
      }

      const db = kernelContainer.db;
      const attemptRow = db
        .prepare('SELECT id, courseware_id, student_id, status FROM courseware_attempt WHERE id = ?')
        .get(attemptId) as { id: string; courseware_id: string; student_id: string; status: string } | undefined;
      if (!attemptRow) {
        return res.status(404).json({ error: 'Attempt not found' });
      }

      // 教师/管理员：预览用，不参与归属约束
      if (session.role === 'teacher' || session.role === 'administrator') {
        return res.json({ attemptId, adopted: false, reused: true, role: session.role });
      }

      const studentId = session.userId || session.studentId;
      if (!studentId) {
        return res.status(400).json({ error: 'Session has no student identity' });
      }

      // 已归属当前学生 → 幂等返回
      if (attemptRow.student_id === studentId) {
        return res.json({ attemptId, adopted: false, reused: true });
      }

      // 无主 attempt（injectLmsSdk 写入的匿名/预览哨兵）→ 直接认领，保留已产生的原始流水
      const UNOWNED_OWNERS = ['guest', 'teacher', 'teacher_preview', ''];
      if (UNOWNED_OWNERS.includes(attemptRow.student_id)) {
        const info = db
          .prepare(
            "UPDATE courseware_attempt SET student_id = ? WHERE id = ? AND student_id IN ('guest','teacher','teacher_preview','')",
          )
          .run(studentId, attemptId);
        if (info.changes > 0) {
          await publishAttemptUpdated(attemptId, 'adopt');
          return res.json({ attemptId, adopted: true, reused: true });
        }
      }

      // attempt 已被其他真实学生占用 → 为当前学生复用/新建他自己的 active attempt
      let own = db
        .prepare('SELECT id FROM courseware_attempt WHERE courseware_id = ? AND student_id = ? AND status = ?')
        .get(attemptRow.courseware_id, studentId, 'active') as { id: string } | undefined;
      if (!own) {
        const newId = 'att_' + crypto.randomBytes(8).toString('hex');
        db.prepare(
          'INSERT INTO courseware_attempt (id, courseware_id, student_id, started_at, status) VALUES (?, ?, ?, ?, ?)',
        ).run(newId, attemptRow.courseware_id, studentId, Date.now(), 'active');
        own = { id: newId };
      }
      await publishAttemptUpdated(own.id, 'adopt');
      return res.json({
        attemptId: own.id,
        adopted: false,
        reused: true,
        reason: 'attempt-owned-by-another-student',
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // 成绩榜对全班可见（白板课件元素的「查看成绩」浮层），但必须鉴权 + 按角色裁剪字段：
  // 学生只需要榜单信息（姓名/分数/完成度/名次），绝不能拿到 extra_json（原始作答明细，
  // 会被同学直接抄答案）与 comment（教师评语）。教师/管理员保持完整行。
  app.get('/api/courseware/attempts', requireAuth(), (req, res) => {
    try {
      const session = (req as any).session as { role?: string; subRole?: string } | undefined;
      const isStaff =
        session?.role === 'teacher' || session?.role === 'administrator' || session?.subRole === 'administrator';

      // ?coursewareUuid=<uuid> 用于白板 HtmlAppletFrame 在嵌入某个具体课件时只拉取该课件的成绩，
      // 避免一次性回传整个 attempts 表（学生量大时会显著降低首屏 + 实时 socket 重拉的负载）。
      const coursewareUuid = typeof req.query.coursewareUuid === 'string' ? req.query.coursewareUuid.trim() : '';
      const baseSql = `
        SELECT a.id as attemptId, a.started_at, a.finished_at, a.status,
               cw.name as coursewareName, cw.uuid as coursewareUuid,
               COALESCE(s.name, CASE WHEN a.student_id = 'teacher' THEN 'Teacher (Test)' WHEN a.student_id = 'guest' THEN 'Guest Student' ELSE a.student_id END) as studentName,
               a.student_id as studentId,
               r.score, r.comment, r.completion, r.extra_json,
               (
                 SELECT COUNT(*) FROM assignment_submissions sub
                 JOIN assignments ast ON sub.assignment_id = ast.id
                 WHERE sub.student_id = a.student_id
                   AND ast.title = '互动课件: ' || cw.name
               ) as isPromoted
        FROM courseware_attempt a
        JOIN courseware cw ON a.courseware_id = cw.id
        LEFT JOIN students s ON a.student_id = s.id
        LEFT JOIN submission_result r ON a.id = r.attempt_id
      `;
      const sql = coursewareUuid
        ? `${baseSql} WHERE cw.uuid = ? ORDER BY a.started_at DESC`
        : `${baseSql} ORDER BY a.started_at DESC`;
      const stmt = kernelContainer.db.prepare(sql);
      const rows = (coursewareUuid ? stmt.all(coursewareUuid) : stmt.all()) as Array<Record<string, any>>;
      if (isStaff) {
        res.json(rows);
        return;
      }
      res.json(
        rows.map((row) => {
          const sanitized = { ...row };
          delete sanitized.extra_json;
          delete sanitized.comment;
          return sanitized;
        }),
      );
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/debug', requireAuth(), (req, res) => {
    try {
      const { msg, url, student, courseware } = req.body;
      // SEC-FIX: limit log entry size to prevent disk fill / injection
      const safeMsg = typeof msg === 'string' ? msg.slice(0, 2000) : String(msg).slice(0, 2000);
      const safeUrl = typeof url === 'string' ? url.slice(0, 1000) : String(url).slice(0, 1000);
      const logMsg = `[CLIENT DEBUG] ${safeMsg} | URL: ${safeUrl} | Student: ${JSON.stringify(student)?.slice(0, 1000)} | Courseware: ${JSON.stringify(courseware)?.slice(0, 1000)}`;
      console.log(`\x1b[35m[CLIENT DEBUG]\x1b[0m ${safeMsg}`);

      const logFile = path.join(process.cwd(), 'client_debug.log');
      fs.appendFileSync(logFile, `${new Date().toISOString()} - ${logMsg}\n`);

      res.json({ success: true });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // 原始作答数据含学生答案明细：修复前无 requireAuth 且 actorId 硬编码 'teacher-demo'
  // （种子能力含 lesson:*，恰满足该命令要求的 lesson:read），任何人凭 attemptId 即可越权读取。
  // 现行口径：需登录；教师/管理员可读任意 attempt，其他角色（含学生）仅能读自己的，
  // 与 /submit 的所属权口径一致 —— 这样既不放开跨学生读取，也不打断“看自己作答详情”的调用方。
  app.get('/api/courseware/attempts/:attemptId/raw', requireAuth(), async (req, res) => {
    try {
      const { attemptId } = req.params;
      const session = (req as any).session;
      if (session.role !== 'teacher' && session.role !== 'administrator') {
        const owner = kernelContainer.db
          .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
          .get(attemptId) as { student_id: string } | undefined;
        // 不存在与非本人同样返回 403，避免用状态码枚举 attempt 是否存在
        if (!owner || owner.student_id !== (session.userId || session.studentId)) {
          return res.status(403).json({ error: 'Forbidden: Cannot read another student attempt' });
        }
      }
      const cmd = kernelContainer.commandBus.createCommand(
        'courseware.get_attempt_raw_data',
        { attemptId },
        getActorId(req),
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/attempts/:attemptId/progress', requireAuth(), (req, res) => {
    try {
      const { attemptId } = req.params;
      const session = (req as any).session as
        { role?: string; subRole?: string; userId?: string; studentId?: string } | undefined;
      if (
        session &&
        session.role !== 'teacher' &&
        session.role !== 'administrator' &&
        session.subRole !== 'administrator'
      ) {
        const owner = kernelContainer.db
          .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
          .get(attemptId) as { student_id: string } | undefined;
        if (!owner || owner.student_id !== (session.userId || session.studentId)) {
          return res.status(403).json({ success: false, error: 'Forbidden: Cannot read another student attempt' });
        }
      }
      const result = kernelContainer.db
        .prepare('SELECT score, comment, completion, extra_json FROM submission_result WHERE attempt_id = ?')
        .get(attemptId) as any;
      if (!result) {
        return res.json({ progress: null });
      }
      let extra = {};
      try {
        extra = JSON.parse(result.extra_json || '{}');
      } catch {
        /* ignore malformed extra */
      }
      res.json({
        progress: { score: result.score, comment: result.comment, completion: result.completion, extra },
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/courseware/attempts/:attemptId/promote', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { lessonId, classId } = req.body;

      if (!lessonId || !classId) {
        return res.status(400).json({ error: 'Missing lessonId or classId' });
      }

      // 与「自动录入规则」共用同一落库实现，保证手动/自动两条路径口径一致。
      // ignoreNotFinished / ignoreMinCompletion：手动录入是教师的显式判断，
      // 不被规则的门槛与状态校验收窄能力（与改动前的行为保持一致）。
      // 注意「没有分数」两条路径都拒绝 —— 无从搬运的分数绝不凭空生成。
      const result = promoteAttemptToGrade(kernelContainer.db as any, attemptId, {
        lessonId,
        classId,
        sourceLabel: '教师在课堂中保存录入',
        ignoreMinCompletion: true,
        ignoreNotFinished: true,
      });

      if (!result.ok) {
        const status = result.reason === 'attempt-not-found' ? 404 : 422;
        return res
          .status(status)
          .json({ success: false, error: describePromoteReason(result.reason), reason: result.reason });
      }

      await publishClassroomEvent(
        CLASSROOM_EVENTS.STUDENT_PROGRESS_UPDATED,
        {
          studentId: result.studentId,
          lessonId,
          progressPercent: 100,
          completed: true,
          completedSegments: [],
        },
        { correlationId: lessonId },
      );

      res.json({ success: true, assignmentId: result.assignmentId, score: result.score });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 自动录入成绩：把某课节 + 班级下已提交但尚未录入的 attempt 按规则补录。
   * 教师打开「学生提交数据」页时自动调用，也可手动点「立即补录」强制重跑。
   */
  app.post('/api/courseware/attempts/auto-record', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const { lessonId, classId, limit } = req.body || {};
      if (!lessonId || !classId) {
        return res.status(400).json({ error: 'Missing lessonId or classId' });
      }
      const report = autoRecordForLesson(kernelContainer.db as any, { lessonId, classId, limit });
      res.json({ success: true, ...report });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  /**
   * 铸造课件 HTML 访问 token：供已认证的父页面取回后拼进 iframe src（`?ct=`）。
   * 沙箱 iframe 的请求不携带会话 cookie（见 server/utils/courseware-access.ts），
   * 这是 `GET /api/courseware/:id` 唯一可行的鉴权通道。
   */
  app.get('/api/courseware/:id/access-token', requireAuth(), (req, res) => {
    res.json({ token: mintCoursewareToken(req.params.id) });
  });

  app.get('/api/courseware/:id', (req, res) => {
    try {
      // SEC-AUTH: 沙箱 iframe 不带会话 cookie，无法 requireAuth；
      // 改为验证父页面铸造的短时 HMAC token（与 :id 绑定 + 有效期），未带/无效一律 401，
      // 同时挡住「未认证读取课件 HTML」与「未认证触发 courseware 行自动登记」两个面。
      if (!verifyCoursewareToken(req.params.id, typeof req.query.ct === 'string' ? req.query.ct : null)) {
        return res.status(401).send('Courseware access token missing or invalid');
      }
      const node = kernelContainer.db.prepare('SELECT * FROM vfs_nodes WHERE id = ?').get(req.params.id) as any;
      if (!node || node.type !== 'file') return res.status(404).send('Courseware not found');

      const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(node.id);
      if (!existingCw) {
        kernelContainer.db
          .prepare('INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(node.id, node.id, node.name, 'html', node.name, Date.now());
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const html = injectLmsSdk(node.content || '', req, { id: node.id, name: node.name, uuid: node.id });
      res.send(html);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });
}
