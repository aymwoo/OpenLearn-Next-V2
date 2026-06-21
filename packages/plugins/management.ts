import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export const ManagementPlugin = {
  manifest: {
    id: '@openlearn/plugin-management',
    name: '教务管理插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['class:read', 'class:write', 'student:read', 'student:write'],
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // Helper functions for student number auto-generation (S001 style)
    const generateStudentNumber = (db: any): string => {
      const rows = db.prepare("SELECT student_number FROM students WHERE student_number LIKE 'S%'").all() as { student_number: string }[];
      let maxSeq = 0;
      for (const row of rows) {
        const numStr = row.student_number || '';
        if (numStr.startsWith('S')) {
          const seqStr = numStr.substring(1);
          const seq = parseInt(seqStr, 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
      }
      const nextSeq = maxSeq + 1;
      return `S${nextSeq.toString().padStart(3, '0')}`;
    };

    // 1. CLASS CREATE
    const classCreateCmd = 'class.create';
    await actionRegistry.register({
      id: 'core-class-create',
      commandType: classCreateCmd,
      description: '在在线学习系统中创建新班级',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '班级名称' },
          description: { type: 'STRING', description: '班级描述' }
        },
        required: ['name']
      }
    });

    await commandBus.registerHandler(classCreateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const classId = uuidv7();
        db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
          classId, payload.name, payload.description || '', Date.now()
        );
        return { classId };
      }
    });

    // 2. CLASS LIST
    const classListCmd = 'class.list';
    await actionRegistry.register({
      id: 'core-class-list',
      commandType: classListCmd,
      description: '列出所有班级',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(classListCmd, {
      async execute() {
        const classes = db.prepare('SELECT * FROM classes ORDER BY created_at DESC').all();
        return { classes };
      }
    });

    // 3. STUDENT CREATE
    const studentCreateCmd = 'student.create';
    await actionRegistry.register({
      id: 'core-student-create',
      commandType: studentCreateCmd,
      description: '创建新学生',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '学生姓名' },
          email: { type: 'STRING', description: '学生邮箱' },
          student_number: { type: 'STRING', description: '学生学号（可选，用作登录用户名）' }
        },
        required: ['name']
      }
    });

    await commandBus.registerHandler(studentCreateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const studentId = uuidv7();
        let studentNumber = payload.student_number || '';
        if (!studentNumber) {
          studentNumber = generateStudentNumber(db);
        }
        db.prepare('INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)').run(
          studentId, studentNumber, payload.name, payload.email || '', Date.now()
        );
        return { studentId };
      }
    });

    // 4. STUDENT LIST
    const studentListCmd = 'student.list';
    await actionRegistry.register({
      id: 'core-student-list',
      commandType: studentListCmd,
      description: '列出所有学生',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(studentListCmd, {
      async execute() {
        const students = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all();
        return { students };
      }
    });

    // 5. CLASS ADD STUDENT
    const classAddStudentCmd = 'class.add_student';
    await actionRegistry.register({
      id: 'core-class-add-student',
      commandType: classAddStudentCmd,
      description: '将学生添加到班级',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          studentId: { type: 'STRING', description: '学生 ID' }
        },
        required: ['classId', 'studentId']
      }
    });

    await commandBus.registerHandler(classAddStudentCmd, {
      async execute(command) {
        const payload = command.payload as any;
        try {
          db.prepare('INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)').run(
            payload.classId, payload.studentId, Date.now()
          );
        } catch (e: any) {
          if (!e.message.includes('UNIQUE constraint failed')) {
             throw e;
          }
        }
        return { success: true };
      }
    });

    // 6. CLASS UPDATE
    const classUpdateCmd = 'class.update';
    await actionRegistry.register({
      id: 'core-class-update',
      commandType: classUpdateCmd,
      description: '更新班级信息',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: 'ID of the class' },
          name: { type: 'STRING', description: '班级名称' },
          description: { type: 'STRING', description: '班级描述' }
        },
        required: ['classId']
      }
    });

    await commandBus.registerHandler(classUpdateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        if (payload.name) {
          db.prepare('UPDATE classes SET name = ? WHERE id = ?').run(payload.name, payload.classId);
        }
        if (payload.description !== undefined) {
          db.prepare('UPDATE classes SET description = ? WHERE id = ?').run(payload.description, payload.classId);
        }
        return { success: true };
      }
    });

    // 7. CLASS DELETE
    const classDeleteCmd = 'class.delete';
    await actionRegistry.register({
      id: 'core-class-delete',
      commandType: classDeleteCmd,
      description: '删除班级',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: 'ID of the class' }
        },
        required: ['classId']
      }
    });

    await commandBus.registerHandler(classDeleteCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const classId = payload.classId;

        const deleteTransaction = db.transaction(() => {
          // 1. Get all students in the class
          const students = db.prepare('SELECT student_id FROM class_students WHERE class_id = ?').all(classId) as { student_id: string }[];

          // 2. Delete students and all their data
          const deleteStudentStmt = db.prepare('DELETE FROM students WHERE id = ?');
          const deleteClassStudentByStudentStmt = db.prepare('DELETE FROM class_students WHERE student_id = ?');
          const deleteProgressStmt = db.prepare('DELETE FROM student_lesson_progress WHERE student_id = ?');
          const deleteSubmissionsByStudentStmt = db.prepare('DELETE FROM assignment_submissions WHERE student_id = ?');
          const deleteAttendanceByStudentStmt = db.prepare('DELETE FROM attendance WHERE student_id = ?');
          const deleteSeatsByStudentStmt = db.prepare('DELETE FROM student_seats WHERE student_id = ?');
          const deleteReadNotificationsStmt = db.prepare('DELETE FROM student_read_notifications WHERE student_id = ?');
          const deleteRollcallsByStudentStmt = db.prepare('DELETE FROM student_rollcalls WHERE student_id = ?');

          for (const s of students) {
            deleteStudentStmt.run(s.student_id);
            deleteClassStudentByStudentStmt.run(s.student_id);
            deleteProgressStmt.run(s.student_id);
            deleteSubmissionsByStudentStmt.run(s.student_id);
            deleteAttendanceByStudentStmt.run(s.student_id);
            deleteSeatsByStudentStmt.run(s.student_id);
            deleteReadNotificationsStmt.run(s.student_id);
            try {
              deleteRollcallsByStudentStmt.run(s.student_id);
            } catch (e) {}
          }

          // 3. Delete class-related data
          db.prepare('DELETE FROM assignment_submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)').run(classId);
          db.prepare('DELETE FROM assignments WHERE class_id = ?').run(classId);
          db.prepare('DELETE FROM attendance WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)').run(classId);
          db.prepare('DELETE FROM schedules WHERE class_id = ?').run(classId);
          db.prepare('DELETE FROM student_seats WHERE class_id = ?').run(classId);
          try {
            db.prepare('DELETE FROM student_rollcalls WHERE class_id = ?').run(classId);
          } catch (e) {}
          db.prepare('DELETE FROM class_students WHERE class_id = ?').run(classId);
          db.prepare('DELETE FROM classes WHERE id = ?').run(classId);
        });

        deleteTransaction();
        return { success: true };
      }
    });

    // 7b. CLASS GET STUDENTS
    const classGetStudentsCmd = 'class.get_students';
    await actionRegistry.register({
      id: 'core-class-get-students',
      commandType: classGetStudentsCmd,
      description: '获取指定班级中所有已注册的学生',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: 'ID of the class' }
        },
        required: ['classId']
      }
    });

    await commandBus.registerHandler(classGetStudentsCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const students = db.prepare(`
          SELECT s.* 
          FROM students s
          JOIN class_students cs ON s.id = cs.student_id
          WHERE cs.class_id = ?
          ORDER BY s.name ASC
        `).all(payload.classId);
        return { success: true, students };
      }
    });

    // 8. STUDENT UPDATE
    const studentUpdateCmd = 'student.update';
    await actionRegistry.register({
      id: 'core-student-update',
      commandType: studentUpdateCmd,
      description: '更新学生信息',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING', description: 'ID of the student' },
          name: { type: 'STRING', description: '学生姓名' },
          email: { type: 'STRING', description: '学生邮箱' },
          student_number: { type: 'STRING', description: '学生学号' }
        },
        required: ['studentId']
      }
    });

    await commandBus.registerHandler(studentUpdateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        if (payload.name) {
          db.prepare('UPDATE students SET name = ? WHERE id = ?').run(payload.name, payload.studentId);
        }
        if (payload.email !== undefined) {
          db.prepare('UPDATE students SET email = ? WHERE id = ?').run(payload.email, payload.studentId);
        }
        if (payload.student_number !== undefined) {
          db.prepare('UPDATE students SET student_number = ? WHERE id = ?').run(payload.student_number, payload.studentId);
        }
        return { success: true };
      }
    });

    // 9. STUDENT DELETE
    const studentDeleteCmd = 'student.delete';
    await actionRegistry.register({
      id: 'core-student-delete',
      commandType: studentDeleteCmd,
      description: '删除学生',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING', description: 'ID of the student' }
        },
        required: ['studentId']
      }
    });

    await commandBus.registerHandler(studentDeleteCmd, {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare('DELETE FROM class_students WHERE student_id = ?').run(payload.studentId);
        db.prepare('DELETE FROM students WHERE id = ?').run(payload.studentId);
        return { success: true };
      }
    });

    // 10. CLASS REMOVE STUDENT
    const classRemoveStudentCmd = 'class.remove_student';
    await actionRegistry.register({
      id: 'core-class-remove-student',
      commandType: classRemoveStudentCmd,
      description: '将学生从班级中移除',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          studentId: { type: 'STRING', description: '学生 ID' }
        },
        required: ['classId', 'studentId']
      }
    });

    await commandBus.registerHandler(classRemoveStudentCmd, {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(payload.classId, payload.studentId);
        return { success: true };
      }
    });

    // 11. CLASS IMPORT TEMPLATE DOWNLOAD/SAVE
    const classTemplateDownloadCmd = 'class.template_download';
    await actionRegistry.register({
      id: 'core-class-template-download',
      commandType: classTemplateDownloadCmd,
      description: '生成并保存班级与学生名册 CSV 导入模板到虚拟文件系统根目录 "/class_import_template.csv"',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(classTemplateDownloadCmd, {
      async execute() {
        const headers = 'Class Name,Class Desc,Student Name,Student Email';
        const sampleRow = 'Class 101,Introduction to English,John Doe,john@example.com\nClass 101,Introduction to English,Jane Smith,jane@example.com';
        const content = `${headers}\n${sampleRow}`;
        
        const fileId = uuidv7();
        db.prepare('DELETE FROM vfs_nodes WHERE parent_id IS NULL AND name = ? AND type = ?').run('class_import_template.csv', 'file');
        db.prepare('INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(fileId, null, 'file', 'class_import_template.csv', content, Date.now(), Date.now());

        return { 
          filename: 'class_import_template.csv', 
          path: '/class_import_template.csv',
          content,
          info: 'CSV template file successfully generated at Virtual File System root!' 
        };
      }
    });

    // 12. STUDENT IMPORT TEMPLATE DOWNLOAD/SAVE
    const studentTemplateDownloadCmd = 'student.template_download';
    await actionRegistry.register({
      id: 'core-student-template-download',
      commandType: studentTemplateDownloadCmd,
      description: '生成并保存学生 CSV 导入模板到虚拟文件系统根目录 "/student_import_template.csv"',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(studentTemplateDownloadCmd, {
      async execute() {
        const headers = 'Student Name,Student Email';
        const sampleRow = 'Alice Cooper,alice@example.com\nBob Dylan,bob@example.com';
        const content = `${headers}\n${sampleRow}`;
        
        const fileId = uuidv7();
        db.prepare('DELETE FROM vfs_nodes WHERE parent_id IS NULL AND name = ? AND type = ?').run('student_import_template.csv', 'file');
        db.prepare('INSERT INTO vfs_nodes (id, parent_id, type, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(fileId, null, 'file', 'student_import_template.csv', content, Date.now(), Date.now());

        return { 
          filename: 'student_import_template.csv', 
          path: '/student_import_template.csv',
          content,
          info: 'CSV template file successfully generated at Virtual File System root!' 
        };
      }
    });

    // 13. STUDENT ADD NOTE
    const studentAddNoteCmd = 'student.add_note';
    await actionRegistry.register({
      id: 'core-student-add-note',
      commandType: studentAddNoteCmd,
      description: '为学生添加或更新私密观察笔记（学业/行为/特殊关怀/综合）',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING', description: 'ID of the student' },
          category: { type: 'STRING', description: '分类：Academic（学业）、Behavioral（行为）、SpecialCare（特殊关怀）或 General（综合）' },
          notesHtml: { type: 'STRING', description: '笔记正文，支持 HTML 或富文本' }
        },
        required: ['studentId', 'category', 'notesHtml']
      }
    });

    await commandBus.registerHandler(studentAddNoteCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const serialized = JSON.stringify({ category: payload.category || 'General', html: payload.notesHtml });
        db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(serialized, payload.studentId);
        return { success: true, studentId: payload.studentId, category: payload.category, private_notes: serialized };
      }
    });

    // 14. ASSIGNMENT CREATE
    const assignmentCreateCmd = 'assignment.create';
    await actionRegistry.register({
      id: 'core-assignment-create',
      commandType: assignmentCreateCmd,
      description: '为指定班级创建课后作业',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '目标班级 ID' },
          title: { type: 'STRING', description: '作业标题' },
          description: { type: 'STRING', description: '作业的简短摘要或概述' },
          content: { type: 'STRING', description: '详细的作业说明或要求' }
        },
        required: ['classId', 'title']
      }
    });

    await commandBus.registerHandler(assignmentCreateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const assignmentId = uuidv7();
        db.prepare('INSERT INTO assignments (id, class_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(assignmentId, payload.classId, payload.title, payload.description || '', payload.content || '', Date.now());
        return { assignmentId, classId: payload.classId, title: payload.title };
      }
    });

    // 15. ASSIGNMENT SUBMIT
    const assignmentSubmitCmd = 'assignment.submit';
    await actionRegistry.register({
      id: 'core-assignment-submit',
      commandType: assignmentSubmitCmd,
      description: '代表学生提交作业内容（文本、Markdown 或代码）',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: '作业 ID' },
          studentId: { type: 'STRING', description: '学生 ID' },
          content: { type: 'STRING', description: '提交内容（文本、Markdown 或代码）' }
        },
        required: ['assignmentId', 'studentId', 'content']
      }
    });

    await commandBus.registerHandler(assignmentSubmitCmd, {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare(`
          INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, status)
          VALUES (?, ?, ?, NULL, NULL, ?, 'submitted')
          ON CONFLICT(assignment_id, student_id) DO UPDATE SET
            content = excluded.content,
            submitted_at = excluded.submitted_at,
            status = 'submitted'
        `).run(payload.assignmentId, payload.studentId, payload.content, Date.now());
        return { success: true, assignmentId: payload.assignmentId, studentId: payload.studentId };
      }
    });

    // 16. ASSIGNMENT GRADE
    const assignmentGradeCmd = 'assignment.grade';
    await actionRegistry.register({
      id: 'core-assignment-grade',
      commandType: assignmentGradeCmd,
      description: '为学生作业打分并给出反馈意见',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          assignmentId: { type: 'STRING', description: 'ID of the assignment' },
          studentId: { type: 'STRING', description: 'ID of the student' },
          score: { type: 'INTEGER', description: '满分 100 的得分' },
          feedback: { type: 'STRING', description: '有建设性的反馈评语' }
        },
        required: ['assignmentId', 'studentId', 'score']
      }
    });

    await commandBus.registerHandler(assignmentGradeCmd, {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare(`
          INSERT INTO assignment_submissions (assignment_id, student_id, content, score, feedback, submitted_at, graded_at, status)
          VALUES (?, ?, '', ?, ?, ?, ?, 'graded')
          ON CONFLICT(assignment_id, student_id) DO UPDATE SET
            score = excluded.score,
            feedback = excluded.feedback,
            graded_at = excluded.graded_at,
            status = 'graded'
        `).run(payload.assignmentId, payload.studentId, payload.score, payload.feedback || '', Date.now(), Date.now());

        await eventBus.publish({
          id: uuidv7(),
          type: 'assignment.graded',
          source: 'management.student',
          payload: {
            assignmentId: payload.assignmentId,
            studentId: payload.studentId,
            score: payload.score,
            feedback: payload.feedback || ''
          },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, assignmentId: payload.assignmentId, studentId: payload.studentId, score: payload.score };
      }
    });

    // 17. SCHEDULE CREATE
    const scheduleCreateCmd = 'schedule.create';
    await actionRegistry.register({
      id: 'core-schedule-create',
      commandType: scheduleCreateCmd,
      description: '为班级在指定日期和时间安排一节课',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '课程/课件内容 ID' },
          scheduledDate: { type: 'STRING', description: '上课日期（YYYY-MM-DD）' },
          timeSlot: { type: 'STRING', description: '时间区间，格式 HH:MM-HH:MM（如 09:00-10:30）' },
          status: { type: 'STRING', description: '课程状态：scheduled（已安排）、cancelled（已取消）、holiday（假期）等' },
          notes: { type: 'STRING', description: '附加说明或备注' }
        },
        required: ['classId', 'lessonId', 'scheduledDate']
      }
    });

    await commandBus.registerHandler(scheduleCreateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const id = 'sch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        db.prepare(`
          INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          payload.classId,
          payload.lessonId,
          payload.scheduledDate,
          payload.timeSlot || null,
          payload.status || 'scheduled',
          payload.notes || null,
          Date.now()
        );
        
        // Dispatch schedule.created event so notification systems can respond
        await eventBus.publish({
          id: 'evt-' + Math.random().toString(36).slice(2, 10),
          type: 'schedule.created',
          source: 'management.schedule',
          payload: { id, ...payload },
          timestamp: Date.now(),
          correlationId: command.id
        });

        return { success: true, scheduleId: id, details: { id, class_id: payload.classId, lesson_id: payload.lessonId, scheduled_date: payload.scheduledDate, time_slot: payload.timeSlot, status: payload.status || 'scheduled', notes: payload.notes } };
      }
    });

    // 18. ATTENDANCE RECORD
    const attendanceRecordCmd = 'attendance.record';
    await actionRegistry.register({
      id: 'core-attendance-record',
      commandType: attendanceRecordCmd,
      description: '为指定课表记录每日考勤日志',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          scheduleId: { type: 'STRING', description: '课表 ID' },
          studentId: { type: 'STRING', description: '学生 ID' },
          status: { type: 'STRING', description: '出勤状态："Present"（出席）、"Absent"（缺席）、"Late"（迟到）或 "Excused"（请假）' }
        },
        required: ['scheduleId', 'studentId', 'status']
      }
    });

    await commandBus.registerHandler(attendanceRecordCmd, {
      async execute(command) {
        const payload = command.payload as any;
        db.prepare(`
          INSERT INTO attendance (schedule_id, student_id, status, recorded_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(schedule_id, student_id) DO UPDATE SET
            status = excluded.status,
            recorded_at = excluded.recorded_at
        `).run(payload.scheduleId, payload.studentId, payload.status, Date.now());
        return { success: true, scheduleId: payload.scheduleId, studentId: payload.studentId, status: payload.status };
      }
    });

    // 19. STUDENT SET PROGRESS
    const studentSetProgressCmd = 'student.set_progress';
    await actionRegistry.register({
      id: 'core-student-set-progress',
      commandType: studentSetProgressCmd,
      description: '记录或更新学生指定课程的学习进度',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentId: { type: 'STRING', description: 'ID of the student' },
          lessonId: { type: 'STRING', description: '课程 ID' },
          completed: { type: 'BOOLEAN', description: '完成标记' },
          progressPercent: { type: 'INTEGER', description: '已完成的进度百分比（0-100）' },
          completedSegments: { type: 'ARRAY', description: '已完成的环节 ID 列表' }
        },
        required: ['studentId', 'lessonId', 'completed', 'progressPercent']
      }
    });

    await commandBus.registerHandler(studentSetProgressCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const compVal = payload.completed ? 1 : 0;
        const completedSegmentsStr = typeof payload.completedSegments === 'string'
          ? payload.completedSegments
          : JSON.stringify(payload.completedSegments || []);
        db.prepare(`
          INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, completed_segments, assigned_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, lesson_id) DO UPDATE SET
            completed = excluded.completed,
            progress_percent = excluded.progress_percent,
            completed_segments = excluded.completed_segments
        `).run(payload.studentId, payload.lessonId, compVal, payload.progressPercent, completedSegmentsStr, Date.now());
        return { success: true, studentId: payload.studentId, lessonId: payload.lessonId, completed: payload.completed, progressPercent: payload.progressPercent, completedSegments: payload.completedSegments || [] };
      }
    });

    // 20. COMPUTER LAB CREATE
    const labCreateCmd = 'lab.create';
    await actionRegistry.register({
      id: 'core-lab-create',
      commandType: labCreateCmd,
      description: '创建或配置计算机实验室，指定房间号、行列数',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          roomNumber: { type: 'STRING', description: '计算机实验室的唯一名称或编号' },
          rows: { type: 'INTEGER', description: '座位布局的行数' },
          cols: { type: 'INTEGER', description: '座位布局的列数' }
        },
        required: ['roomNumber', 'rows', 'cols']
      }
    });

    await commandBus.registerHandler(labCreateCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const labId = uuidv7();
        db.prepare('INSERT INTO computer_labs (id, room_number, rows, cols, created_at) VALUES (?, ?, ?, ?, ?)').run(
          labId, payload.roomNumber, payload.rows, payload.cols, Date.now()
        );
        return { success: true, labId, roomNumber: payload.roomNumber, rows: payload.rows, cols: payload.cols };
      }
    });

    // 21. COMPUTER LAB LIST
    const labListCmd = 'lab.list';
    await actionRegistry.register({
      id: 'core-lab-list',
      commandType: labListCmd,
      description: '列出所有计算机实验室',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(labListCmd, {
      async execute() {
        const labs = db.prepare('SELECT * FROM computer_labs ORDER BY created_at DESC').all();
        return { success: true, labs };
      }
    });

    // 22. SEAT ASSIGN
    const labAssignSeatCmd = 'lab.assign_seat';
    await actionRegistry.register({
      id: 'core-lab-assign-seat',
      commandType: labAssignSeatCmd,
      description: '为班级学生在计算机实验室中分配指定座位（行列坐标）',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          studentId: { type: 'STRING', description: '学生 ID' },
          labId: { type: 'STRING', description: '计算机实验室 ID' },
          rowIdx: { type: 'INTEGER', description: '零基行索引' },
          colIdx: { type: 'INTEGER', description: '零基列索引' }
        },
        required: ['classId', 'studentId', 'labId', 'rowIdx', 'colIdx']
      }
    });

    await commandBus.registerHandler(labAssignSeatCmd, {
      async execute(command) {
        const payload = command.payload as any;
        
        // Update the class default lab_id
        db.prepare('UPDATE classes SET lab_id = ? WHERE id = ?').run(payload.labId, payload.classId);

        // Upsert the student seat
        db.prepare(`
          INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(class_id, student_id) DO UPDATE SET
            lab_id = excluded.lab_id,
            row_idx = excluded.row_idx,
            col_idx = excluded.col_idx
        `).run(payload.classId, payload.studentId, payload.labId, payload.rowIdx, payload.colIdx);

        return { success: true, classId: payload.classId, studentId: payload.studentId, labId: payload.labId, rowIdx: payload.rowIdx, colIdx: payload.colIdx };
      }
    });

    // 23. SCHEDULE CANCEL / SUSPEND
    const scheduleCancelCmd = 'schedule.cancel';
    await actionRegistry.register({
      id: 'core-schedule-cancel',
      commandType: scheduleCancelCmd,
      description: '取消、暂停或调整课表/假期安排',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          scheduleId: { type: 'STRING', description: '指定课表条目 ID' },
          classId: { type: 'STRING', description: '要影响的班级 ID（如提供 scheduleId 则为可选）' },
          scheduledDate: { type: 'STRING', description: '要暂停所有课表的目标日期（YYYY-MM-DD）' },
          status: { type: 'STRING', description: '新状态：cancelled（取消）、holiday（假期）、scheduled（已安排）' },
          notes: { type: 'STRING', description: '取消原因（如：国庆假期、教师请假）' }
        }
      }
    });

    await commandBus.registerHandler(scheduleCancelCmd, {
      async execute(command) {
        const payload = command.payload as any;
        const statusValue = payload.status || 'cancelled';
        const notesValue = payload.notes || 'System action';

        if (payload.scheduleId) {
          db.prepare('UPDATE schedules SET status = ?, notes = ? WHERE id = ?').run(
            statusValue, notesValue, payload.scheduleId
          );
          return { success: true, affectedId: payload.scheduleId, count: 1 };
        } else if (payload.classId && payload.scheduledDate) {
          const result = db.prepare('UPDATE schedules SET status = ?, notes = ? WHERE class_id = ? AND scheduled_date = ?').run(
            statusValue, notesValue, payload.classId, payload.scheduledDate
          );
          return { success: true, count: result.changes, classId: payload.classId, scheduledDate: payload.scheduledDate };
        } else if (payload.scheduledDate) {
          const result = db.prepare('UPDATE schedules SET status = ?, notes = ? WHERE scheduled_date = ?').run(
            statusValue, notesValue, payload.scheduledDate
          );
          return { success: true, count: result.changes, scheduledDate: payload.scheduledDate };
        }

        throw new Error('Either scheduleId, or BOTH classId and scheduledDate, or just scheduledDate must be supplied.');
      }
    });

    // 24. SCHEDULE LIST
    const scheduleListCmd = 'schedule.list';
    await actionRegistry.register({
      id: 'core-schedule-list',
      commandType: scheduleListCmd,
      description: '列出排课或课程表，支持查询过滤',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '按班级 ID 过滤' },
          scheduledDate: { type: 'STRING', description: '按精确日期过滤（YYYY-MM-DD）' }
        }
      }
    });

    await commandBus.registerHandler(scheduleListCmd, {
      async execute(command) {
        const payload = command.payload as any;
        let query = `
          SELECT s.*, COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title, c.name as class_name
          FROM schedules s
          LEFT JOIN lessons l ON s.lesson_id = l.id
          JOIN classes c ON s.class_id = c.id
        `;
        const params: any[] = [];
        const clauses: string[] = [];

        if (payload.classId) {
          clauses.push('s.class_id = ?');
          params.push(payload.classId);
        }
        if (payload.scheduledDate) {
          clauses.push('s.scheduled_date = ?');
          params.push(payload.scheduledDate);
        }

        if (clauses.length > 0) {
          query += ' WHERE ' + clauses.join(' AND ');
        }
        query += ' ORDER BY s.scheduled_date DESC, s.time_slot ASC, s.created_at ASC';

        const schedules = db.prepare(query).all(...params);
        return { success: true, schedules };
      }
    });
  },
  deactivate: async () => {
    // Cleanups automatically handled by ResourceTracker
  }
};

