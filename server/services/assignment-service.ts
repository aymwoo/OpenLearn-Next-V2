/**
 * 作业与提交流程领域服务 (AssignmentService)
 *
 * 承载传统班级作业与测试命题、学生作答提交、LLM 智能自动打分，
 * 以及作业中心（Assignment Hub）多模态附件安全校验、学生存储配额事务、
 * 异步磁盘落盘与软删除物理 GC 清理。
 * 独立于 Express HTTP 传输层，可直接注入 mock/db 进行无状态单元测试。
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { randomId } from '../utils/id.js';
import { validateMagicBytes, SIZE_LIMITS, BLOCKED_EXTENSIONS } from '../utils/upload.js';
import { isPathInsideRoot } from '../utils/path-guard.js';
import {
  ALLOWED_ASSIGNMENT_EXT,
  ZIP_CONTAINER_EXT,
  ASSIGNMENT_MAX_FILE_SIZE,
  STUDENT_ASSIGNMENT_QUOTA_BYTES,
  parseAllowedExt,
} from '../utils/assignment-upload-policy.js';

export function safeSegment(value: string): string {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 96) : 'unknown';
}

export function assignmentStorageDir(assignmentId: string, studentId: string): string {
  return path.join(process.cwd(), 'storage', 'assignments', safeSegment(assignmentId), safeSegment(studentId));
}

export interface TraditionalAssignmentItem {
  id: string;
  class_id: string;
  lesson_id?: string | null;
  title: string;
  description: string;
  content: string;
  created_at: number;
}

export interface TraditionalSubmissionItem {
  assignment_id: string;
  student_id: string;
  student_name?: string;
  content: string;
  score?: number | null;
  feedback?: string | null;
  submitted_at: number;
  graded_at?: number | null;
  status: string;
}

export interface UploadFileResult {
  id: string;
  name: string;
  size: number;
  sha256: string;
  studentId: string;
}

export class AssignmentService {
  constructor(
    private readonly db: Database.Database = kernelContainer.db,
    private readonly aiService: any = kernelContainer.aiService,
    private readonly commandBus: any = kernelContainer.commandBus,
  ) {}

  // ── 1. 传统班级作业与测试 ────────────────────────────────────────────────

  public listClassAssignments(classId: string): TraditionalAssignmentItem[] {
    return this.db
      .prepare('SELECT * FROM assignments WHERE class_id = ? ORDER BY created_at DESC')
      .all(classId) as TraditionalAssignmentItem[];
  }

  public getTraditionalAssignment(id: string): TraditionalAssignmentItem | undefined {
    return this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(id) as TraditionalAssignmentItem | undefined;
  }

  public createTraditionalAssignment(
    classId: string,
    lessonId: string | null,
    title: string,
    description: string,
    content: string,
  ): string {
    const id = randomId('ast_');
    this.db
      .prepare(
        'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, classId, lessonId || null, title || 'Untitled Assignment', description || '', content || '', Date.now());
    return id;
  }

  public async generateQuizWithAi(
    classId: string,
    topic: string,
    lessonId?: string,
  ): Promise<{
    id: string;
    class_id: string;
    lesson_id: string | null;
    title: string;
    description: string;
    content: string;
  }> {
    const prompt = `You are an expert teacher. Generate a short 1-question quiz or assignment about "${topic}". Output in this JSON format: {"title": "...", "description": "...", "content": "..."} without markdown blocks.`;
    const text = await this.aiService.generateText(prompt);
    const cleanText = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    let gen = { title: 'Untitled Quiz', description: '', content: '' };
    try {
      gen = JSON.parse(cleanText);
    } catch {
      /* fallback */
    }

    const id = randomId('ast_');
    this.db
      .prepare(
        'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        classId,
        lessonId || null,
        gen.title || `Quiz: ${topic}`,
        gen.description || '',
        gen.content || '',
        Date.now(),
      );

    return {
      id,
      class_id: classId,
      lesson_id: lessonId || null,
      title: gen.title,
      description: gen.description,
      content: gen.content,
    };
  }

  public async suggestQuizWithAi(lessonId: string): Promise<any> {
    const lesson = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId) as any;
    if (!lesson) {
      const err: any = new Error('Lesson not found');
      err.status = 404;
      throw err;
    }

    const prompt = `You are an expert curriculum developer and instructional designer. 
Analyze the following lesson content and:
1. Identify 3 to 5 key learning objectives covered in this lesson.
2. Automatically write exactly 3 to 4 multiple-choice questions mapped to those key learning objectives based on the lesson content.
   Each question must test a specific learning objective, have 4 realistic options, and one correct answer that corresponds exactly to one of the options.

Lesson Title: ${lesson.title}
Lesson Content:
${lesson.content}

Output pure JSON only without markdown code blocks, matching this structure:
{
  "learningObjectives": ["objective 1", "objective 2"],
  "questions": [
    {
      "objective": "objective 1",
      "question": "question text",
      "options": ["A) opt1", "B) opt2", "C) opt3", "D) opt4"],
      "correctAnswer": "A) opt1"
    }
  ]
}`;

    const text = await this.aiService.generateText(prompt);
    const cleanText = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleanText);
  }

  public createSuggestedQuiz(
    classId: string,
    params: {
      title?: string;
      description?: string;
      questions: any[];
      learningObjectives?: string[];
      timeLimit?: number;
      lessonId?: string;
    },
  ): string {
    const { title, description, questions, learningObjectives, timeLimit, lessonId } = params;
    const id = randomId('ast_');
    const contentJson = JSON.stringify({
      quizType: 'mcq_learning_objectives',
      questions,
      learningObjectives: learningObjectives || [],
      timeLimit: timeLimit || 0,
    });

    this.db
      .prepare(
        'INSERT INTO assignments (id, class_id, lesson_id, title, description, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, classId, lessonId || null, title || 'AI Suggested Quiz', description || '', contentJson, Date.now());

    return id;
  }

  public resolveTargetStudentId(
    studentId: string,
    currentUserId: string | null | undefined,
    isPrivileged: boolean,
  ): string {
    const studentRow = this.db
      .prepare('SELECT id, student_number FROM students WHERE id = ? OR student_number = ?')
      .get(studentId, studentId) as any;

    const isSelf = studentRow
      ? currentUserId === studentRow.id || (studentRow.student_number && currentUserId === studentRow.student_number)
      : currentUserId === studentId;

    if (!isPrivileged && !isSelf) {
      const err: any = new Error('Cannot submit assignment on behalf of another student');
      err.status = 403;
      throw err;
    }

    return studentRow ? studentRow.id : studentId;
  }

  public submitTraditionalAssignment(assignmentId: string, studentId: string, content: string): void {
    this.db
      .prepare(
        `
      INSERT INTO assignment_submissions (assignment_id, student_id, content, submitted_at, status)
      VALUES (?, ?, ?, ?, 'submitted')
      ON CONFLICT(assignment_id, student_id) DO UPDATE SET content = excluded.content, submitted_at = excluded.submitted_at, status = 'submitted'
    `,
      )
      .run(assignmentId, studentId, content, Date.now());
  }

  public listTraditionalSubmissions(assignmentId: string): TraditionalSubmissionItem[] {
    return this.db
      .prepare(
        `
      SELECT asb.*, s.name as student_name
      FROM assignment_submissions asb
      JOIN students s ON asb.student_id = s.id
      WHERE asb.assignment_id = ?
      ORDER BY asb.submitted_at DESC
    `,
      )
      .all(assignmentId) as TraditionalSubmissionItem[];
  }

  public async gradeTraditionalAssignment(
    assignmentId: string,
    studentId: string,
  ): Promise<{ score: number; feedback: string }> {
    const asb = this.db
      .prepare('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?')
      .get(assignmentId, studentId) as any;
    const ast = this.db.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId) as any;
    if (!asb || !ast) {
      throw new Error('Submission or assignment not found');
    }

    let grade = { score: 0, feedback: '' };
    let isMcqQuiz = false;
    let autoScore: number | null = null;
    let autoFeedback = '';

    try {
      const quizObj = JSON.parse(ast.content);
      if (quizObj && quizObj.quizType === 'mcq_learning_objectives') {
        isMcqQuiz = true;
        const studentAnswers = JSON.parse(asb.content);
        const questions = quizObj.questions;
        let correctCount = 0;
        const feedbackParts: string[] = [];

        questions.forEach((q: any, idx: number) => {
          const studentAns = studentAnswers[idx];
          const isCorrect = studentAns === q.correctAnswer;
          if (isCorrect) {
            correctCount++;
            feedbackParts.push(
              `Q${idx + 1}: Correct! Option: "${q.correctAnswer}" (Tests Objective: ${q.objective})`,
            );
          } else {
            feedbackParts.push(
              `Q${idx + 1}: Incorrect. Your Answer: "${studentAns || 'None'}". Correct Option: "${q.correctAnswer}" (Tests Objective: ${q.objective})`,
            );
          }
        });

        autoScore = Math.round((correctCount / questions.length) * 100);
        autoFeedback = `Auto-Graded Multiple Choice Quiz.\nScore: ${autoScore}%\n\nDetails:\n${feedbackParts.join('\n')}`;
      }
    } catch {
      // Not a structured MCQ quiz
    }

    if (isMcqQuiz && autoScore !== null) {
      const prompt = `You are a warm and helpful AI tutor. A student has taken a multiple-choice quiz mapped to lesson learning objectives.
Questions & Answers: ${ast.content}
Student's Selected Choices: ${asb.content}
Calculated Score: ${autoScore}%

Write an encouraging message explaining why their correct answers are correct, and gently explaining why the correct concept is correct for any questions they got incorrect. Connect it directly back to the key learning objectives.
Provide a grade score (${autoScore}) and tutoring feedback. You MUST output in this exact JSON format: {"score": ${autoScore}, "feedback": "tutoring feedback..."} without markdown formatting or backticks.`;

      const text = await this.aiService.generateText(prompt);
      const cleanText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      try {
        grade = JSON.parse(cleanText);
        grade.score = autoScore;
      } catch {
        grade = { score: autoScore, feedback: autoFeedback };
      }
    } else {
      const prompt = `You are a strict but fair teacher grading a student's answer.
Assignment Question: ${ast.content}
Student's Answer: ${asb.content}
Provide a grade score (0-100) and brief feedback. Ensure you output in this exact JSON format: {"score": 85, "feedback": "Good job..."} without markdown formatting or backticks.`;

      const text = await this.aiService.generateText(prompt);
      const cleanText = text
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      try {
        grade = JSON.parse(cleanText);
      } catch {
        grade = { score: 0, feedback: 'Grading failed to parse' };
      }
    }

    if (this.commandBus) {
      const { v7: uuidv7 } = await import('uuid');
      await this.commandBus.execute({
        id: uuidv7(),
        type: 'ai.apply_grade',
        actorId: 'system',
        timestamp: Date.now(),
        payload: {
          assignmentId,
          studentId,
          score: grade.score,
          feedback: grade.feedback,
        },
      });
    }

    return grade;
  }

  // ── 2. 班级归属核验与权限辅助 ──────────────────────────────────────────

  public assertClassMembership(
    assignment: { class_id: string | null } | undefined,
    isPrivileged: boolean,
    studentId: string | null,
  ): void {
    if (isPrivileged || !assignment?.class_id || !studentId) return;
    const enrolled = this.db
      .prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1')
      .get(assignment.class_id, studentId) as { ok: number } | undefined;
    if (!enrolled) {
      const err: any = new Error("Forbidden: You are not enrolled in this assignment's class");
      err.status = 403;
      throw err;
    }
  }

  // ── 3. 作业中心文件安全上传与配额 ──────────────────────────────────────

  public async uploadAssignmentFile(params: {
    assignmentId: string;
    ownerStudentId: string;
    isPrivileged: boolean;
    fileName: string;
    buffer: Buffer;
    contentType?: string | null;
  }): Promise<UploadFileResult> {
    const { assignmentId, ownerStudentId, isPrivileged, fileName, buffer, contentType } = params;

    const assignment = this.db
      .prepare(
        'SELECT id, class_id, max_files, max_file_size, status, due_at, allow_late, allowed_ext FROM plugin_assignments WHERE id = ?',
      )
      .get(assignmentId) as
      | {
          id: string;
          class_id: string | null;
          max_files: number;
          max_file_size: number;
          status: string;
          due_at: number | null;
          allow_late: number;
          allowed_ext: string | null;
        }
      | undefined;

    if (!assignment) {
      const err: any = new Error(`Assignment not found: ${assignmentId}`);
      err.status = 404;
      throw err;
    }

    this.assertClassMembership(assignment, isPrivileged, ownerStudentId);

    if (assignment.status !== 'published') {
      const err: any = new Error(`Assignment is ${assignment.status}`);
      err.status = 409;
      throw err;
    }

    if (
      !isPrivileged &&
      assignment.due_at !== null &&
      Date.now() > Number(assignment.due_at) &&
      !assignment.allow_late
    ) {
      const err: any = new Error('Assignment is past due (late uploads not allowed)');
      err.status = 409;
      throw err;
    }

    const ext = path.extname(fileName).toLowerCase();
    if (!ALLOWED_ASSIGNMENT_EXT.has(ext)) {
      const err: any = new Error(`File type not allowed: ${ext || '(none)'}`);
      err.status = 400;
      throw err;
    }
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      const err: any = new Error(`File type blocked: ${ext}`);
      err.status = 400;
      throw err;
    }

    const perAssignmentExt = parseAllowedExt(assignment.allowed_ext);
    if (perAssignmentExt && !perAssignmentExt.has(ext)) {
      const err: any = new Error(`File type not allowed for this assignment: ${ext}`);
      err.status = 400;
      throw err;
    }

    if (buffer.length === 0) {
      const err: any = new Error('Empty file body');
      err.status = 400;
      throw err;
    }

    const sizeLimit = Math.min(Number(assignment.max_file_size) || SIZE_LIMITS.assignment, ASSIGNMENT_MAX_FILE_SIZE);
    if (buffer.length > sizeLimit) {
      const err: any = new Error(`File too large (limit ${sizeLimit} bytes)`);
      err.status = 413;
      throw err;
    }
    if (ZIP_CONTAINER_EXT.has(ext) && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      const err: any = new Error('File content does not match its extension');
      err.status = 400;
      throw err;
    }
    if (!validateMagicBytes(buffer, fileName)) {
      const err: any = new Error('File content does not match its extension');
      err.status = 400;
      throw err;
    }

    const dir = assignmentStorageDir(assignmentId, ownerStudentId);
    fs.mkdirSync(dir, { recursive: true });
    const storedName = `${crypto.randomUUID()}${ext}`;
    const storedPath = path.join(dir, storedName);

    await fs.promises.writeFile(storedPath, buffer);

    const fileId = 'af-' + crypto.randomUUID();
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    try {
      const insertTx = this.db.transaction(() => {
        const currentCount = (
          this.db
            .prepare(
              'SELECT COUNT(*) AS c FROM plugin_assignment_files WHERE assignment_id = ? AND student_id = ? AND deleted_at IS NULL',
            )
            .get(assignmentId, ownerStudentId) as { c: number }
        ).c;
        if (currentCount >= (Number(assignment.max_files) || 10)) {
          const err: any = new Error(`At most ${assignment.max_files} files are allowed`);
          err.status = 409;
          throw err;
        }

        if (!isPrivileged) {
          const used = (
            this.db
              .prepare(
                'SELECT COALESCE(SUM(size), 0) AS s FROM plugin_assignment_files WHERE student_id = ? AND deleted_at IS NULL',
              )
              .get(ownerStudentId) as { s: number }
          ).s;
          if (used + buffer.length > STUDENT_ASSIGNMENT_QUOTA_BYTES) {
            const err: any = new Error('Storage quota exceeded for this student');
            err.status = 413;
            throw err;
          }
        }

        this.db
          .prepare(
            `INSERT INTO plugin_assignment_files
               (id, assignment_id, submission_id, version_id, student_id, original_name, stored_path, size, mime, sha256, uploaded_at)
             VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            fileId,
            assignmentId,
            ownerStudentId,
            fileName,
            path.relative(process.cwd(), storedPath),
            buffer.length,
            contentType || null,
            sha256,
            Date.now(),
          );
      });
      insertTx();
    } catch (dbErr: any) {
      try {
        fs.unlinkSync(storedPath);
      } catch {
        /* best effort */
      }
      throw dbErr;
    }

    return { id: fileId, name: fileName, size: buffer.length, sha256, studentId: ownerStudentId };
  }

  public listAssignmentFiles(assignmentId: string, studentId: string | null, isPrivileged: boolean): any[] {
    const assignmentRow = this.db
      .prepare('SELECT class_id FROM plugin_assignments WHERE id = ?')
      .get(assignmentId) as { class_id: string | null } | undefined;
    this.assertClassMembership(assignmentRow, isPrivileged, studentId);

    const rows = this.db
      .prepare(
        `SELECT id, student_id, original_name, size, mime, sha256, uploaded_at, version_id
           FROM plugin_assignment_files
          WHERE assignment_id = ? AND deleted_at IS NULL
          ORDER BY uploaded_at DESC`,
      )
      .all(assignmentId) as any[];

    return isPrivileged ? rows : rows.filter((r) => r.student_id === studentId);
  }

  public getAssignmentFileDownloadPath(
    assignmentId: string,
    fileId: string,
    studentId: string | null,
    isPrivileged: boolean,
  ): { absPath: string; originalName: string } {
    const file = this.db
      .prepare(
        `SELECT id, student_id, original_name, stored_path, mime, deleted_at
           FROM plugin_assignment_files WHERE id = ? AND assignment_id = ?`,
      )
      .get(fileId, assignmentId) as any;

    if (!file || file.deleted_at) {
      const err: any = new Error('File not found');
      err.status = 404;
      throw err;
    }

    if (!isPrivileged && file.student_id !== studentId) {
      const assigned = this.db
        .prepare(
          `SELECT 1 AS ok FROM plugin_assignment_files f
             JOIN plugin_submission_versions v ON v.id = f.version_id
             JOIN plugin_peer_review_tasks t ON t.submission_id = v.submission_id
            WHERE f.id = ? AND t.reviewer_id = ? LIMIT 1`,
        )
        .get(fileId, studentId) as { ok: number } | undefined;
      if (!assigned) {
        const err: any = new Error('Forbidden: Cannot read another student file');
        err.status = 403;
        throw err;
      }
    }

    const absPath = path.resolve(process.cwd(), file.stored_path);
    if (!isPathInsideRoot(path.join(process.cwd(), 'storage', 'assignments'), absPath) || !fs.existsSync(absPath)) {
      const err: any = new Error('File not found on disk');
      err.status = 404;
      throw err;
    }

    return { absPath, originalName: file.original_name };
  }

  public softDeleteAssignmentFile(
    assignmentId: string,
    fileId: string,
    studentId: string | null,
    isPrivileged: boolean,
  ): void {
    const file = this.db
      .prepare(
        `SELECT id, student_id, version_id, deleted_at FROM plugin_assignment_files
          WHERE id = ? AND assignment_id = ?`,
      )
      .get(fileId, assignmentId) as any;

    if (!file || file.deleted_at) {
      const err: any = new Error('File not found');
      err.status = 404;
      throw err;
    }
    if (!isPrivileged && file.student_id !== studentId) {
      const err: any = new Error('Forbidden: Cannot delete another student file');
      err.status = 403;
      throw err;
    }
    if (file.version_id) {
      const err: any = new Error('File already attached to a submission version');
      err.status = 409;
      throw err;
    }

    this.db.prepare('UPDATE plugin_assignment_files SET deleted_at = ? WHERE id = ?').run(Date.now(), fileId);
  }

  // ── 4. 软删除物理 GC ────────────────────────────────────────────────────

  public gcSoftDeletedAssignmentFiles(retentionMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - retentionMs;
    let rows: Array<{ id: string; stored_path: string }> = [];
    try {
      rows = this.db
        .prepare(
          'SELECT id, stored_path FROM plugin_assignment_files WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 500',
        )
        .all(cutoff) as Array<{ id: string; stored_path: string }>;
    } catch {
      return 0;
    }

    let removed = 0;
    const rootWithSep = path.join(process.cwd(), 'storage', 'assignments') + path.sep;
    for (const row of rows) {
      const absPath = path.resolve(process.cwd(), row.stored_path);
      if (!absPath.startsWith(rootWithSep)) continue;
      try {
        fs.unlinkSync(absPath);
        removed++;
      } catch {
        /* ignore */
      }
    }
    return removed;
  }
}
