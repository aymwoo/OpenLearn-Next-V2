// v2_plugins/ext-homework-hub/index.ts
var IDatabaseToken = { name: "@openlearn/core:IDatabase", version: "1.0.0" };
var index_default = {
  manifest: {
    id: "ext-homework-hub",
    name: "\u4F5C\u4E1A\u4E2D\u5FC3",
    version: "1.0.0"
  },
  activate: async (ctx) => {
    await ctx.db.ensureTable(
      "assignments",
      'id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT "", deadline TEXT DEFAULT "", created_at TEXT NOT NULL, teacher_id TEXT NOT NULL'
    );
    await ctx.db.ensureTable(
      "submissions",
      'id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL, student_id TEXT NOT NULL, filename TEXT NOT NULL, file_path TEXT NOT NULL, submitted_at TEXT NOT NULL, score REAL DEFAULT -1, feedback TEXT DEFAULT ""'
    );
    ctx.log?.info("\u6570\u636E\u5E93\u8868\u7ED3\u6784\u521D\u59CB\u5316\u5B8C\u6210", {
      tables: ["assignments", "submissions"]
    }) ?? console.log("[HomeworkHub] \u6570\u636E\u5E93\u8868\u7ED3\u6784\u521D\u59CB\u5316\u5B8C\u6210");
    const commandBus = ctx.services.commandBus;
    await commandBus.registerHandler("create_assignment", {
      execute: async (command) => {
        const { title, description, deadline } = command.payload;
        const teacherId = command.actorId;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("assignments");
        const id = `asgn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare(
          `INSERT INTO ${tbl} (id, title, description, deadline, created_at, teacher_id) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, title, description || "", deadline || "", createdAt, teacherId);
        ctx.log?.info("\u4F5C\u4E1A\u521B\u5EFA\u6210\u529F", { assignmentId: id, title, teacherId }) ?? console.log(`[HomeworkHub] \u4F5C\u4E1A\u521B\u5EFA\u6210\u529F: ${id}`);
        await ctx.services.eventBus.publish({
          type: "homework:new_assignment",
          payload: { assignmentId: id, title, deadline, teacherId, createdAt }
        });
        return { success: true, assignmentId: id, createdAt };
      }
    });
    await commandBus.registerHandler("list_assignments", {
      execute: async (command) => {
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("assignments");
        const subTbl = ctx.db.table("submissions");
        const actorId = command.actorId;
        const rows = db.prepare(
          `SELECT * FROM ${tbl} ORDER BY created_at DESC`
        ).all();
        const assignments = rows.map((row) => {
          const submission = db.prepare(
            `SELECT id, submitted_at, score, feedback FROM ${subTbl} WHERE assignment_id = ? AND student_id = ?`
          ).get(row.id, actorId);
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
    await commandBus.registerHandler("submit", {
      execute: async (command) => {
        const { assignmentId, filename, fileContentBase64 } = command.payload;
        const studentId = command.actorId;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("submissions");
        const destPath = `/homework/${assignmentId}/${studentId}/${filename}`;
        const buffer = Buffer.from(fileContentBase64, "base64");
        await ctx.services.commandBus.execute({
          id: `vfs_${Date.now()}`,
          type: "vfs.write_file",
          payload: {
            path: destPath,
            content: buffer
          }
        });
        const submissionId = `${assignmentId}_${studentId}`;
        const submittedAt = (/* @__PURE__ */ new Date()).toISOString();
        db.prepare(
          `INSERT OR REPLACE INTO ${tbl} (id, assignment_id, student_id, filename, file_path, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(submissionId, assignmentId, studentId, filename, destPath, submittedAt);
        ctx.log?.info("\u4F5C\u4E1A\u63D0\u4EA4\u6210\u529F", { submissionId, assignmentId, studentId, filename }) ?? console.log(`[HomeworkHub] \u4F5C\u4E1A\u63D0\u4EA4\u6210\u529F: ${submissionId}`);
        return { success: true, submissionId, submittedAt, filePath: destPath };
      }
    });
    await commandBus.registerHandler("list_submissions", {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("submissions");
        const rows = db.prepare(
          `SELECT * FROM ${tbl} WHERE assignment_id = ? ORDER BY submitted_at DESC`
        ).all(assignmentId);
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
    await commandBus.registerHandler("get_download_url", {
      execute: async (command) => {
        const { submissionId } = command.payload;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("submissions");
        const submission = db.prepare(
          `SELECT * FROM ${tbl} WHERE id = ?`
        ).get(submissionId);
        if (!submission) {
          throw new Error(`\u672A\u627E\u5230\u63D0\u4EA4\u8BB0\u5F55: ${submissionId}`);
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
    await commandBus.registerHandler("batch_download_urls", {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("submissions");
        const rows = db.prepare(
          `SELECT id, student_id, filename, file_path FROM ${tbl} WHERE assignment_id = ?`
        ).all(assignmentId);
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
    await commandBus.registerHandler("grade", {
      execute: async (command) => {
        const { submissionId, score, feedback } = command.payload;
        const db = await ctx.resolve(IDatabaseToken);
        const tbl = ctx.db.table("submissions");
        const result = db.prepare(
          `UPDATE ${tbl} SET score = ?, feedback = ? WHERE id = ?`
        ).run(score, feedback || "", submissionId);
        if (result.changes === 0) {
          throw new Error(`\u672A\u627E\u5230\u63D0\u4EA4\u8BB0\u5F55: ${submissionId}`);
        }
        ctx.log?.info("\u8BC4\u5206\u5B8C\u6210", { submissionId, score }) ?? console.log(`[HomeworkHub] \u8BC4\u5206\u5B8C\u6210: ${submissionId}, \u5F97\u5206: ${score}`);
        return { success: true, submissionId, score, feedback };
      }
    });
    await commandBus.registerHandler("export_scores", {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const xlsx = ctx.require("xlsx");
        const db = await ctx.resolve(IDatabaseToken);
        const asgnTbl = ctx.db.table("assignments");
        const subTbl = ctx.db.table("submissions");
        const assignment = db.prepare(
          `SELECT title FROM ${asgnTbl} WHERE id = ?`
        ).get(assignmentId);
        if (!assignment) {
          throw new Error(`\u672A\u627E\u5230\u4F5C\u4E1A: ${assignmentId}`);
        }
        const rows = db.prepare(
          `SELECT student_id, filename, submitted_at, score, feedback FROM ${subTbl} WHERE assignment_id = ? ORDER BY student_id`
        ).all(assignmentId);
        const sheetData = rows.map((row) => ({
          "\u5B66\u53F7": row.student_id,
          "\u6587\u4EF6\u540D": row.filename,
          "\u63D0\u4EA4\u65F6\u95F4": row.submitted_at,
          "\u5F97\u5206": row.score !== -1 ? row.score : "\u672A\u8BC4\u5206",
          "\u6559\u5E08\u53CD\u9988": row.feedback || ""
        }));
        const worksheet = xlsx.utils.json_to_sheet(sheetData);
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "\u6210\u7EE9\u5355");
        const buf = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
        const downloadFileName = `\u6210\u7EE9\u5355_${assignment.title}_${Date.now()}.xlsx`;
        const downloadPath = `/downloads/${downloadFileName}`;
        await commandBus.execute({
          id: `vfs_export_${Date.now()}`,
          type: "vfs.write_file",
          payload: {
            path: downloadPath,
            content: buf
          }
        });
        ctx.log?.info("\u6210\u7EE9\u5355\u5BFC\u51FA\u5B8C\u6210", { assignmentId, fileName: downloadFileName }) ?? console.log(`[HomeworkHub] \u6210\u7EE9\u5355\u5BFC\u51FA\u5B8C\u6210: ${downloadFileName}`);
        return {
          success: true,
          downloadUrl: `/files${downloadPath}`,
          fileName: downloadFileName,
          totalStudents: rows.length
        };
      }
    });
    await commandBus.registerHandler("get_stats", {
      execute: async (command) => {
        const { assignmentId } = command.payload;
        const db = await ctx.resolve(IDatabaseToken);
        const subTbl = ctx.db.table("submissions");
        const submissions = db.prepare(
          `SELECT COUNT(*) as total FROM ${subTbl} WHERE assignment_id = ?`
        ).get(assignmentId);
        const graded = db.prepare(
          `SELECT COUNT(*) as total FROM ${subTbl} WHERE assignment_id = ? AND score >= 0`
        ).get(assignmentId);
        const avgScore = db.prepare(
          `SELECT AVG(score) as avg FROM ${subTbl} WHERE assignment_id = ? AND score >= 0`
        ).get(assignmentId);
        return {
          assignmentId,
          totalSubmissions: submissions.total,
          gradedCount: graded.total,
          ungradedCount: submissions.total - graded.total,
          averageScore: avgScore.avg ? Math.round(avgScore.avg * 100) / 100 : null
        };
      }
    });
    ctx.log?.info("\u63D2\u4EF6\u6FC0\u6D3B\u5B8C\u6210\uFF0C\u6240\u6709 Command Handler \u5DF2\u6CE8\u518C") ?? console.log("[HomeworkHub] \u63D2\u4EF6\u6FC0\u6D3B\u5B8C\u6210\uFF0C\u6240\u6709 Command Handler \u5DF2\u6CE8\u518C");
  },
  deactivate: async () => {
    console.log("[HomeworkHub] \u63D2\u4EF6\u6B63\u5728\u505C\u7528\uFF0C\u8D44\u6E90\u5C06\u7531 ResourceTracker \u81EA\u52A8\u56DE\u6536");
  }
};
export {
  index_default as default
};
