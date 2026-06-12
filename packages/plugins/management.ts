import { kernelContainer } from '../core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

export function bootstrapManagementPlugins() {
  const { commandBus, actionRegistry, db, eventBus } = kernelContainer;

  // Helper functions for student number auto-generation (S001 style)
  const generateStudentNumber = (db: any): string => {
    const rows = db.prepare('SELECT student_number FROM students WHERE student_number LIKE "S%"').all() as { student_number: string }[];
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
  actionRegistry.register({
    id: 'core-class-create',
    commandType: classCreateCmd,
    description: 'Create a new class for the online learning system.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the class' },
        description: { type: 'STRING', description: 'Description of the class' }
      },
      required: ['name']
    }
  });

  commandBus.registerHandler(classCreateCmd, {
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
  actionRegistry.register({
    id: 'core-class-list',
    commandType: classListCmd,
    description: 'List all classes.',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(classListCmd, {
    async execute() {
      const classes = db.prepare('SELECT * FROM classes ORDER BY created_at DESC').all();
      return { classes };
    }
  });

  // 3. STUDENT CREATE
  const studentCreateCmd = 'student.create';
  actionRegistry.register({
    id: 'core-student-create',
    commandType: studentCreateCmd,
    description: 'Create a new student.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the student' },
        email: { type: 'STRING', description: 'Email of the student' },
        student_number: { type: 'STRING', description: 'Student ID number (optional, used as username)' }
      },
      required: ['name']
    }
  });

  commandBus.registerHandler(studentCreateCmd, {
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
  actionRegistry.register({
    id: 'core-student-list',
    commandType: studentListCmd,
    description: 'List all students.',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(studentListCmd, {
    async execute() {
      const students = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all();
      return { students };
    }
  });

  // 5. CLASS ADD STUDENT
  const classAddStudentCmd = 'class.add_student';
  actionRegistry.register({
    id: 'core-class-add-student',
    commandType: classAddStudentCmd,
    description: 'Add a student to a class.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' },
        studentId: { type: 'STRING', description: 'ID of the student' }
      },
      required: ['classId', 'studentId']
    }
  });

  commandBus.registerHandler(classAddStudentCmd, {
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
  actionRegistry.register({
    id: 'core-class-update',
    commandType: classUpdateCmd,
    description: 'Update a class details.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' },
        name: { type: 'STRING', description: 'Name of the class' },
        description: { type: 'STRING', description: 'Description of the class' }
      },
      required: ['classId']
    }
  });

  commandBus.registerHandler(classUpdateCmd, {
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
  actionRegistry.register({
    id: 'core-class-delete',
    commandType: classDeleteCmd,
    description: 'Delete a class.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' }
      },
      required: ['classId']
    }
  });

  commandBus.registerHandler(classDeleteCmd, {
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
  actionRegistry.register({
    id: 'core-class-get-students',
    commandType: classGetStudentsCmd,
    description: 'Get all students enrolled in a specific class.',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' }
      },
      required: ['classId']
    }
  });

  commandBus.registerHandler(classGetStudentsCmd, {
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
  actionRegistry.register({
    id: 'core-student-update',
    commandType: studentUpdateCmd,
    description: 'Update a student details.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        studentId: { type: 'STRING', description: 'ID of the student' },
        name: { type: 'STRING', description: 'Name of the student' },
        email: { type: 'STRING', description: 'Email of the student' },
        student_number: { type: 'STRING', description: 'Student ID number' }
      },
      required: ['studentId']
    }
  });

  commandBus.registerHandler(studentUpdateCmd, {
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
  actionRegistry.register({
    id: 'core-student-delete',
    commandType: studentDeleteCmd,
    description: 'Delete a student.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        studentId: { type: 'STRING', description: 'ID of the student' }
      },
      required: ['studentId']
    }
  });

  commandBus.registerHandler(studentDeleteCmd, {
    async execute(command) {
      const payload = command.payload as any;
      db.prepare('DELETE FROM class_students WHERE student_id = ?').run(payload.studentId);
      db.prepare('DELETE FROM students WHERE id = ?').run(payload.studentId);
      return { success: true };
    }
  });

  // 10. CLASS REMOVE STUDENT
  const classRemoveStudentCmd = 'class.remove_student';
  actionRegistry.register({
    id: 'core-class-remove-student',
    commandType: classRemoveStudentCmd,
    description: 'Remove a student from a class.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' },
        studentId: { type: 'STRING', description: 'ID of the student' }
      },
      required: ['classId', 'studentId']
    }
  });

  commandBus.registerHandler(classRemoveStudentCmd, {
    async execute(command) {
      const payload = command.payload as any;
      db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(payload.classId, payload.studentId);
      return { success: true };
    }
  });

  // 11. CLASS IMPORT TEMPLATE DOWNLOAD/SAVE
  const classTemplateDownloadCmd = 'class.template_download';
  actionRegistry.register({
    id: 'core-class-template-download',
    commandType: classTemplateDownloadCmd,
    description: 'Generate and save a Class and Student Roster CSV import template under VFS root as "/class_import_template.csv".',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(classTemplateDownloadCmd, {
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
  actionRegistry.register({
    id: 'core-student-template-download',
    commandType: studentTemplateDownloadCmd,
    description: 'Generate and save a Student CSV import template under VFS root as "/student_import_template.csv".',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(studentTemplateDownloadCmd, {
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
  actionRegistry.register({
    id: 'core-student-add-note',
    commandType: studentAddNoteCmd,
    description: 'Add or update private observation note for a student (Academic/Behavioral/SpecialCare/General).',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        studentId: { type: 'STRING', description: 'ID of the student' },
        category: { type: 'STRING', description: 'Category: Academic, Behavioral, SpecialCare, or General' },
        notesHtml: { type: 'STRING', description: 'Notes body in HTML or rich text.' }
      },
      required: ['studentId', 'category', 'notesHtml']
    }
  });

  commandBus.registerHandler(studentAddNoteCmd, {
    async execute(command) {
      const payload = command.payload as any;
      const serialized = JSON.stringify({ category: payload.category || 'General', html: payload.notesHtml });
      db.prepare('UPDATE students SET private_notes = ? WHERE id = ?').run(serialized, payload.studentId);
      return { success: true, studentId: payload.studentId, category: payload.category, private_notes: serialized };
    }
  });

  // 14. ASSIGNMENT CREATE
  const assignmentCreateCmd = 'assignment.create';
  actionRegistry.register({
    id: 'core-assignment-create',
    commandType: assignmentCreateCmd,
    description: 'Create a course homework assignment for a specific class.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the target class' },
        title: { type: 'STRING', description: 'Title of the assignment' },
        description: { type: 'STRING', description: 'Short summary or overview of the assignment' },
        content: { type: 'STRING', description: 'Detailed instruction body or prompt requirements' }
      },
      required: ['classId', 'title']
    }
  });

  commandBus.registerHandler(assignmentCreateCmd, {
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
  actionRegistry.register({
    id: 'core-assignment-submit',
    commandType: assignmentSubmitCmd,
    description: 'Submit completed homework text or documentation for an assignment on behalf of a student.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        assignmentId: { type: 'STRING', description: 'ID of the assignment' },
        studentId: { type: 'STRING', description: 'ID of the student' },
        content: { type: 'STRING', description: 'Submission content body (text, markdown or code)' }
      },
      required: ['assignmentId', 'studentId', 'content']
    }
  });

  commandBus.registerHandler(assignmentSubmitCmd, {
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
  actionRegistry.register({
    id: 'core-assignment-grade',
    commandType: assignmentGradeCmd,
    description: 'Grade a student submission with score points and feedback.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        assignmentId: { type: 'STRING', description: 'ID of the assignment' },
        studentId: { type: 'STRING', description: 'ID of the student' },
        score: { type: 'INTEGER', description: 'Score out of 100 or maximum grade points' },
        feedback: { type: 'STRING', description: 'Constructive feedback message text' }
      },
      required: ['assignmentId', 'studentId', 'score']
    }
  });

  commandBus.registerHandler(assignmentGradeCmd, {
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
  actionRegistry.register({
    id: 'core-schedule-create',
    commandType: scheduleCreateCmd,
    description: 'Schedule a lesson instance/class slot for a class on a specific date and time.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' },
        lessonId: { type: 'STRING', description: 'ID of the lesson/course content' },
        scheduledDate: { type: 'STRING', description: 'Date of the slot (YYYY-MM-DD)' },
        timeSlot: { type: 'STRING', description: 'Time interval, format HH:MM-HH:MM (e.g., 09:00-10:30)' },
        status: { type: 'STRING', description: 'Status of class: scheduled, cancelled, holiday, etc.' },
        notes: { type: 'STRING', description: 'Additional instructions or schedule comments' }
      },
      required: ['classId', 'lessonId', 'scheduledDate']
    }
  });

  commandBus.registerHandler(scheduleCreateCmd, {
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
  actionRegistry.register({
    id: 'core-attendance-record',
    commandType: attendanceRecordCmd,
    description: 'Record day-by-day attendance log for a specific class schedule.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        scheduleId: { type: 'STRING', description: 'ID of the schedule timetable' },
        studentId: { type: 'STRING', description: 'ID of the student' },
        status: { type: 'STRING', description: 'Attendance status: "Present", "Absent", "Late", or "Excused"' }
      },
      required: ['scheduleId', 'studentId', 'status']
    }
  });

  commandBus.registerHandler(attendanceRecordCmd, {
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
  actionRegistry.register({
    id: 'core-student-set-progress',
    commandType: studentSetProgressCmd,
    description: 'Record or update ongoing syllabus progress logs for an assigned student study stream.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        studentId: { type: 'STRING', description: 'ID of the student' },
        lessonId: { type: 'STRING', description: 'ID of the lesson key' },
        completed: { type: 'BOOLEAN', description: 'Completion check flag' },
        progressPercent: { type: 'INTEGER', description: 'Gradual score progress percentage completed (0-100)' },
        completedSegments: { type: 'ARRAY', description: 'List of completed segment IDs' }
      },
      required: ['studentId', 'lessonId', 'completed', 'progressPercent']
    }
  });

  commandBus.registerHandler(studentSetProgressCmd, {
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
  actionRegistry.register({
    id: 'core-lab-create',
    commandType: labCreateCmd,
    description: 'Create or configure a computer lab with designated room number, rows, and columns.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        roomNumber: { type: 'STRING', description: 'The unique name or number of the computer lab' },
        rows: { type: 'INTEGER', description: 'Number of rows in the seating arrangement' },
        cols: { type: 'INTEGER', description: 'Number of columns in the seating arrangement' }
      },
      required: ['roomNumber', 'rows', 'cols']
    }
  });

  commandBus.registerHandler(labCreateCmd, {
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
  actionRegistry.register({
    id: 'core-lab-list',
    commandType: labListCmd,
    description: 'List all computer labs.',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {}
    }
  });

  commandBus.registerHandler(labListCmd, {
    async execute() {
      const labs = db.prepare('SELECT * FROM computer_labs ORDER BY created_at DESC').all();
      return { success: true, labs };
    }
  });

  // 22. SEAT ASSIGN
  const labAssignSeatCmd = 'lab.assign_seat';
  actionRegistry.register({
    id: 'core-lab-assign-seat',
    commandType: labAssignSeatCmd,
    description: 'Assign a student to a specific seat index (row, column) in a computer lab for a class.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the class' },
        studentId: { type: 'STRING', description: 'ID of the student' },
        labId: { type: 'STRING', description: 'ID of the computer lab' },
        rowIdx: { type: 'INTEGER', description: 'Zero-based row index' },
        colIdx: { type: 'INTEGER', description: 'Zero-based column index' }
      },
      required: ['classId', 'studentId', 'labId', 'rowIdx', 'colIdx']
    }
  });

  commandBus.registerHandler(labAssignSeatCmd, {
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
  actionRegistry.register({
    id: 'core-schedule-cancel',
    commandType: scheduleCancelCmd,
    description: 'Cancel, suspend, or adjust a schedule slot/holiday arrangement.',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        scheduleId: { type: 'STRING', description: 'Specific schedule entry ID' },
        classId: { type: 'STRING', description: 'Class ID to affect (optional if scheduleId provided)' },
        scheduledDate: { type: 'STRING', description: 'Target date to suspend all schedules on (YYYY-MM-DD)' },
        status: { type: 'STRING', description: 'New status: cancelled, holiday, scheduled' },
        notes: { type: 'STRING', description: 'Cancellation reason (e.g., 国庆假期, 教师请假)' }
      }
    }
  });

  commandBus.registerHandler(scheduleCancelCmd, {
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
  actionRegistry.register({
    id: 'core-schedule-list',
    commandType: scheduleListCmd,
    description: 'List scheduled classes or timetables with query filters.',
    capabilityRequired: 'management:read',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'Filter by class ID' },
        scheduledDate: { type: 'STRING', description: 'Filter by exact date (YYYY-MM-DD)' }
      }
    }
  });

  commandBus.registerHandler(scheduleListCmd, {
    async execute(command) {
      const payload = command.payload as any;
      let query = `
        SELECT s.*, l.title as lesson_title, c.name as class_name
        FROM schedules s
        JOIN lessons l ON s.lesson_id = l.id
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
}
