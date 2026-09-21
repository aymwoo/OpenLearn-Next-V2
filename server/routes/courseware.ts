import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { getCookieToken, getValidSession, getActorId, requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { injectLmsSdk } from './shared.js';
import { aggregateAttemptScore, describeAggregation } from '../../packages/plugins/courseware-score.js';
import { sendSafeError } from '../utils/error-handler.js';

export function registerCoursewareRoutes(ctx: ServerContext) {
  const { app, io } = ctx;

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

  function extractScoreCommentCompletion(payload: any) {
    let score: any = undefined;
    let comment: any = undefined;
    let completion: any = undefined;

    const keysToSearch = {
      score: ['score', 'grade', 'result', 'point', 'points', 'mark', 'marks', 'score_val', 'scoreval'],
      comment: ['comment', 'feedback', 'msg', 'message', 'text', 'note', 'memo'],
      completion: ['completion', 'progress', 'done', 'finished', 'completed', 'percentage'],
    };

    const searchObj = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      for (const key in obj) {
        const lowerKey = key.toLowerCase();

        if (keysToSearch.score.includes(lowerKey) && score === undefined) {
          score = obj[key];
        }
        if (keysToSearch.comment.includes(lowerKey) && comment === undefined) {
          comment = obj[key];
        }
        if (keysToSearch.completion.includes(lowerKey) && completion === undefined) {
          completion = obj[key];
        }
      }

      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          for (const subKey in obj[key]) {
            const lowerSubKey = subKey.toLowerCase();
            if (keysToSearch.score.includes(lowerSubKey) && score === undefined) {
              score = obj[key][subKey];
            }
            if (keysToSearch.comment.includes(lowerSubKey) && comment === undefined) {
              comment = obj[key][subKey];
            }
            if (keysToSearch.completion.includes(lowerSubKey) && completion === undefined) {
              completion = obj[key][subKey];
            }
          }
        }
      }
    };

    if (payload && typeof payload === 'object') {
      searchObj(payload);

      const urlString = payload.url || payload.action || '';
      if (typeof urlString === 'string' && urlString.includes('?')) {
        try {
          const queryPart = urlString.split('?')[1];
          const params = new URLSearchParams(queryPart);
          const queryObj: any = {};
          params.forEach((value, key) => {
            queryObj[key] = value;
          });
          searchObj(queryObj);
        } catch (e) {}
      }

      const bodyOrData = payload.data || payload.body;
      if (bodyOrData) {
        if (typeof bodyOrData === 'object') {
          searchObj(bodyOrData);
        } else if (typeof bodyOrData === 'string') {
          let parsed = null;
          try {
            parsed = JSON.parse(bodyOrData);
          } catch (e) {
            try {
              const params = new URLSearchParams(bodyOrData);
              const formObj: any = {};
              let hasKeys = false;
              params.forEach((value, key) => {
                formObj[key] = value;
                hasKeys = true;
              });
              if (hasKeys) {
                parsed = formObj;
              }
            } catch (e2) {}
          }
          if (parsed && typeof parsed === 'object') {
            searchObj(parsed);
          }
        }
      }
    }

    return { score, comment, completion };
  }

  app.post('/api/courseware/attempts/:attemptId/log', (req, res) => {
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

      io.emit('courseware-attempt-updated', { attemptId, type: 'log' });
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
      if (session.role !== 'teacher' && session.role !== 'administrator') {
        const attemptRow = kernelContainer.db
          .prepare('SELECT student_id FROM courseware_attempt WHERE id = ?')
          .get(attemptId) as { student_id: string } | undefined;
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

      const cmd = kernelContainer.commandBus.createCommand(
        'courseware.submit_attempt',
        payload,
        actorId,
      );
      const result = await kernelContainer.commandBus.execute(cmd);
      io.emit('courseware-attempt-updated', { attemptId, type: 'submit' });
      res.json(result);
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
  app.post('/api/courseware/attempts/:attemptId/adopt', (req, res) => {
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
        .get(attemptId) as
        | { id: string; courseware_id: string; student_id: string; status: string }
        | undefined;
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
          io.emit('courseware-attempt-updated', { attemptId, type: 'adopt' });
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
      io.emit('courseware-attempt-updated', { attemptId: own.id, type: 'adopt' });
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
        session?.role === 'teacher' ||
        session?.role === 'administrator' ||
        session?.subRole === 'administrator';

      // ?coursewareUuid=<uuid> 用于白板 HtmlAppletFrame 在嵌入某个具体课件时只拉取该课件的成绩，
      // 避免一次性回传整个 attempts 表（学生量大时会显著降低首屏 + 实时 socket 重拉的负载）。
      const coursewareUuid =
        typeof req.query.coursewareUuid === 'string' ? req.query.coursewareUuid.trim() : '';
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

  app.post('/api/courseware/debug', (req, res) => {
    try {
      const { msg, url, student, courseware } = req.body;
      const logMsg = `[CLIENT DEBUG] ${msg} | URL: ${url} | Student: ${JSON.stringify(student)} | Courseware: ${JSON.stringify(courseware)}`;
      console.log(`\x1b[35m[CLIENT DEBUG]\x1b[0m ${msg}`);

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

  app.get('/api/courseware/attempts/:attemptId/progress', (req, res) => {
    try {
      const { attemptId } = req.params;
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

  app.post('/api/courseware/attempts/:attemptId/promote', async (req, res) => {
    try {
      const { attemptId } = req.params;
      const { lessonId, classId } = req.body;

      if (!lessonId || !classId) {
        return res.status(400).json({ error: 'Missing lessonId or classId' });
      }

      const attempt = kernelContainer.db
        .prepare(
          `
        SELECT a.*, cw.name as courseware_name, cw.uuid as courseware_uuid,
               r.score, r.comment, r.completion, r.extra_json
        FROM courseware_attempt a
        JOIN courseware cw ON a.courseware_id = cw.id
        LEFT JOIN submission_result r ON a.id = r.attempt_id
        WHERE a.id = ?
      `,
        )
        .get(attemptId) as any;

      if (!attempt) {
        return res.status(404).json({ error: 'Attempt not found' });
      }

      const studentId = attempt.student_id;
      const coursewareName = attempt.courseware_name || '互动课件';
      const rawScore = attempt.score;
      const completion = attempt.completion || 0;

      let finalScore = 100;
      if (rawScore !== null && rawScore !== undefined) {
        if (rawScore >= 0 && rawScore <= 1.0 && rawScore !== 0) {
          finalScore = Math.round(rawScore * 100);
        } else {
          finalScore = Math.round(rawScore);
        }
      }

      const assignmentTitle = `互动课件: ${coursewareName}`;
      let assignment = kernelContainer.db
        .prepare('SELECT id FROM assignments WHERE class_id = ? AND lesson_id = ? AND title = ?')
        .get(classId, lessonId, assignmentTitle) as any;

      let assignmentId = assignment?.id;
      if (!assignmentId) {
        assignmentId = 'ast-cw-' + crypto.randomBytes(8).toString('hex');
        kernelContainer.db
          .prepare(
            'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            assignmentId,
            classId,
            lessonId,
            assignmentTitle,
            `来自互动课件 [${coursewareName}] 的随堂学习提交数据记录`,
            JSON.stringify({ type: 'interactive_courseware', attemptId, coursewareUuid: attempt.courseware_uuid }),
            Date.now(),
          );
      }

      kernelContainer.db
        .prepare(
          `
        INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'graded')
        ON CONFLICT(assignment_id, student_id) DO UPDATE SET
          content = excluded.content,
          score = excluded.score,
          feedback = excluded.feedback,
          submitted_at = excluded.submitted_at,
          graded_at = excluded.graded_at,
          status = 'graded'
      `,
        )
        .run(
          assignmentId,
          studentId,
          attempt.extra_json || '{}',
          finalScore,
          `由教师在课堂中保存录入。课件完成度: ${Math.round(completion * 100)}%。课件原始反�?: ${attempt.comment || '�?'}`,
          Date.now(),
          Date.now(),
        );

      kernelContainer.db
        .prepare(
          `
        INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
        VALUES (?, ?, 1, 100, '[]', ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = 1,
          progress_percent = 100
      `,
        )
        .run(studentId, lessonId, Date.now());

      io.emit('student-progress-updated', {
        studentId,
        lessonId,
        progressPercent: 100,
        completed: true,
        completedSegments: [],
      });

      res.json({ success: true, assignmentId, score: finalScore });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/courseware/:id', (req, res) => {
    try {
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
