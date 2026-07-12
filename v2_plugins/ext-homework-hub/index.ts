import type { PluginContext } from '@openlearn/plugin-sdk';
const IDatabaseToken = { name: '@openlearn/core:IDatabase', version: '1.0.0' } as any;

export default {
  manifest: {
    id: "ext-homework-hub",
    name: "作业中心",
    version: "1.0.0"
  },

  activate: async (ctx: PluginContext) => {
    // ============================================================
    // 1. 数据库表结构初始化
    // ============================================================

    // 作业表：存储教师发布的作业信息
    await ctx.db.ensureTable(
      'assignments',
      'id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT "", ' +
      'deadline TEXT DEFAULT "", created_at TEXT NOT NULL, teacher_id TEXT NOT NULL'
    );

    // 提交记录表：存储学生的作业提交和评分
    await ctx.db.ensureTable(
      'submissions',
      'id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id TEXT NOT NULL, ' +
      'filename TEXT NOT NULL, file_path TEXT NOT NULL, submitted_at TEXT NOT NULL, ' +
      'score REAL DEFAULT -1, feedback TEXT DEFAULT ""'
    );

    ctx.log?.info('数据库表结构初始化完成', {
      tables: ['assignments', 'submissions']
    }) ?? console.log('[HomeworkHub] 数据库表结构初始化完成');

    // ============================================================
    // 2. Command Handler 注册
    // ============================================================
    const commandBus = ctx.services.commandBus;

    // ----------------------------------------------------------
    // 2.1 创建作业（教师）
    // ----------------------------------------------------------
    await commandBus.registerHandler('create_assignment', {
      execute: async (command) => {
        const { title, description, deadline } = command.payload;
        const teacherId = command.actorId;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('assignments');

        const id = `asgn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = new Date().toISOString();

        db.prepare(
          `INSERT INTO ${tbl} (id, title, description, deadline, created_at, teacher_id) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, title, description || '', deadline || '', createdAt, teacherId);

        ctx.log?.info('作业创建成功', { assignmentId: id, title, teacherId })
          ?? console.log(`[HomeworkHub] 作业创建成功: ${id}`);

        // 发布事件通知学生有新作业
        await ctx.services.eventBus.publish({
          type: 'homework:new_assignment',
          payload: { assignmentId: id, title, deadline, teacherId, createdAt }
        });

        return { success: true, assignmentId: id, createdAt };
      }
    });

    // ----------------------------------------------------------
    // 2.2 列出作业列表（教师看全部，学生看分配给自己的）
    // ----------------------------------------------------------
    await commandBus.registerHandler('list_assignments', {
      execute: async (command) => {
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('assignments');
        const subTbl = ctx.db.table('submissions');
        const actorId = command.actorId;

        const rows = db.prepare(
          `SELECT * FROM ${tbl} ORDER BY created_at DESC`
        ).all() as Array<Record<string, unknown>>;

        // 同时查询当前用户的提交状态
        const assignments = rows.map((row) => {
          const submission = db.prepare(
            `SELECT id, submitted_at, score, feedback FROM ${subTbl} WHERE assignment_id = ? AND student_id = ?`
          ).get(row.id, actorId) as Record<string, unknown> | undefined;

          return {
            id: row.id,
            title: row.title,
            description: row.description,
            deadline: row.deadline,
            createdAt: row.created_at,
            teacherId: row.teacher_id,
            submission: submission ? {
              id: submission.id,
              submittedAt: submission.submitted_at,
              score: submission.score,
              feedback: submission.feedback
            } : null
          };
        });

        return { assignments };
      }
    });

    // ----------------------------------------------------------
    // 2.3 学生提交作业文件
    // ----------------------------------------------------------
    await commandBus.registerHandler('submit', {
      execute: async (command) => {
        const { assignmentId, filename, fileContentBase64 } = command.payload;
        const studentId = command.actorId;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('submissions');

        // 将文件写入 VFS
        const destPath = `/homework/${assignmentId}/${studentId}/${filename}`;
        const buffer = Buffer.from(fileContentBase64, 'base64');

        await ctx.services.commandBus.execute({
          id: `vfs_${Date.now()}`,
          type: 'vfs.write_file',
          payload: {
            path: destPath,
            content: buffer
          }
        } as any);

        // 写入提交记录（支持覆盖重新提交）
        const submissionId = `${assignmentId}_${studentId}`;
        const submittedAt = new Date().toISOString();

        db.prepare(
          `INSERT OR REPLACE INTO ${tbl} (id, assignment_id, student_id, filename, file_path, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(submissionId, assignmentId, studentId, filename, destPath, submittedAt);

        ctx.log?.info('作业提交成功', { submissionId, assignmentId, studentId, filename })
          ?? console.log(`[HomeworkHub] 作业提交成功: ${submissionId}`);

        return { success: true, submissionId, submittedAt, filePath: destPath };
      }
    });

    // ----------------------------------------------------------
    // 2.4 查看某作业的所有提交（教师）
    // ----------------------------------------------------------
    await commandBus.registerHandler('list_submissions', {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('submissions');

        const rows = db.prepare(
          `SELECT * FROM ${tbl} WHERE assignment_id = ? ORDER BY submitted_at DESC`
        ).all(assignmentId) as Array<Record<string, unknown>>;

        return {
          assignmentId,
          submissions: rows.map((row) => ({
            id: row.id,
            studentId: row.student_id,
            filename: row.filename,
            filePath: row.file_path,
            submittedAt: row.submitted_at,
            score: row.score,
            feedback: row.feedback
          })),
          total: rows.length
        };
      }
    });

    // ----------------------------------------------------------
    // 2.5 获取单个提交记录的下载信息
    // ----------------------------------------------------------
    await commandBus.registerHandler('get_download_url', {
      execute: async (command) => {
        const { submissionId } = command.payload;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('submissions');

        const submission = db.prepare(
          `SELECT * FROM ${tbl} WHERE id = ?`
        ).get(submissionId) as Record<string, unknown> | undefined;

        if (!submission) {
          throw new Error(`未找到提交记录: ${submissionId}`);
        }

        return {
          submissionId,
          filename: submission.filename,
          filePath: submission.file_path,
          // 前端可据此路径通过 VFS 下载接口获取文件
          downloadUrl: `/files${submission.file_path}`
        };
      }
    });

    // ----------------------------------------------------------
    // 2.6 批量获取某作业的所有下载链接
    // ----------------------------------------------------------
    await commandBus.registerHandler('batch_download_urls', {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('submissions');

        const rows = db.prepare(
          `SELECT id, student_id, filename, file_path FROM ${tbl} WHERE assignment_id = ?`
        ).all(assignmentId) as Array<Record<string, unknown>>;

        return {
          assignmentId,
          files: rows.map((row) => ({
            submissionId: row.id,
            studentId: row.student_id,
            filename: row.filename,
            downloadUrl: `/files${row.file_path}`
          }))
        };
      }
    });

    // ----------------------------------------------------------
    // 2.7 评分与反馈（教师）
    // ----------------------------------------------------------
    await commandBus.registerHandler('grade', {
      execute: async (command) => {
        const { submissionId, score, feedback } = command.payload;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const tbl = ctx.db.table('submissions');

        const result = db.prepare(
          `UPDATE ${tbl} SET score = ?, feedback = ? WHERE id = ?`
        ).run(score, feedback || '', submissionId);

        if (result.changes === 0) {
          throw new Error(`未找到提交记录: ${submissionId}`);
        }

        ctx.log?.info('评分完成', { submissionId, score })
          ?? console.log(`[HomeworkHub] 评分完成: ${submissionId}, 得分: ${score}`);

        return { success: true, submissionId, score, feedback };
      }
    });

    // ----------------------------------------------------------
    // 2.8 导出成绩单为 Excel
    // ----------------------------------------------------------
    await commandBus.registerHandler('export_scores', {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const xlsx = ctx.require('xlsx');
        const db = await ctx.resolve<any>(IDatabaseToken);
        const asgnTbl = ctx.db.table('assignments');
        const subTbl = ctx.db.table('submissions');

        // 获取作业信息
        const assignment = db.prepare(
          `SELECT title FROM ${asgnTbl} WHERE id = ?`
        ).get(assignmentId) as Record<string, unknown> | undefined;

        if (!assignment) {
          throw new Error(`未找到作业: ${assignmentId}`);
        }

        // 获取所有提交记录
        const rows = db.prepare(
          `SELECT student_id, filename, submitted_at, score, feedback FROM ${subTbl} WHERE assignment_id = ? ORDER BY student_id`
        ).all(assignmentId) as Array<Record<string, unknown>>;

        // 构建 Excel 数据
        const sheetData = rows.map((row) => ({
          '学号': row.student_id,
          '文件名': row.filename,
          '提交时间': row.submitted_at,
          '得分': row.score !== -1 ? row.score : '未评分',
          '教师反馈': row.feedback || ''
        }));

        const worksheet = xlsx.utils.json_to_sheet(sheetData);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, '成绩单');

        const buf = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const downloadFileName = `成绩单_${assignment.title}_${Date.now()}.xlsx`;
        const downloadPath = `/downloads/${downloadFileName}`;

        await commandBus.execute({
          id: `vfs_export_${Date.now()}`,
          type: 'vfs.write_file',
          payload: {
            path: downloadPath,
            content: buf
          }
        } as any);

        ctx.log?.info('成绩单导出完成', { assignmentId, fileName: downloadFileName })
          ?? console.log(`[HomeworkHub] 成绩单导出完成: ${downloadFileName}`);

        return {
          success: true,
          downloadUrl: `/files${downloadPath}`,
          fileName: downloadFileName,
          totalStudents: rows.length
        };
      }
    });

    // ----------------------------------------------------------
    // 2.9 获取统计概览（教师端仪表盘用）
    // ----------------------------------------------------------
    await commandBus.registerHandler('get_stats', {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve<any>(IDatabaseToken);
        const subTbl = ctx.db.table('submissions');

        const submissions = db.prepare(
          `SELECT COUNT(*) as total FROM ${subTbl} WHERE assignment_id = ?`
        ).get(assignmentId) as { total: number };

        const graded = db.prepare(
          `SELECT COUNT(*) as total FROM ${subTbl} WHERE assignment_id = ? AND score >= 0`
        ).get(assignmentId) as { total: number };

        const avgScore = db.prepare(
          `SELECT AVG(score) as avg FROM ${subTbl} WHERE assignment_id = ? AND score >= 0`
        ).get(assignmentId) as { avg: number | null };

        return {
          assignmentId,
          totalSubmissions: submissions.total,
          gradedCount: graded.total,
          ungradedCount: submissions.total - graded.total,
          averageScore: avgScore.avg ? Math.round(avgScore.avg * 100) / 100 : null
        };
      }
    });

    ctx.log?.info('插件激活完成，所有 Command Handler 已注册')
      ?? console.log('[HomeworkHub] 插件激活完成，所有 Command Handler 已注册');
  },

  deactivate: async () => {
    console.log('[HomeworkHub] 插件正在停用，资源将由 ResourceTracker 自动回收');
  }
};
