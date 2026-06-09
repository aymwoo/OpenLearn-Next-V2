import { kernelContainer } from '../core/kernel/index.js';
import { v7 as uuidv7 } from 'uuid';

export function bootstrapManagementPlugins() {
  const { commandBus, actionRegistry, db, eventBus } = kernelContainer;

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
        email: { type: 'STRING', description: 'Email of the student' }
      },
      required: ['name']
    }
  });

  commandBus.registerHandler(studentCreateCmd, {
    async execute(command) {
      const payload = command.payload as any;
      const studentId = uuidv7();
      db.prepare('INSERT INTO students (id, name, email, created_at) VALUES (?, ?, ?, ?)').run(
        studentId, payload.name, payload.email || '', Date.now()
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
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(payload.classId);
      db.prepare('DELETE FROM classes WHERE id = ?').run(payload.classId);
      return { success: true };
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
        email: { type: 'STRING', description: 'Email of the student' }
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
    description: 'Create a timetable schedule entry for class sessions on a calendar date (YYYY-MM-DD).',
    capabilityRequired: 'management:write',
    inputSchema: {
      type: 'OBJECT',
      properties: {
        classId: { type: 'STRING', description: 'ID of the target class' },
        lessonId: { type: 'STRING', description: 'ID of the teaching lesson' },
        scheduledDate: { type: 'STRING', description: 'Scheduled date of the session (e.g. 2026-06-12)' }
      },
      required: ['classId', 'lessonId', 'scheduledDate']
    }
  });

  commandBus.registerHandler(scheduleCreateCmd, {
    async execute(command) {
      const payload = command.payload as any;
      const id = uuidv7();
      db.prepare('INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, payload.classId, payload.lessonId, payload.scheduledDate, Date.now());
      return { scheduleId: id, classId: payload.classId, lessonId: payload.lessonId, scheduledDate: payload.scheduledDate };
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
        progressPercent: { type: 'INTEGER', description: 'Gradual score progress percentage completed (0-100)' }
      },
      required: ['studentId', 'lessonId', 'completed', 'progressPercent']
    }
  });

  commandBus.registerHandler(studentSetProgressCmd, {
    async execute(command) {
      const payload = command.payload as any;
      const compVal = payload.completed ? 1 : 0;
      db.prepare(`
        INSERT INTO student_lesson_progress (student_id, lesson_id, completed, progress_percent, assigned_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(student_id, lesson_id) DO UPDATE SET
          completed = excluded.completed,
          progress_percent = excluded.progress_percent
      `).run(payload.studentId, payload.lessonId, compVal, payload.progressPercent, Date.now());
      return { success: true, studentId: payload.studentId, lessonId: payload.lessonId, completed: payload.completed, progressPercent: payload.progressPercent };
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
}
