import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IDatabaseToken,
  ISemesterGradeServiceToken,
} from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';

/**
 * 作业中心（Assignment Hub）
 *
 * 设计要点：
 *  1. 作业是一等实体（plugin_assignments），可同时挂 lesson_id / class_id /
 *     element_id（白板上的「课堂作业任务」教学对象）。白板对象与班级作业成绩页
 *     共用同一份数据，成绩最终投影回 `assignments` + `assignment_submissions`。
 *  2. 每次提交写入 plugin_submission_versions，重交不覆盖历史。
 *  3. 文件本体由宿主落盘，本插件只维护 plugin_assignment_files 元数据。
 *  4. 所有写操作在能力校验之外再做 actorId 所属权校验：学生只能操作自己的数据。
 */

const PRIVILEGED_ROLES = ['teacher', 'administrator', 'admin'];

interface ActorInfo {
  userId: string;
  role: string;
}

/** 解析 `user:<id>:<role>` 形式的 actorId；系统/Agent 调用返回 null。 */
function parseActorId(actorId?: string): ActorInfo | null {
  const match = /^user:([^:]+):(.+)$/.exec(String(actorId || ''));
  if (!match) return null;
  return { userId: match[1], role: match[2] };
}

/** 无 `user:` 前缀（系统 / Agent）或教师、管理员视为特权调用者。 */
function isPrivilegedActor(actorId?: string): boolean {
  const actor = parseActorId(actorId);
  if (!actor) return true;
  return PRIVILEGED_ROLES.includes(actor.role);
}

/** 写库时统一保存「用户 ID」，而不是 `user:<id>:<role>` 形式的完整 actorId。 */
function actorUserId(actorId?: string): string | null {
  return parseActorId(actorId)?.userId ?? actorId ?? null;
}

/**
 * 所属权校验：学生只能对自己名下的数据执行写操作。
 * 特权角色（教师/管理员/系统）放行，便于教师代交、试评与终评。
 */
function assertStudentOwnership(actorId: string | undefined, studentId: string, action: string): void {
  if (isPrivilegedActor(actorId)) return;
  const actor = parseActorId(actorId);
  if (!actor || actor.userId !== studentId) {
    throw new Error(`Access Denied: Students can only ${action} their own assignment`);
  }
}

