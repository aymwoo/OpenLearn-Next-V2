/**
 * 成绩管理领域服务 (GradingService)
 *
 * 承载考勤聚合、加权权重标准化、考试事务管理、学期综合成绩计算引擎、报告归档及 AI 评语生成。
 * 独立于 HTTP 传输层，可直接进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { randomId } from '../utils/id.js';
import { decryptApiKey } from '../utils/crypto.js';
import { fetchWithRetry } from '../../packages/core/ai/utils/fetch-with-retry.js';
import type { StoredAIProvider } from '../context.js';

export interface AttendanceSummaryItem {
  id: string;
  lessonTitle: string;
  date: string;
  present: number;
  late: number;
  absent: number;
  total: number;
  attendanceRate: number;
}

export interface ScheduleAttendanceItem {
  schedule_id: string;
  student_id: string;
  status: string;
  recorded_at: number;
  student_name: string;
}

export interface GradeWeights {
  class_id: string;
  attendance_weight: number;
  progress_weight: number;
  assignment_weight: number;
  exam_weight: number;
}

export interface ExamItem {
  id: string;
  class_id: string;
  title: string;
  description: string;
  max_score: number;
  created_at: number;
}

export interface ExamScoreInput {
  studentId: string;
  score?: number | string | null;
  notes?: string | null;
}

export interface StudentSemesterGrade {
  studentId: string;
  studentName: string;
  studentNumber: string;
  attendanceScore: number;
  progressScore: number;
  assignmentScore: number;
  examScore: number;
  totalScore: number;
  gradeLevel: 'A' | 'B' | 'C' | 'D' | 'E';
  teacherEvaluation: string;
  aiEvaluation: string;
  isArchived: boolean;
}

export interface SemesterGradesResult {
  weights: GradeWeights;
  students: StudentSemesterGrade[];
}

export interface SemesterReportArchiveItem {
  id?: string;
  studentId: string;
  attendanceScore: number;
  progressScore: number;
  assignmentScore: number;
  examScore: number;
  totalScore: number;
  gradeLevel: string;
  teacherEvaluation?: string | null;
  aiEvaluation?: string | null;
  dimensionScores?: any;
}

export class GradingService {
  constructor(private readonly db: Database.Database = kernelContainer.db) {}

  // ── 1. 考勤聚合与记录 ──────────────────────────────────────────────────────────

  public getAttendanceSummary(classId: string, daysWindow = 30): AttendanceSummaryItem[] {
    const schedules = this.db
      .prepare(
        `
      SELECT s.*, COALESCE(l.title, '未设定内容 (上课时自由选择)') as lesson_title
      FROM schedules s
      LEFT JOIN lessons l ON s.lesson_id = l.id
      WHERE s.class_id = ?
    `,
      )
      .all(classId) as any[];

    const summary = schedules.map((sch) => {
      const counts = this.db
        .prepare(
          `
        SELECT 
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
          SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
          COUNT(*) as total
        FROM attendance
        WHERE schedule_id = ?
      `,
        )
        .get(sch.id) as any;

      const total = counts ? counts.total : 0;
      const present = counts ? counts.present : 0;
      const late = counts ? counts.late : 0;
      const absent = counts ? counts.absent : 0;
      const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;

      return {
        id: sch.id,
        lessonTitle: sch.lesson_title,
        date: sch.scheduled_date,
        present,
        late,
        absent,
        total,
        attendanceRate: rate,
      };
    });

    const now = new Date();
    const windowStart = new Date();
    windowStart.setDate(now.getDate() - daysWindow);

    return summary
      .filter((item) => {
        try {
          const itemDate = new Date(item.date);
          return itemDate >= windowStart && itemDate <= now;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  public getScheduleAttendance(scheduleId: string): ScheduleAttendanceItem[] {
    return this.db
      .prepare(
        `
      SELECT a.*, s.name as student_name
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.schedule_id = ?
    `,
      )
      .all(scheduleId) as ScheduleAttendanceItem[];
  }

  public recordAttendance(scheduleId: string, studentId: string, status: string): void {
    this.db
      .prepare(
        `
      INSERT INTO attendance (schedule_id, student_id, status, recorded_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(schedule_id, student_id) DO UPDATE SET status = excluded.status, recorded_at = excluded.recorded_at
    `,
      )
      .run(scheduleId, studentId, status, Date.now());
  }

  // ── 2. 成绩权重标准化与持久化 ──────────────────────────────────────────────────

  public getGradeWeights(classId: string): GradeWeights {
    const row = this.db
      .prepare('SELECT * FROM class_grade_weights WHERE class_id = ?')
      .get(classId) as GradeWeights | undefined;

    if (!row) {
      return {
        class_id: classId,
        attendance_weight: 0.15,
        progress_weight: 0.25,
        assignment_weight: 0.35,
        exam_weight: 0.25,
      };
    }
    return row;
  }

  public saveGradeWeights(
    classId: string,
    weights: {
      attendance_weight: number | string;
      progress_weight: number | string;
      assignment_weight: number | string;
      exam_weight: number | string;
    },
  ): void {
    const total =
      Number(weights.attendance_weight) +
      Number(weights.progress_weight) +
      Number(weights.assignment_weight) +
      Number(weights.exam_weight);

    if (Math.abs(total - 1.0) > 0.001 && Math.abs(total - 100) > 0.1) {
      throw new Error('Weights sum must equal 1.0 or 100%');
    }

    // 统一归一化为 0-1 的浮点比例
    const att = Number(weights.attendance_weight) > 1 ? Number(weights.attendance_weight) / 100 : Number(weights.attendance_weight);
    const prog = Number(weights.progress_weight) > 1 ? Number(weights.progress_weight) / 100 : Number(weights.progress_weight);
    const assign = Number(weights.assignment_weight) > 1 ? Number(weights.assignment_weight) / 100 : Number(weights.assignment_weight);
    const ex = Number(weights.exam_weight) > 1 ? Number(weights.exam_weight) / 100 : Number(weights.exam_weight);

    this.db
      .prepare(
        `
      INSERT INTO class_grade_weights (class_id, attendance_weight, progress_weight, assignment_weight, exam_weight, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(class_id) DO UPDATE SET
        attendance_weight = excluded.attendance_weight,
        progress_weight = excluded.progress_weight,
        assignment_weight = excluded.assignment_weight,
        exam_weight = excluded.exam_weight,
        updated_at = excluded.updated_at
    `,
      )
      .run(classId, att, prog, assign, ex, Date.now());
  }

  // ── 3. 考试管理与成绩录入事务 ──────────────────────────────────────────────────

  public listExams(classId: string): ExamItem[] {
    return this.db
      .prepare('SELECT * FROM exams WHERE class_id = ? ORDER BY created_at DESC')
      .all(classId) as ExamItem[];
  }

  public createExam(classId: string, title: string, description = '', maxScore = 100): string {
    if (!title || !title.trim()) {
      throw new Error('Title is required');
    }
    const examId = randomId('exam-');
    this.db
      .prepare(
        `
      INSERT INTO exams (id, class_id, title, description, max_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(examId, classId, title.trim(), description || '', maxScore || 100, Date.now());

    return examId;
  }

  public getExamScores(examId: string): any[] {
    return this.db.prepare('SELECT * FROM exam_scores WHERE exam_id = ?').all(examId);
  }

  public batchSaveExamScores(examId: string, scores: ExamScoreInput[]): void {
    if (!Array.isArray(scores)) {
      throw new Error('Scores array is required');
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO exam_scores (exam_id, student_id, score, notes, recorded_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(exam_id, student_id) DO UPDATE SET
        score = excluded.score,
        notes = excluded.notes,
        recorded_at = excluded.recorded_at
    `);

    const tx = this.db.transaction((scoresList: ExamScoreInput[]) => {
      const now = Date.now();
      for (const item of scoresList) {
        insertStmt.run(
          examId,
          item.studentId,
          item.score !== undefined && item.score !== null ? Number(item.score) : null,
          item.notes || null,
          now,
        );
      }
    });

    tx(scores);
  }

  // ── 4. 学期综合总评成绩计算引擎 ────────────────────────────────────────────────

  public computeSemesterGrades(
    classId: string,
    semesterName = '2026年春季学期',
  ): SemesterGradesResult {
    // 1. 获取权重
    const weights = this.getGradeWeights(classId);

    // 2. 获取班级全部学生列表
    const students = this.db
      .prepare(
        `
      SELECT s.id, s.name, s.student_number
      FROM students s
      JOIN class_students cs ON s.id = cs.student_id
      WHERE cs.class_id = ?
    `,
      )
      .all(classId) as Array<{ id: string; name: string; student_number: string }>;

    // 3. 批量拉取考勤指标
    const attendanceList = this.db
      .prepare(
        `
      SELECT student_id, status FROM attendance
      WHERE schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)
    `,
      )
      .all(classId) as Array<{ student_id: string; status: string }>;

    // 4. 批量拉取学习进度
    const progressList = this.db
      .prepare(
        `
      SELECT student_id, progress_percent FROM student_lesson_progress
      WHERE lesson_id IN (SELECT DISTINCT lesson_id FROM schedules WHERE class_id = ?)
    `,
      )
      .all(classId) as Array<{ student_id: string; progress_percent: number }>;

    // 5. 批量拉取平时作业得分
    const assignmentSubmissions = this.db
      .prepare(
        `
      SELECT student_id, score FROM assignment_submissions
      WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?) AND status = 'graded' AND score IS NOT NULL
    `,
      )
      .all(classId) as Array<{ student_id: string; score: number | null }>;

    // 6. 批量拉取考试得分
    const examScoresList = this.db
      .prepare(
        `
      SELECT es.student_id, es.score, e.max_score FROM exam_scores es
      JOIN exams e ON es.exam_id = e.id
      WHERE e.class_id = ? AND es.score IS NOT NULL
    `,
      )
      .all(classId) as Array<{ student_id: string; score: number; max_score: number }>;

    // 7. 拉取已归档学期成绩报告（已归档直接复用归档快照）
    const archivedReports = this.db
      .prepare(
        `
      SELECT * FROM student_semester_reports
      WHERE class_id = ? AND semester_name = ?
    `,
      )
      .all(classId, semesterName) as any[];

    const archivedMap = new Map(archivedReports.map((r) => [r.student_id, r]));

    // 8. 内存聚合映射
    const attendanceMap = new Map<string, string[]>();
    for (const a of attendanceList) {
      if (!attendanceMap.has(a.student_id)) attendanceMap.set(a.student_id, []);
      attendanceMap.get(a.student_id)!.push(a.status);
    }

    const progressMap = new Map<string, number[]>();
    for (const p of progressList) {
      if (!progressMap.has(p.student_id)) progressMap.set(p.student_id, []);
      progressMap.get(p.student_id)!.push(p.progress_percent);
    }

    const assignmentMap = new Map<string, number[]>();
    for (const a of assignmentSubmissions) {
      if (!assignmentMap.has(a.student_id)) assignmentMap.set(a.student_id, []);
      assignmentMap.get(a.student_id)!.push(typeof a.score === 'number' ? a.score : 0);
    }

    const examMap = new Map<string, Array<{ score: number; max: number }>>();
    for (const e of examScoresList) {
      if (!examMap.has(e.student_id)) examMap.set(e.student_id, []);
      examMap.get(e.student_id)!.push({ score: e.score, max: e.max_score });
    }

    const totalPublishedAssignments =
      (this.db.prepare('SELECT COUNT(*) as count FROM assignments WHERE class_id = ?').get(classId) as any)?.count || 0;

    const totalPublishedExams =
      (this.db.prepare('SELECT COUNT(*) as count FROM exams WHERE class_id = ?').get(classId) as any)?.count || 0;

    // 9. 计算每个学生的综合总评
    const computedStudents: StudentSemesterGrade[] = students.map((student) => {
      const archived = archivedMap.get(student.id);
      if (archived) {
        return {
          studentId: student.id,
          studentName: student.name,
          studentNumber: student.student_number,
          attendanceScore: archived.attendance_score,
          progressScore: archived.progress_score,
          assignmentScore: archived.assignment_score,
          examScore: archived.exam_score,
          totalScore: archived.total_score,
          gradeLevel: archived.grade_level,
          teacherEvaluation: archived.teacher_evaluation || '',
          aiEvaluation: archived.ai_evaluation || '',
          isArchived: true,
        };
      }

      // 计算考勤分：present/excused 得 100 分，late/leave_early 得 80 分，absent 得 0 分
      const statuses = attendanceMap.get(student.id) || [];
      let attendanceScore = 100;
      if (statuses.length > 0) {
        const sum = statuses.reduce((acc, status) => {
          if (status === 'present' || status === 'excused') return acc + 100;
          if (status === 'late' || status === 'leave_early') return acc + 80;
          return acc;
        }, 0);
        attendanceScore = Math.round(sum / statuses.length);
      }

      // 计算进度分：课节进度的算术均值
      const progressPercents = progressMap.get(student.id) || [];
      let progressScore = 100;
      if (progressPercents.length > 0) {
        progressScore = Math.round(progressPercents.reduce((acc, val) => acc + val, 0) / progressPercents.length);
      }

      // 计算作业分：若班级已发布作业但学生未交则得 0 分，否则为已交作业平均分
      const scores = assignmentMap.get(student.id) || [];
      let assignmentScore = totalPublishedAssignments > 0 ? 0 : 100;
      if (scores.length > 0) {
        assignmentScore = Math.round(scores.reduce((acc, val) => acc + val, 0) / scores.length);
      }

      // 计算考试分：若已发布考试缺考记 0 分，多场考试归一化为百分制后求均值
      const examScores = examMap.get(student.id) || [];
      let examScore = totalPublishedExams > 0 ? 0 : 100;
      if (examScores.length > 0) {
        const sum = examScores.reduce((acc, val) => acc + (val.score / val.max) * 100, 0);
        examScore = Math.round(sum / examScores.length);
      }

      // 加权综合总分
      const totalScore = Math.round(
        attendanceScore * weights.attendance_weight +
          progressScore * weights.progress_weight +
          assignmentScore * weights.assignment_weight +
          examScore * weights.exam_weight,
      );

      // 等级评定
      let gradeLevel: 'A' | 'B' | 'C' | 'D' | 'E' = 'E';
      if (totalScore >= 90) gradeLevel = 'A';
      else if (totalScore >= 80) gradeLevel = 'B';
      else if (totalScore >= 70) gradeLevel = 'C';
      else if (totalScore >= 60) gradeLevel = 'D';

      return {
        studentId: student.id,
        studentName: student.name,
        studentNumber: student.student_number,
        attendanceScore,
        progressScore,
        assignmentScore,
        examScore,
        totalScore,
        gradeLevel,
        teacherEvaluation: '',
        aiEvaluation: '',
        isArchived: false,
      };
    });

    return { weights, students: computedStudents };
  }

  // ── 5. 成绩归档保存事务 ────────────────────────────────────────────────────────

  public archiveSemesterReports(
    classId: string,
    semesterName: string,
    reports: SemesterReportArchiveItem[],
  ): void {
    if (!semesterName) throw new Error('semesterName is required');
    if (!Array.isArray(reports)) throw new Error('reports array is required');

    const insertStmt = this.db.prepare(`
      INSERT INTO student_semester_reports (
        id, student_id, class_id, semester_name,
        attendance_score, progress_score, assignment_score, exam_score,
        total_score, grade_level, teacher_evaluation, ai_evaluation,
        dimension_scores, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, class_id, semester_name) DO UPDATE SET
        attendance_score = excluded.attendance_score,
        progress_score = excluded.progress_score,
        assignment_score = excluded.assignment_score,
        exam_score = excluded.exam_score,
        total_score = excluded.total_score,
        grade_level = excluded.grade_level,
        teacher_evaluation = excluded.teacher_evaluation,
        ai_evaluation = excluded.ai_evaluation,
        dimension_scores = excluded.dimension_scores,
        updated_at = excluded.updated_at
    `);

    const tx = this.db.transaction((reportsList: SemesterReportArchiveItem[]) => {
      const now = Date.now();
      for (const r of reportsList) {
        const reportId = r.id || randomId('rep-');
        insertStmt.run(
          reportId,
          r.studentId,
          classId,
          semesterName,
          r.attendanceScore,
          r.progressScore,
          r.assignmentScore,
          r.examScore,
          r.totalScore,
          r.gradeLevel,
          r.teacherEvaluation || null,
          r.aiEvaluation || null,
          r.dimensionScores ? JSON.stringify(r.dimensionScores) : null,
          now,
          now,
        );
      }
    });

    tx(reports);
  }

  // ── 6. AI 学期综合总评评语生成 ────────────────────────────────────────────────

  public async generateSemesterAiEvaluation(params: {
    classId: string;
    studentId: string;
    semesterName?: string;
    providerId?: string;
  }): Promise<string> {
    const { classId, studentId, semesterName = '2026年春季学期', providerId } = params;

    const student = this.db.prepare('SELECT name FROM students WHERE id = ?').get(studentId) as
      | { name: string }
      | undefined;
    if (!student) {
      throw new Error('Student not found');
    }

    const attendanceStats = this.db
      .prepare(
        `
      SELECT status, COUNT(*) as count FROM attendance
      WHERE student_id = ? AND schedule_id IN (SELECT id FROM schedules WHERE class_id = ?)
      GROUP BY status
    `,
      )
      .all(studentId, classId) as Array<{ status: string; count: number }>;

    const progressObj = this.db
      .prepare(
        `
      SELECT AVG(progress_percent) as avg_progress FROM student_lesson_progress
      WHERE student_id = ? AND lesson_id IN (SELECT DISTINCT lesson_id FROM schedules WHERE class_id = ?)
    `,
      )
      .get(studentId, classId) as { avg_progress: number | null };

    const assignmentGrades = this.db
      .prepare(
        `
      SELECT a.title, s.score, s.feedback FROM assignment_submissions s
      JOIN assignments a ON s.assignment_id = a.id
      WHERE s.student_id = ? AND a.class_id = ? AND s.status = 'graded' AND s.score IS NOT NULL
    `,
      )
      .all(studentId, classId) as Array<{ title: string; score: number; feedback: string }>;

    const examGrades = this.db
      .prepare(
        `
      SELECT e.title, es.score, e.max_score FROM exam_scores es
      JOIN exams e ON es.exam_id = e.id
      WHERE es.student_id = ? AND e.class_id = ? AND es.score IS NOT NULL
    `,
      )
      .all(studentId, classId) as Array<{ title: string; score: number; max_score: number }>;

    const attSummary =
      attendanceStats
        .map(
          (a) =>
            `${a.status === 'present' ? '出勤' : a.status === 'late' ? '迟到' : a.status === 'leave_early' ? '早退' : a.status === 'excused' ? '请假' : '缺勤'}: ${a.count}次`,
        )
        .join(', ') || '暂无出勤记录';
    const avgProg = progressObj.avg_progress !== null ? Math.round(progressObj.avg_progress) : 100;
    const assignmentsText =
      assignmentGrades
        .map((a) => `- 《${a.title}》得分: ${a.score}分 (教师评语: ${a.feedback || '无'})`)
        .join('\n') || '- 暂无平时作业记录';
    const examsText =
      examGrades.map((e) => `- 《${e.title}》得分: ${e.score}/${e.max_score}`).join('\n') || '- 暂无考试成绩记录';

    const prompt = `请扮演一位充满爱心、语气温馨的班主任老师。请结合下面这位学生的学期学习数据和作业表现，为该学生撰写一段【富有鼓励性、温馨、语气亲切】的学期期末总评语。

学生姓名：${student.name}
班级学期：${semesterName}

学期学习数据：
- 考勤统计：${attSummary}
- 平均课程学习进度：${avgProg}%
- 作业得分与历次反馈：
${assignmentsText}
- 考试/测验成绩：
${examsText}

评语撰写要求：
1. 语气必须极其亲切、温馨、富有鼓励性，像长辈或良师益友对孩子的对话，多用鼓励性的句式。
2. 评价要包含三个部分：
   - 肯定其闪光点（如出勤好、某次作业优秀或取得的进步）。
   - 指出其可以改进的地方（如进度落后、考试发挥不佳等），语气要非常温柔、委婉，给予其信心。
   - 对未来的期许，激励学生在下学期继续努力。
3. 长度控制在 150-250 字之间。不要包含任何 Markdown 格式，只返回纯文本评语。`;

    const provider = providerId
      ? (this.db
          .prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE id = ?')
          .get(providerId) as StoredAIProvider | undefined)
      : (this.db
          .prepare(
            "SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1",
          )
          .get() as StoredAIProvider | undefined);

    if (provider?.api_key) provider.api_key = decryptApiKey(provider.api_key);

    if (!provider || !provider.api_key || !provider.api_key.trim()) {
      throw new Error('未检测到可用的 AI 提供商。请前往「系统管理 -> AI 提供商管理」添加并配置大模型服务。');
    }

    let chatUrl = provider.api_url.trim();
    if (!chatUrl.endsWith('/chat/completions')) {
      chatUrl = chatUrl.endsWith('/') ? chatUrl + 'chat/completions' : chatUrl + '/chat/completions';
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.api_key.trim()}`,
    };

    const response = await fetchWithRetry(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: provider.model_name,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1024,
      }),
      timeoutMs: 30_000,
      maxAttempts: 2,
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
}
