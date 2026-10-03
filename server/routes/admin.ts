import fs from 'fs';
import path from 'path';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { randomId } from '../utils/id.js';
import { requireAuth } from '../middleware/auth.js';
import type { ServerContext } from '../context.js';
import { generateStudentNumber } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { seedDemoData, DEMO_IDS, DEMO_TEACHER } from '../services/demo-data.js';

export function registerAdminRoutes(ctx: ServerContext) {
  const { app } = ctx;

  /**
   * 兼容端点：新手引导（HelpTour）仍在调用。
   *
   * 2026-10-03 起改为委托给 `server/services/demo-data.ts` 的正式播种实现 ——
   * 旧实现有两个安全问题：
   *   1. `lessonId` 取自 `SELECT id FROM lessons LIMIT 1`，**劫持真实课程**；
   *   2. 学生按 `student_number`（S001…）复用，可能把**真实学生**链接进演示班级。
   * 新实现自建课程与学生，并把创建的每一行登记进 `demo_data_registry`，
   * 使"一键清理"可以精确删除而不误伤真实数据。
   *
   * 响应字段保持向后兼容（HelpTour 依赖 classId / scheduleId / lessonId）。
   */
  app.post('/api/admin/seed-demo', requireAuth('administrator'), (req, res) => {
    try {
      const status = seedDemoData(kernelContainer.db);
      res.json({
        success: true,
        classId: DEMO_IDS.primaryClass,
        scheduleId: DEMO_IDS.schedule,
        lessonId: DEMO_IDS.lesson,
        result: { ...status, credentials: DEMO_TEACHER },
      });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/classes/import', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { classes } = req.body;
      if (!classes || !Array.isArray(classes)) {
        return res.status(400).json({ error: 'Invalid payload: classes must be an array' });
      }

      const db = kernelContainer.db;

      const insertClass = db.prepare('INSERT INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)');
      const insertStudent = db.prepare(
        'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      const insertClassStudent = db.prepare(
        'INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)',
      );
      const findStudentByEmail = db.prepare('SELECT id FROM students WHERE email = ?');

      const imported = [];

      // DATA-INT-01: 整批导入包事务 —— 任一学生落库失败整体回滚，不残留半截班级
      const importTx = db.transaction(() => {
        for (const cls of classes) {
          const clsName = cls.name || cls.className;
          const clsDesc = cls.description || cls.classDescription || '';
          if (!clsName) continue;

          // Generate a random ID for the class
          const classId = randomId();
          insertClass.run(classId, clsName, clsDesc, Date.now());

          const studentsList = cls.students || [];
          const importedStudents = [];

          for (const st of studentsList) {
            const stName = st.name || st.studentName;
            const stEmail = st.email || st.studentEmail || '';
            if (!stName) continue;

            let studentId = '';
            if (stEmail) {
              const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
              if (existing) {
                studentId = existing.id;
              }
            }

            if (!studentId) {
              studentId = randomId();
              const studentNumber = generateStudentNumber(db) || `ST_${studentId}`;
              insertStudent.run(studentId, studentNumber, stName, stEmail, Date.now());
            }

            insertClassStudent.run(classId, studentId, Date.now());
            importedStudents.push({ id: studentId, name: stName, email: stEmail });
          }

          imported.push({
            id: classId,
            name: clsName,
            studentsCount: importedStudents.length,
          });
        }
      });
      importTx();

      res.json({ success: true, imported });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/students/import', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const { students } = req.body;
      if (!students || !Array.isArray(students)) {
        return res.status(400).json({ error: 'Invalid payload: students must be an array' });
      }

      const db = kernelContainer.db;
      const insertStudent = db.prepare(
        'INSERT INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      );
      const findStudentByEmail = db.prepare('SELECT id FROM students WHERE email = ?');

      const imported = [];
      for (const st of students) {
        const stName = st.name;
        const stEmail = st.email || '';
        const stNum = st.student_number || '';
        if (!stName) continue;

        let studentId = '';
        if (stEmail) {
          const existing = findStudentByEmail.get(stEmail) as { id: string } | undefined;
          if (existing) {
            studentId = existing.id;
          }
        }

        if (!studentId) {
          studentId = randomId();
          const finalNum = stNum && stNum.trim() !== '' ? stNum.trim() : `ST_${studentId}`;
          insertStudent.run(studentId, finalNum, stName, stEmail, Date.now());
          imported.push({ id: studentId, student_number: finalNum, name: stName, email: stEmail, new: true });
        } else {
          imported.push({ id: studentId, name: stName, email: stEmail, new: false });
        }
      }

      res.json({ success: true, imported });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/audit-report/download', requireAuth('administrator'), (_req, res) => {
    const reportPath = path.join(process.cwd(), 'docs/architecture/code-quality-audit-report.md');
    if (fs.existsSync(reportPath)) {
      res.download(reportPath, 'OpenLearn-V2-Audit-Report.md');
    } else {
      res.status(404).json({ success: false, error: 'Report not found' });
    }
  });

  app.get('/api/remediation-roadmap/download', requireAuth('administrator'), (_req, res) => {
    const roadmapPath = path.join(process.cwd(), 'docs/architecture/remediation-and-optimization-roadmap.md');
    if (fs.existsSync(roadmapPath)) {
      res.download(roadmapPath, 'OpenLearn-V2-Remediation-Roadmap.md');
    } else {
      res.status(404).json({ success: false, error: 'Roadmap not found' });
    }
  });

  app.get('/api/classroom-optimization-plan/download', requireAuth('administrator'), (_req, res) => {
    const planPath = path.join(
      process.cwd(),
      'docs/architecture/interactive-classroom-and-editor-optimization-plan.md',
    );
    if (fs.existsSync(planPath)) {
      res.download(planPath, 'OpenLearn-V2-Classroom-Optimization-Plan.md');
    } else {
      res.status(404).json({ success: false, error: 'Optimization plan not found' });
    }
  });
}