export const AssignmentEvalPlugin = {
  manifest: {
    id: '@openlearn/plugin-assignment-eval',
    name: '作业评测与互评插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
      '@openlearn/core:ISemesterGradeService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
    ],
    capabilitiesProposed: ['assignment:read', 'assignment:submit', 'assignment:review', 'assignment:manage'],
    engines: { openlearn: '>=0.2.5' },
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);
    const gradeService = await ctx.resolve(ISemesterGradeServiceToken);

    // 让激活可重复调用（PluginHost 的 DB 恢复与内核 bootstrap 都可能触发同一次激活）：
    // 先撤掉本插件自己的命令与 action，再撤掉 management.ts 的同名命令/action。
    const OWNED_COMMAND_TYPES = [
      'assignment.create',
      'assignment.list',
      'assignment.get',
      'assignment.submit',
      'assignment.peer_review',
      'assignment.assign_peer_reviews',
      'assignment.grade',
    ];
    const OWNED_ACTION_IDS = [
      'eval-assignment-create',
      'eval-assignment-list',
      'eval-assignment-get',
      'eval-assignment-submit',
      'eval-assignment-peer-review',
      'eval-assignment-assign-peer-reviews',
      'eval-assignment-grade',
    ];

    for (const type of OWNED_COMMAND_TYPES) {
      commandBus.unregisterHandler(type);
    }
    for (const id of OWNED_ACTION_IDS) {
      actionRegistry.unregister(id);
    }

    // Unregister existing core command handlers to avoid conflict
    commandBus.unregisterHandler('assignment.submit');
    commandBus.unregisterHandler('assignment.grade');

    // Unregister existing action descriptors to avoid ID conflicts
    //
    // 注意：`ActionRegistry.getActionByCommandType()` 返回**最先注册**的那条描述符，
    // 由它决定内核的 payloadSchema 校验。management.ts 早在内核 bootstrap 阶段就注册了
    // `core-assignment-create`（`required: ['classId','title']`），若不撤销，作业中心
    // 的 `POST /api/assignments` 会在创建「不挂班级、只挂课时」的作业时被误判为
    // `Missing required property "classId"`。`server/routes/assignments.ts` 的旧班级作业页
    // 直接写 `assignments` 表、不经命令总线，因此这里接管 `assignment.create` 不影响旧链路。
    actionRegistry.unregister('core-assignment-create');
    actionRegistry.unregister('core-assignment-submit');
    actionRegistry.unregister('core-assignment-grade');

    // ── 内部工具 ───────────────────────────────────────────────────────────
    interface AssignmentRow {
      id: string;
      class_id: string | null;
      lesson_id: string | null;
      element_id: string | null;
      title: string;
      due_at: number | null;
      allow_late: number;
      allow_text: number;
      allow_link: number;
      max_files: number;
      max_file_size: number;
      peer_review_count: number;
      peer_review_due_at: number | null;
      teacher_weight: number;
      peer_weight: number;
      status: string;
    }

    const loadAssignment = (assignmentId: string): AssignmentRow | undefined =>
      db.prepare('SELECT * FROM plugin_assignments WHERE id = ?').get(assignmentId) as AssignmentRow | undefined;

    /**
     * 解析目标作业：
     *  - 传 assignmentId → 直接读取（不存在报错）
     *  - 只传 lessonId（旧版课时作业入口）→ 找该课时最早的作业；没有则自动创建一个
     *    默认作业，使旧入口的数据也落在作业实体上（不再散落成孤立记录）
     */
    const resolveAssignment = (assignmentId?: string | null, lessonId?: string | null): AssignmentRow => {
      if (assignmentId) {
        const row = loadAssignment(assignmentId);
        if (!row) throw new Error(`Assignment not found: ${assignmentId}`);
        return row;
      }
      if (lessonId) {
        const existing = db
          .prepare('SELECT * FROM plugin_assignments WHERE lesson_id = ? ORDER BY created_at ASC LIMIT 1')
          .get(lessonId) as AssignmentRow | undefined;
        if (existing) return existing;
        const now = Date.now();
        const autoId = 'asg-' + uuidv7();
        db.prepare(
          `INSERT INTO plugin_assignments
             (id, class_id, lesson_id, element_id, title, description, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
        ).run(autoId, null, lessonId, null, '本课作业', '由课时作业入口自动创建', null, now, now);
        return loadAssignment(autoId)!;
      }
      throw new Error('Missing required params: assignmentId or lessonId');
    };

    /** 提交物的最新版本（互评人只应该看到作者当前版本的作业） */
    const latestVersionOfSubmission = (submissionId: string) =>
      db
        .prepare(
          'SELECT id, version, text_content, link_url, submitted_at, is_late FROM plugin_submission_versions WHERE submission_id = ? ORDER BY version DESC LIMIT 1',
        )
        .get(submissionId) as
        | { id: string; version: number; text_content: string | null; link_url: string | null; submitted_at: number; is_late: number }
        | undefined;

    const filesOfVersion = (versionId: string) =>
      db
        .prepare(
          'SELECT id, original_name, size, mime FROM plugin_assignment_files WHERE version_id = ? AND deleted_at IS NULL ORDER BY uploaded_at ASC',
        )
        .all(versionId) as { id: string; original_name: string; size: number; mime: string | null }[];

    /**
     * 学生视角的互评任务视图。
     *
     * 双盲：这里只返回被评作业的内容与自己的评分，**绝不返回作者身份**（student_id /
     * 姓名），匿名标签由前端按任务序号生成。
     */
    const buildPeerReviewTasks = (assignmentId: string, reviewerId: string) => {
      const tasks = db
        .prepare(
          'SELECT id, submission_id, anonymous, status, due_at, created_at FROM plugin_peer_review_tasks WHERE assignment_id = ? AND reviewer_id = ? ORDER BY created_at ASC',
        )
        .all(assignmentId, reviewerId) as {
        id: string;
        submission_id: string;
        anonymous: number;
        status: string;
        due_at: number | null;
        created_at: number;
      }[];

      return tasks.map((task) => {
        const version = latestVersionOfSubmission(task.submission_id);
        const review = db
          .prepare(
            'SELECT score, comment, status, updated_at FROM plugin_peer_reviews WHERE submission_id = ? AND reviewer_id = ?',
          )
          .get(task.submission_id, reviewerId) as
          | { score: number; comment: string | null; status: string; updated_at: number | null }
          | undefined;
        const submissionUpdatedAt =
          (db.prepare('SELECT updated_at FROM plugin_submissions WHERE id = ?').get(task.submission_id) as
            | { updated_at: number }
            | undefined)?.updated_at ?? null;
        return {
          taskId: task.id,
          submissionId: task.submission_id,
          status: task.status,
          anonymous: Number(task.anonymous) === 1,
          dueAt: task.due_at ?? null,
          createdAt: task.created_at,
          // 我评完之后作者又改过提交 → 提醒复核
          stale: Boolean(
            review?.status === 'submitted' &&
              submissionUpdatedAt &&
              Number(review.updated_at || 0) < Number(submissionUpdatedAt),
          ),
          review: review
            ? { score: review.score, comment: review.comment || '', submittedAt: review.updated_at ?? null }
            : null,
          submission: version
            ? {
                version: version.version,
                textContent: version.text_content || '',
                linkUrl: version.link_url || '',
                submittedAt: version.submitted_at,
                isLate: Number(version.is_late) === 1,
                files: filesOfVersion(version.id),
              }
            : null,
        };
      });
    };

    /**
     * 教师视角的互评进度与异常标记（双盲只约束学生之间，教师可看到姓名）。
     */
    const buildPeerProgress = (assignmentId: string) => {
      const nameOf = (studentId: string) => {
        try {
          const row = db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as { name: string } | undefined;
          return row?.name || studentId;
        } catch {
          // students 表可能不存在（精简部署 / 单元测试），退化为用户 ID
          return studentId;
        }
      };

      const tasks = db
        .prepare('SELECT reviewer_id, status FROM plugin_peer_review_tasks WHERE assignment_id = ?')
        .all(assignmentId) as { reviewer_id: string; status: string }[];

      const byReviewer = new Map<string, { studentId: string; name: string; pending: number; submitted: number }>();
      for (const task of tasks) {
        const entry =
          byReviewer.get(task.reviewer_id) ||
          { studentId: task.reviewer_id, name: nameOf(task.reviewer_id), pending: 0, submitted: 0 };
        if (task.status === 'submitted') entry.submitted += 1;
        else entry.pending += 1;
        byReviewer.set(task.reviewer_id, entry);
      }

      const flags: { type: string; reviewerId?: string; detail: string }[] = [];
      for (const entry of byReviewer.values()) {
        if (entry.pending > 0) {
          flags.push({
            type: 'peer_review_pending',
            reviewerId: entry.studentId,
            detail: `${entry.name} 还有 ${entry.pending} 份互评未完成`,
          });
        }
        if (entry.submitted >= 2) {
          const full = (
            db
              .prepare(
                'SELECT COUNT(*) AS c FROM plugin_peer_reviews WHERE assignment_id = ? AND reviewer_id = ? AND score >= 100',
              )
              .get(assignmentId, entry.studentId) as { c: number }
          ).c;
          if (full >= entry.submitted) {
            flags.push({
              type: 'all_full_marks',
              reviewerId: entry.studentId,
              detail: `${entry.name} 的 ${entry.submitted} 份互评全部给了满分，建议复核`,
            });
          }
        }
      }

      const gaps = db
        .prepare(
          `SELECT r.reviewer_id AS reviewerId, r.score AS peerScore, g.teacher_score AS teacherScore, s.student_id AS authorId
             FROM plugin_peer_reviews r
             JOIN plugin_grades g ON g.submission_id = r.submission_id
             JOIN plugin_submissions s ON s.id = r.submission_id
            WHERE r.assignment_id = ? AND g.teacher_score IS NOT NULL`,
        )
        .all(assignmentId) as { reviewerId: string; peerScore: number; teacherScore: number; authorId: string }[];
      for (const gap of gaps) {
        if (Math.abs(Number(gap.peerScore) - Number(gap.teacherScore)) <= 25) continue;
        flags.push({
          type: 'score_gap',
          reviewerId: gap.reviewerId,
          detail: `${nameOf(gap.reviewerId)} 给 ${nameOf(gap.authorId)} 的互评分 ${gap.peerScore}，与教师评分 ${gap.teacherScore} 相差较大`,
        });
      }

      const submissionCount = (
        db.prepare('SELECT COUNT(*) AS c FROM plugin_submissions WHERE assignment_id = ?').get(assignmentId) as {
          c: number;
        }
      ).c;
      const completed = tasks.filter((t) => t.status === 'submitted').length;

      return {
        submissions: submissionCount,
        tasks: tasks.length,
        completed,
        pending: tasks.length - completed,
        reviewers: Array.from(byReviewer.values()).sort((a, b) => b.pending - a.pending),
        flags,
      };
    };

    const publishEvent = async (type: string, payload: Record<string, unknown>, correlationId?: string) => {
      if (!eventBus || typeof eventBus.publish !== 'function') return;
      try {
        await eventBus.publish({
          id: uuidv7(),
          type,
          source: 'assignment-eval',
          payload,
          timestamp: Date.now(),
          correlationId,
        });
      } catch (err) {
        ctx.log?.warn?.(`[assignment-eval] 发布事件 ${type} 失败: ${(err as Error)?.message}`);
      }
    };

    // ── 0. 作业实体管理 ────────────────────────────────────────────────────
    await actionRegistry.register({
      id: 'eval-assignment-create',
      commandType: 'assignment.create',
      description: '创建或更新作业实体（可同时绑定课时、班级与白板元素）',
      capabilityRequired: 'assignment:manage',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: '已存在则更新，缺省为新建' },
          title: { type: 'STRING', description: '作业标题' },
          description: { type: 'STRING', description: '作业说明' },
          instructions: { type: 'STRING', description: '作答要求' },
          lessonId: { type: 'STRING', description: '关联课时 ID' },
          classId: { type: 'STRING', description: '关联班级 ID' },
          elementId: { type: 'STRING', description: '白板教学对象 ID' },
          dueAt: { type: 'NUMBER', description: '截止时间（毫秒时间戳）' },
          allowLate: { type: 'BOOLEAN', description: '是否允许迟交' },
          allowText: { type: 'BOOLEAN', description: '是否允许文本作答' },
          allowLink: { type: 'BOOLEAN', description: '是否允许链接作答' },
          maxFiles: { type: 'NUMBER', description: '最多文件数' },
          maxFileSize: { type: 'NUMBER', description: '单文件大小上限（字节）' },
          peerReviewCount: { type: 'NUMBER', description: '每人需要互评的份数' },
          teacherWeight: { type: 'NUMBER', description: '教师评分权重' },
          peerWeight: { type: 'NUMBER', description: '互评平均分权重' },
          status: { type: 'STRING', description: 'published / draft / archived' },
        },
        required: ['title'],
      },
    });

    await commandBus.registerHandler('assignment.create', {
      async execute(command) {
        const payload = command.payload as any;
        const now = Date.now();
        const teacherWeight = payload.teacherWeight === undefined ? 0.6 : Number(payload.teacherWeight);
        const peerWeight = payload.peerWeight === undefined ? 0.4 : Number(payload.peerWeight);
        if (Math.abs(teacherWeight + peerWeight - 1.0) > 0.001) {
          throw new Error('Access Denied: The sum of teacherWeight and peerWeight must equal 1.0');
        }

        const assignmentId = payload.assignmentId || 'asg-' + uuidv7();
        const existing = loadAssignment(assignmentId);

        if (existing) {
          db.prepare(
            `UPDATE plugin_assignments SET
               class_id = ?, lesson_id = ?, element_id = ?, title = ?, description = ?, instructions = ?,
               due_at = ?, allow_late = ?, allow_text = ?, allow_link = ?, max_files = ?, max_file_size = ?,
               peer_review_count = ?, teacher_weight = ?, peer_weight = ?, status = ?, updated_at = ?
             WHERE id = ?`,
          ).run(
            payload.classId ?? existing.class_id,
            payload.lessonId ?? existing.lesson_id,
            payload.elementId ?? existing.element_id,
            payload.title ?? existing.title,
            payload.description ?? null,
            payload.instructions ?? null,
            payload.dueAt ?? existing.due_at,
            payload.allowLate === undefined ? existing.allow_late : payload.allowLate ? 1 : 0,
            payload.allowText === undefined ? existing.allow_text : payload.allowText ? 1 : 0,
            payload.allowLink === undefined ? existing.allow_link : payload.allowLink ? 1 : 0,
            payload.maxFiles ?? existing.max_files,
            payload.maxFileSize ?? existing.max_file_size,
            payload.peerReviewCount ?? existing.peer_review_count,
            teacherWeight,
            peerWeight,
            payload.status ?? existing.status,
            now,
            assignmentId,
          );
        } else {
          db.prepare(
            `INSERT INTO plugin_assignments
               (id, class_id, lesson_id, element_id, title, description, instructions, due_at, allow_late, allow_text,
                allow_link, max_files, max_file_size, peer_review_count, teacher_weight, peer_weight, status,
                created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            assignmentId,
            payload.classId ?? null,
            payload.lessonId ?? null,
            payload.elementId ?? null,
            payload.title,
            payload.description ?? null,
            payload.instructions ?? null,
            payload.dueAt ?? null,
            payload.allowLate === false ? 0 : 1,
            payload.allowText === false ? 0 : 1,
            payload.allowLink ? 1 : 0,
            payload.maxFiles ?? 10,
            payload.maxFileSize ?? 20971520,
            payload.peerReviewCount ?? 2,
            teacherWeight,
            peerWeight,
            payload.status ?? 'published',
            actorUserId(command.actorId),
            now,
            now,
          );
        }

        return { success: true, assignmentId, created: !existing };
      },
    });

    await actionRegistry.register({
      id: 'eval-assignment-list',
      commandType: 'assignment.list',
      description: '按课时 / 班级 / 白板元素 / 学生列出作业',
      capabilityRequired: 'assignment:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING' },
          classId: { type: 'STRING' },
          elementId: { type: 'STRING' },
          studentId: { type: 'STRING', description: '附带该学生的提交概要' },
          includeArchived: { type: 'BOOLEAN' },
        },
      },
    });

    await commandBus.registerHandler('assignment.list', {
      async execute(command) {
        const payload = command.payload as any;
        const where: string[] = [];
        const params: unknown[] = [];
        if (payload.lessonId) {
          where.push('lesson_id = ?');
          params.push(payload.lessonId);
        }
        if (payload.classId) {
          where.push('class_id = ?');
          params.push(payload.classId);
        }
        if (payload.elementId) {
          where.push('element_id = ?');
          params.push(payload.elementId);
        }
        if (!payload.includeArchived) {
          where.push("status != 'archived'");
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = db
          .prepare(`SELECT * FROM plugin_assignments ${clause} ORDER BY created_at DESC LIMIT 200`)
          .all(...params) as AssignmentRow[];

        const studentId = payload.studentId as string | undefined;
        if (!studentId) return { success: true, assignments: rows };

        const assignments = rows.map((row) => {
          const submission = db
            .prepare('SELECT id, version, file_path, updated_at FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?')
            .get(row.id, studentId) as { id: string; version: number; file_path: string | null; updated_at: number } | undefined;
          const grade = submission
            ? (db
                .prepare('SELECT calculated_final_score, status FROM plugin_grades WHERE submission_id = ?')
                .get(submission.id) as { calculated_final_score: number; status: string } | undefined)
            : undefined;
          return { ...row, submission: submission || null, grade: grade || null };
        });
        return { success: true, assignments };
      },
    });

    await actionRegistry.register({
      id: 'eval-assignment-get',
      commandType: 'assignment.get',
      description: '读取单个作业详情（含提交版本与统计）',
      capabilityRequired: 'assignment:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING' },
          studentId: { type: 'STRING', description: '附带该学生的提交与版本历史' },
        },
        required: ['assignmentId'],
      },
    });

    await commandBus.registerHandler('assignment.get', {
      async execute(command) {
        const { assignmentId, studentId } = command.payload as any;
        const assignment = loadAssignment(assignmentId);
        if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);

        const submissions = db
          .prepare('SELECT id, student_id, version, updated_at FROM plugin_submissions WHERE assignment_id = ?')
          .all(assignmentId) as { id: string; student_id: string; version: number; updated_at: number }[];

        const grades = db
          .prepare('SELECT submission_id, calculated_final_score, status FROM plugin_grades WHERE assignment_id = ?')
          .all(assignmentId) as { submission_id: string; calculated_final_score: number; status: string }[];
        const gradedIds = new Set(grades.filter((g) => g.status === 'confirmed').map((g) => g.submission_id));

        const result: Record<string, unknown> = {
          success: true,
          assignment,
          stats: {
            submissionCount: submissions.length,
            gradedCount: gradedIds.size,
            pendingPeerReviews: (
              db.prepare("SELECT COUNT(*) AS c FROM plugin_peer_review_tasks WHERE assignment_id = ? AND status = 'pending'").get(assignmentId) as { c: number }
            ).c,
          },
        };

        if (studentId) {
          const submission = db
            .prepare('SELECT * FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?')
            .get(assignmentId, studentId) as { id: string } | undefined;
          if (submission) {
            result.submission = submission;
            result.versions = db
              .prepare('SELECT * FROM plugin_submission_versions WHERE submission_id = ? ORDER BY version DESC')
              .all(submission.id);
            result.grade = db.prepare('SELECT * FROM plugin_grades WHERE submission_id = ?').get(submission.id) || null;
          } else {
            result.submission = null;
            result.versions = [];
            result.grade = null;
          }
          // 互评任务与「我是否提交」无关：没交作业的学生也可能被分配去评别人
          result.myPeerReviewTasks = db
            .prepare('SELECT * FROM plugin_peer_review_tasks WHERE assignment_id = ? AND reviewer_id = ?')
            .all(assignmentId, studentId);
          result.peerReviewTasks = buildPeerReviewTasks(assignmentId, studentId);
        }

        // 教师视图：互评进度与异常标记（含学生姓名，仅教师请求时携带）
        if ((command.payload as any).includePeerProgress) {
          result.peerProgress = buildPeerProgress(assignmentId);
        }

        return result;
      },
    });

    // ── 1. SUBMIT COMMAND ──────────────────────────────────────────────────
    await actionRegistry.register({
      id: 'eval-assignment-submit',
      commandType: 'assignment.submit',
      description: '学生提交作业作品，支持多次提交并保留版本历史',
      capabilityRequired: 'assignment:submit',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: '作业实体 ID（推荐）' },
          lessonId: { type: 'STRING', description: '旧版课时作业入口：仅传课时 ID 时自动归属到该课时的作业' },
          studentId: { type: 'STRING', description: '提交作品的学生 ID' },
          filePath: { type: 'STRING', description: '旧版兼容：文本形式的文件路径描述' },
          fileIds: { type: 'ARRAY', items: { type: 'STRING' }, description: '已上传文件的元数据 ID 列表' },
          textContent: { type: 'STRING', description: '文本作答内容' },
          linkUrl: { type: 'STRING', description: '链接作答内容' },
        },
        required: ['studentId'],
      },
    });

    await commandBus.registerHandler('assignment.submit', {
      async execute(command) {
        const payload = command.payload as any;
        const { studentId, textContent, linkUrl, filePath } = payload;
        if (!studentId) {
          throw new Error('Missing required params: studentId');
        }
        assertStudentOwnership(command.actorId, studentId, 'submit');

        const assignment = resolveAssignment(payload.assignmentId, payload.lessonId);
        const now = Date.now();
        const isLate = assignment.due_at !== null && now > Number(assignment.due_at) ? 1 : 0;
        if (isLate && !assignment.allow_late) {
          throw new Error('Access Denied: Assignment is closed (late submission is not allowed)');
        }
        if (textContent && !assignment.allow_text) {
          throw new Error('Access Denied: Text answers are not allowed for this assignment');
        }
        if (linkUrl && !assignment.allow_link) {
          throw new Error('Access Denied: Link answers are not allowed for this assignment');
        }

        const fileIds: string[] = Array.isArray(payload.fileIds) ? payload.fileIds.filter((f: unknown) => typeof f === 'string') : [];
        if (fileIds.length > Number(assignment.max_files)) {
          throw new Error(`Access Denied: At most ${assignment.max_files} files are allowed`);
        }

        const existing = db
          .prepare('SELECT id, version FROM plugin_submissions WHERE assignment_id = ? AND student_id = ?')
          .get(assignment.id, studentId) as { id: string; version: number } | undefined;

        const submissionId = existing?.id || 'sub-' + uuidv7();
        const version = existing ? existing.version + 1 : 1;
        const versionId = 'sv-' + uuidv7();

        if (existing) {
          db.prepare(
            'UPDATE plugin_submissions SET lesson_id = ?, file_path = ?, version = ?, updated_at = ? WHERE id = ?',
          ).run(assignment.lesson_id ?? null, filePath ?? null, version, now, submissionId);
        } else {
          db.prepare(
            `INSERT INTO plugin_submissions (id, assignment_id, lesson_id, student_id, file_path, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(submissionId, assignment.id, assignment.lesson_id ?? null, studentId, filePath ?? null, version, now, now);
        }

        // 把本次引用的文件挂到该提交版本上（仅限本人、同一作业、未被占用的文件）
        if (fileIds.length > 0) {
          const placeholders = fileIds.map(() => '?').join(', ');
          db.prepare(
            `UPDATE plugin_assignment_files SET submission_id = ?, version_id = ?
             WHERE assignment_id = ? AND student_id = ? AND id IN (${placeholders})`,
          ).run(submissionId, versionId, assignment.id, studentId, ...fileIds);
        }

        const attached = db
          .prepare('SELECT id, original_name, size, mime FROM plugin_assignment_files WHERE version_id = ?')
          .all(versionId) as { id: string; original_name: string; size: number; mime: string | null }[];

        const filesJson = JSON.stringify(
          attached.length > 0
            ? attached.map((f) => ({ fileId: f.id, name: f.original_name, size: f.size, mime: f.mime }))
            : filePath
              ? [{ name: String(filePath), path: String(filePath) }]
              : [],
        );

        db.prepare(
          `INSERT INTO plugin_submission_versions
             (id, submission_id, assignment_id, student_id, version, files_json, text_content, link_url, is_late, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(versionId, submissionId, assignment.id, studentId, version, filesJson, textContent ?? null, linkUrl ?? null, isLate, now);

        await publishEvent(
          'assignment.submitted',
          {
            assignmentId: assignment.id,
            lessonId: assignment.lesson_id,
            classId: assignment.class_id,
            studentId,
            submissionId,
            version,
            isLate: isLate === 1,
          },
          command.id,
        );

        return { success: true, submissionId, version, versionId, assignmentId: assignment.id, isLate: isLate === 1 };
      },
    });

    // ── 2. PEER REVIEW COMMAND ─────────────────────────────────────────────
    await actionRegistry.register({
      id: 'eval-assignment-peer-review',
      commandType: 'assignment.peer_review',
      description: '学生对分配到的同学作业进行互评评分',
      capabilityRequired: 'assignment:review',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          submissionId: { type: 'STRING', description: '被评价的作业提交物 ID' },
          reviewerId: { type: 'STRING', description: '执行评价的学生 ID' },
          score: { type: 'INTEGER', description: '互评分数 (0-100)' },
          comment: { type: 'STRING', description: '互评意见' },
          taskId: { type: 'STRING', description: '互评任务 ID（分配式互评时提供）' },
        },
        required: ['submissionId', 'reviewerId', 'score'],
      },
    });

    await commandBus.registerHandler('assignment.peer_review', {
      async execute(command) {
        const { submissionId, reviewerId, score, comment, taskId } = command.payload as any;
        if (!submissionId || !reviewerId || score === undefined) {
          throw new Error('Missing required params: submissionId, reviewerId, score');
        }
        assertStudentOwnership(command.actorId, reviewerId, 'review');

        // T-14-01 Boundary check: score must be between 0 and 100
        const parsedScore = Math.round(Number(score));
        if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 100) {
          throw new Error('Access Denied: Score must be between 0 and 100');
        }

        const submission = db
          .prepare('SELECT id, assignment_id, student_id FROM plugin_submissions WHERE id = ?')
          .get(submissionId) as { id: string; assignment_id: string | null; student_id: string } | undefined;
        if (!submission) {
          throw new Error(`Submission not found: ${submissionId}`);
        }

        // T-14-01 Collusion check: reviewer cannot review their own submission
        if (submission.student_id === reviewerId) {
          throw new Error('Access Denied: Students are not allowed to evaluate their own assignments');
        }

        // 分配式互评：作业一旦建立了互评任务，就只允许任务持有人提交（未分配到的学生会被拒绝）；
        // 没有任何互评任务时保持旧的开放互评行为（课时级历史入口仍可用）。
        const task = db
          .prepare('SELECT id, due_at, status FROM plugin_peer_review_tasks WHERE submission_id = ? AND reviewer_id = ?')
          .get(submissionId, reviewerId) as { id: string; due_at: number | null; status: string } | undefined;
        if (!task && submission.assignment_id) {
          const taskCount = (
            db
              .prepare('SELECT COUNT(*) AS c FROM plugin_peer_review_tasks WHERE assignment_id = ?')
              .get(submission.assignment_id) as { c: number }
          ).c;
          if (taskCount > 0) {
            throw new Error('Access Denied: This submission is not assigned to you for peer review');
          }
        }
        const assignmentRow = submission.assignment_id ? loadAssignment(submission.assignment_id) : undefined;
        const resolvedTaskId = taskId || task?.id || null;
        const dueAt = task?.due_at ?? assignmentRow?.peer_review_due_at ?? null;
        if (dueAt !== null && dueAt !== undefined && Date.now() > Number(dueAt)) {
          throw new Error('Access Denied: The peer review deadline has passed');
        }

        const now = Date.now();
        const reviewId = 'rev-' + uuidv7();
        db.prepare(
          `
          INSERT INTO plugin_peer_reviews
            (id, submission_id, reviewer_id, score, comment, created_at, assignment_id, task_id, anonymous, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'submitted', ?)
          ON CONFLICT(submission_id, reviewer_id) DO UPDATE SET
            score = excluded.score,
            comment = excluded.comment,
            created_at = excluded.created_at,
            assignment_id = excluded.assignment_id,
            task_id = excluded.task_id,
            status = 'submitted',
            updated_at = excluded.updated_at
        `,
        ).run(
          reviewId,
          submissionId,
          reviewerId,
          parsedScore,
          comment || '',
          now,
          submission.assignment_id,
          resolvedTaskId,
          now,
        );

        if (task) {
          db.prepare("UPDATE plugin_peer_review_tasks SET status = 'submitted' WHERE id = ?").run(task.id);
        }

        return { success: true, reviewId };
      },
    });

    // ── 3. ASSIGN PEER REVIEWS ─────────────────────────────────────────────
    await actionRegistry.register({
      id: 'eval-assignment-assign-peer-reviews',
      commandType: 'assignment.assign_peer_reviews',
      description: '为作业的每份提交随机分配互评人（双盲，排除本人）',
      capabilityRequired: 'assignment:manage',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: '作业实体 ID' },
          reviewerCount: { type: 'NUMBER', description: '每份提交分配几名互评人（默认取作业配置）' },
          dueAt: { type: 'NUMBER', description: '互评截止时间（毫秒时间戳）' },
        },
        required: ['assignmentId'],
      },
    });

    await commandBus.registerHandler('assignment.assign_peer_reviews', {
      async execute(command) {
        const { assignmentId, dueAt } = command.payload as any;
        const assignment = loadAssignment(assignmentId);
        if (!assignment) throw new Error(`Assignment not found: ${assignmentId}`);

        const reviewerCount = Math.max(1, Math.min(10, Number((command.payload as any).reviewerCount ?? assignment.peer_review_count) || 1));
        const submissions = db
          .prepare('SELECT id, student_id FROM plugin_submissions WHERE assignment_id = ? ORDER BY created_at ASC')
          .all(assignmentId) as { id: string; student_id: string }[];

        const pools = new Map<string, number>();
        let created = 0;
        const now = Date.now();

        for (const submission of submissions) {
          const candidates = submissions.filter((s) => s.student_id !== submission.student_id);
          if (candidates.length === 0) continue;

          // 轮转分配（offset 错开），保证同一份提交的互评人不重复且负载尽量均衡，
          // 同时候选顺序按 reviewer 负载排序，避免所有互评都压在少数人身上。
          candidates.sort((a, b) => (pools.get(a.student_id) || 0) - (pools.get(b.student_id) || 0));
          const picked = candidates.slice(0, Math.min(reviewerCount, candidates.length));

          for (const candidate of picked) {
            const taskId = 'prt-' + uuidv7();
            const result = db
              .prepare(
                `INSERT INTO plugin_peer_review_tasks
                   (id, assignment_id, submission_id, reviewer_id, anonymous, status, due_at, created_at)
                 VALUES (?, ?, ?, ?, 1, 'pending', ?, ?)
                 ON CONFLICT(submission_id, reviewer_id) DO NOTHING`,
              )
              .run(taskId, assignmentId, submission.id, candidate.student_id, dueAt ?? assignment.peer_review_due_at ?? null, now);
            if ((result as { changes: number }).changes > 0) {
              created += 1;
              pools.set(candidate.student_id, (pools.get(candidate.student_id) || 0) + 1);
            }
          }
        }

        // 教师显式设定互评截止时间时，同步写回作业主记录，便于详情页/进度面板展示
        if (dueAt !== undefined && dueAt !== null) {
          db.prepare('UPDATE plugin_assignments SET peer_review_due_at = ?, updated_at = ? WHERE id = ?').run(
            Number(dueAt),
            now,
            assignmentId,
          );
        }

        return { success: true, created, submissions: submissions.length };
      },
    });

    // ── 4. TEACHER GRADE COMMAND ───────────────────────────────────────────
    await actionRegistry.register({
      id: 'eval-assignment-grade',
      commandType: 'assignment.grade',
      description: '教师对已提交的作业进行终评打分，并可动态设定折算权重与发布成绩',
      capabilityRequired: 'assignment:manage',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          submissionId: { type: 'STRING', description: '被评价的作业提交物 ID' },
          teacherScore: { type: 'INTEGER', description: '教师给出的平时分 (0-100)' },
          teacherComment: { type: 'STRING', description: '教师评语反馈' },
          teacherWeight: { type: 'NUMBER', description: '教师打分权重 (默认取作业配置)' },
          peerWeight: { type: 'NUMBER', description: '学生互评平均分权重 (默认取作业配置)' },
          status: { type: 'STRING', description: '状态，confirmed 为确认并同步，draft 为草稿' },
        },
        required: ['submissionId', 'teacherScore'],
      },
    });

    await commandBus.registerHandler('assignment.grade', {
      async execute(command) {
        const payload = command.payload as any;
        const { submissionId, teacherScore, teacherComment, status = 'draft' } = payload;
        if (!submissionId || teacherScore === undefined) {
          throw new Error('Missing required params: submissionId, teacherScore');
        }

        // T-14-03 Parameter validation
        const parsedTeacherScore = Math.round(Number(teacherScore));
        if (isNaN(parsedTeacherScore) || parsedTeacherScore < 0 || parsedTeacherScore > 100) {
          throw new Error('Access Denied: Teacher score must be between 0 and 100');
        }

        const submission = db
          .prepare('SELECT id, assignment_id, lesson_id, student_id FROM plugin_submissions WHERE id = ?')
          .get(submissionId) as
          { id: string; assignment_id: string | null; lesson_id: string | null; student_id: string } | undefined;
        if (!submission) {
          throw new Error(`Submission not found: ${submissionId}`);
        }

        const assignment = submission.assignment_id ? loadAssignment(submission.assignment_id) : undefined;
        const teacherWeight = payload.teacherWeight === undefined ? Number(assignment?.teacher_weight ?? 0.6) : Number(payload.teacherWeight);
        const peerWeight = payload.peerWeight === undefined ? Number(assignment?.peer_weight ?? 0.4) : Number(payload.peerWeight);
        const totalWeight = teacherWeight + peerWeight;
        if (Math.abs(totalWeight - 1.0) > 0.001) {
          throw new Error('Access Denied: The sum of teacherWeight and peerWeight must equal 1.0');
        }

        // Retrieve peer review average score
        const reviews = db
          .prepare('SELECT score FROM plugin_peer_reviews WHERE submission_id = ?')
          .all(submissionId) as { score: number }[];

        let peerAverageScore: number | null = null;
        let calculatedFinalScore = parsedTeacherScore;

        if (reviews.length > 0) {
          const sum = reviews.reduce((acc, r) => acc + r.score, 0);
          peerAverageScore = sum / reviews.length;
          calculatedFinalScore = Math.round(parsedTeacherScore * teacherWeight + peerAverageScore * peerWeight);
        }

        const now = Date.now();
        const gradeId = 'grd-' + uuidv7();
        db.prepare(
          `
          INSERT INTO plugin_grades (
            id, submission_id, teacher_score, teacher_comment, teacher_weight, peer_weight,
            calculated_final_score, status, graded_at, assignment_id, peer_average_score, source, published_at, graded_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'teacher', ?, ?)
          ON CONFLICT(submission_id) DO UPDATE SET
            teacher_score = excluded.teacher_score,
            teacher_comment = excluded.teacher_comment,
            teacher_weight = excluded.teacher_weight,
            peer_weight = excluded.peer_weight,
            calculated_final_score = excluded.calculated_final_score,
            status = excluded.status,
            graded_at = excluded.graded_at,
            assignment_id = excluded.assignment_id,
            peer_average_score = excluded.peer_average_score,
            published_at = excluded.published_at,
            graded_by = excluded.graded_by
        `,
        ).run(
          gradeId,
          submissionId,
          parsedTeacherScore,
          teacherComment || '',
          teacherWeight,
          peerWeight,
          calculatedFinalScore,
          status,
          now,
          submission.assignment_id,
          peerAverageScore,
          status === 'confirmed' ? now : null,
          actorUserId(command.actorId),
        );

        // T-14-02 目标同步：确认后写学期成绩 + 投影到班级作业成绩页
        if (status === 'confirmed') {
          // 有 lesson_id 时走宿主 saveSemesterGrade（负责 lesson→class 映射、代表作业与
          // assignment_submissions 写入），避免插件再写一份重复行。
          let projectedByHost = false;
          if (submission.lesson_id) {
            try {
              await gradeService.saveSemesterGrade(submission.lesson_id, submission.student_id, calculatedFinalScore);
              projectedByHost = true;
            } catch (err) {
              ctx.log?.warn?.(`[assignment-eval] 同步学期成绩失败: ${(err as Error)?.message}`);
            }
          }

          // 纯班级作业（无 lesson_id）宿主服务无法映射，由插件自行投影
          if (!projectedByHost && assignment && assignment.class_id) {
            db.prepare(
              `INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 class_id = excluded.class_id,
                 lesson_id = excluded.lesson_id,
                 title = excluded.title,
                 description = excluded.description`,
            ).run(assignment.id, assignment.class_id, assignment.lesson_id, assignment.title, '', '', now);

            db.prepare(
              `INSERT INTO assignment_submissions
                 (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'graded')
               ON CONFLICT(assignment_id, student_id) DO UPDATE SET
                 score = excluded.score,
                 feedback = excluded.feedback,
                 graded_at = excluded.graded_at,
                 status = 'graded'`,
            ).run(
              assignment.id,
              submission.student_id,
              '',
              calculatedFinalScore,
              teacherComment || '',
              now,
              now,
            );
          }

          await publishEvent(
            'assignment.graded',
            {
              assignmentId: submission.assignment_id,
              lessonId: submission.lesson_id,
              studentId: submission.student_id,
              submissionId,
              score: calculatedFinalScore,
              teacherScore: parsedTeacherScore,
              peerAverageScore,
              feedback: teacherComment || '',
            },
            command.id,
          );
        }

        return {
          success: true,
          calculatedFinalScore,
          peerAverageScore,
          teacherWeight,
          peerWeight,
          status,
        };
      },
    });
  },

  deactivate: async () => {
    // Teardown handled by registry unregister automatically
  },
};
