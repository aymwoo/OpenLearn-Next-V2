/**
 * 学情诊断与随堂测验/错题分析领域服务 (DiagnosticService / MistakeService)
 *
 * 承载随堂测验判定与原子提交流水、课前错题卡点归集与自适应教学建议、
 * 分层掌握画像（Mastered/Consolidating/NeedSupport）、课堂卓越答题者榜单计算（支持优雅降级回退），
 * 以及结课通票（Exit Ticket）困惑概念分析与破冰心态统计。
 * 独立于 Express HTTP 传输层，可直接注入内存/隔离 SQLite 进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { CLASSROOM_EVENTS, publishClassroomEvent } from '../classroom-events.js';

export interface TopMistakeItem {
  rank: number;
  concept: string;
  mistakeRate: number;
  sampleQuestion: string;
  pedagogicalAdvice: string;
  status: 'high_priority' | 'medium_priority' | 'low_priority';
}

export interface PreClassDiagnosticResult {
  lessonId: string;
  lessonTitle: string;
  prepSummary: {
    totalStudents: number;
    completedCount: number;
    pendingCount: number;
    completionRate: number;
    averageTimeSpentMins: number;
  };
  topMistakes: TopMistakeItem[];
  studentDistribution: {
    tierA_mastered: number;
    tierB_consolidating: number;
    tierC_needSupport: number;
  };
  icebreakerStats: IcebreakerStats;
}

export interface IcebreakerStats {
  fullPower: number;
  needCoffee: number;
  needHelp: number;
}

export interface QuizSubmitParams {
  lessonId: string;
  elementId: string;
  studentId: string;
  studentName?: string | null;
  answer: any;
  timeSpentMs?: number;
}

export interface QuizSubmitResult {
  success: boolean;
  isCorrect: boolean;
  score: number;
  studentId: string;
}

export interface QuizCountItem {
  elementId: string;
  submissionCount: number;
}

export interface QuizDetailSubmission {
  answer: any;
  score: number;
  time: number;
  studentName: string | null;
  isCorrect: boolean;
  timeSpentMs: number;
}

export interface QuizDetailItem {
  elementId: string;
  question: string;
  options: any[];
  correctAnswer: any | null;
  submissions: Record<string, QuizDetailSubmission>;
  submissionCount: number;
}

export interface TopPerformerStudent {
  rank: number;
  studentId: string;
  studentName: string;
  cumulativeScore: number;
  totalQuizzesAnswered: number;
  correctCount: number;
  accuracy: number;
  avgTimeSpentMs: number;
  lastSubmittedAt: number;
}

export interface TopPerformersResult {
  success: boolean;
  lessonId?: string;
  topPerformers: TopPerformerStudent[];
  summary: {
    totalParticipants: number;
    totalResponses: number;
    averageScore: number;
  };
}

export class DiagnosticService {
  private readonly classIcebreakerMap = new Map<string, IcebreakerStats>();

  constructor(
    private readonly db: Database.Database = kernelContainer.db,
    private readonly eventPublisher: typeof publishClassroomEvent = publishClassroomEvent,
  ) {}

  // ── 1. 课前学情诊断与错题卡点归集 (Pre-Class Diagnostic & Top Mistakes) ────────

  /**
   * 获取课前学情诊断综合报表（课前完成度、错题排行、分层掌握、破冰心态）
   */
  public getPreClassDiagnostic(lessonId: string, classId?: string): PreClassDiagnosticResult {
    const lesson = this.db
      .prepare('SELECT id, title, content FROM lessons WHERE id = ?')
      .get(lessonId) as { id: string; title: string; content?: string } | undefined;

    if (!lesson) {
      const err = new Error('Lesson not found') as any;
      err.status = 404;
      throw err;
    }

    // 获取班级总学生数
    let totalStudents = 32;
    if (classId) {
      const countRow = this.db
        .prepare('SELECT COUNT(*) as count FROM class_students WHERE class_id = ?')
        .get(classId) as { count: number } | undefined;
      if (countRow && countRow.count > 0) {
        totalStudents = countRow.count;
      }
    }

    // 查询学生真实预习进度记录
    let completedCount = 0;
    try {
      const progRows = this.db
        .prepare(
          `
        SELECT COUNT(*) as completed
        FROM student_lesson_progress
        WHERE lesson_id = ? AND progress_percent >= 80
      `,
        )
        .get(lessonId) as { completed?: number } | undefined;
      completedCount = Math.min(totalStudents, Number(progRows?.completed) || 0);
    } catch {
      completedCount = 0;
    }

    const completionRate = totalStudents > 0 ? Math.round((completedCount / totalStudents) * 100) : 0;

    // 真实聚合该课节对应的前置答题错题卡点（无错题则返回空数组）
    const topMistakes = this.getLessonMistakes(lessonId);

    // 班级真实破冰心态统计
    const icebreakerStats = this.getIcebreakerStats(classId);

    // 真实分层分布统计
    let tierA_mastered = 0;
    let tierB_consolidating = 0;
    let tierC_needSupport = 0;
    try {
      const tiers = this.db
        .prepare(
          `
        SELECT 
          SUM(CASE WHEN progress_percent >= 90 THEN 1 ELSE 0 END) as tier_a,
          SUM(CASE WHEN progress_percent >= 60 AND progress_percent < 90 THEN 1 ELSE 0 END) as tier_b,
          SUM(CASE WHEN progress_percent < 60 THEN 1 ELSE 0 END) as tier_c
        FROM student_lesson_progress
        WHERE lesson_id = ?
      `,
        )
        .get(lessonId) as { tier_a?: number; tier_b?: number; tier_c?: number } | undefined;
      tierA_mastered = Number(tiers?.tier_a) || 0;
      tierB_consolidating = Number(tiers?.tier_b) || 0;
      tierC_needSupport = Number(tiers?.tier_c) || 0;
    } catch {
      // 容错默认 0
    }

    return {
      lessonId,
      lessonTitle: lesson.title,
      prepSummary: {
        totalStudents,
        completedCount,
        pendingCount: Math.max(0, totalStudents - completedCount),
        completionRate,
        averageTimeSpentMins: completedCount > 0 ? 15 : 0,
      },
      topMistakes,
      studentDistribution: {
        tierA_mastered,
        tierB_consolidating,
        tierC_needSupport,
      },
      icebreakerStats,
    };
  }

  /**
   * 聚合课节答题错题卡点 Top 3
   */
  public getLessonMistakes(lessonId: string): TopMistakeItem[] {
    try {
      const mistakeRows = this.db
        .prepare(
          `
        SELECT 
          s.element_id,
          we.data as element_data,
          COUNT(*) as total_attempts,
          SUM(CASE WHEN s.is_correct = 0 THEN 1 ELSE 0 END) as wrong_count
        FROM lesson_quiz_submissions s
        LEFT JOIN whiteboard_elements we ON s.element_id = we.id AND s.lesson_id = we.lesson_id
        WHERE s.lesson_id = ?
        GROUP BY s.element_id
        HAVING wrong_count > 0
        ORDER BY (wrong_count * 1.0 / total_attempts) DESC
        LIMIT 3
      `,
        )
        .all(lessonId) as Array<{
        element_id: string;
        element_data: string | null;
        total_attempts: number;
        wrong_count: number;
      }>;

      if (!Array.isArray(mistakeRows) || mistakeRows.length === 0) {
        return [];
      }

      return mistakeRows.map((r, idx) => {
        let concept = `难点题 #${idx + 1}`;
        if (r.element_data) {
          try {
            const parsed = JSON.parse(r.element_data);
            if (parsed.question && typeof parsed.question === 'string') {
              concept = parsed.question;
            }
          } catch {
            // fallback
          }
        }

        const mistakeRate = Math.round((r.wrong_count / r.total_attempts) * 100);
        return {
          rank: idx + 1,
          concept,
          mistakeRate,
          sampleQuestion: `前置测验错题（共 ${r.total_attempts} 人作答，${r.wrong_count} 人出错）`,
          pedagogicalAdvice:
            mistakeRate >= 50
              ? '建议课中开篇安排 3-5 分钟微探究直击前置卡点'
              : '建议在讲解对应环节利用白板进行针对性答疑',
          status: mistakeRate >= 50 ? 'high_priority' : mistakeRate >= 30 ? 'medium_priority' : 'low_priority',
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * 记录学生课前破冰心态打卡
   */
  public recordIcebreakerCheckin(classId: string, mood: string): IcebreakerStats {
    const current = this.classIcebreakerMap.get(classId) || { fullPower: 0, needCoffee: 0, needHelp: 0 };
    if (mood === 'fullPower') current.fullPower += 1;
    else if (mood === 'needCoffee') current.needCoffee += 1;
    else if (mood === 'needHelp') current.needHelp += 1;

    this.classIcebreakerMap.set(classId, current);
    return { ...current };
  }

  /**
   * 获取班级破冰心态统计
   */
  public getIcebreakerStats(classId?: string): IcebreakerStats {
    if (!classId) {
      return { fullPower: 0, needCoffee: 0, needHelp: 0 };
    }
    const current = this.classIcebreakerMap.get(classId);
    return current ? { ...current } : { fullPower: 0, needCoffee: 0, needHelp: 0 };
  }

  // ── 2. 随堂测验提交与批改 (Quiz Submissions & Grading Engine) ───────────────────

  /**
   * 提交随堂测验作答并进行原子判分与落库
   */
  public async submitQuiz(params: QuizSubmitParams): Promise<QuizSubmitResult> {
    const { lessonId, elementId, studentId, studentName, answer, timeSpentMs = 0 } = params;

    if (!elementId || answer === undefined) {
      const err = new Error('Missing elementId or answer') as any;
      err.status = 400;
      throw err;
    }

    // 1. 查询白板测验元素以获取题面和正确答案
    const row = this.db
      .prepare('SELECT data FROM whiteboard_elements WHERE id = ? AND lesson_id = ?')
      .get(elementId, lessonId) as { data: string } | undefined;

    if (!row) {
      const err = new Error('Quiz element not found') as any;
      err.status = 404;
      throw err;
    }

    let dataObj: any = {};
    try {
      dataObj = JSON.parse(row.data);
    } catch {
      dataObj = {};
    }

    const correctAnswer = dataObj.correctAnswer;

    // 2. 判定正误与计算得分
    let isCorrect = false;
    let score = 0;
    if (correctAnswer !== undefined && correctAnswer !== null) {
      const normalize = (s: any) => String(s).trim().toLowerCase();
      isCorrect = normalize(answer) === normalize(correctAnswer);
      score = isCorrect ? 100 : 0;
    }

    // 3. 关系型原子 upsert，唯一权威数据源（CONCUR-01）
    this.db
      .prepare(
        `INSERT INTO lesson_quiz_submissions
           (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, time_spent_ms, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE SET
           answer = excluded.answer,
           score = excluded.score,
           is_correct = excluded.is_correct,
           time_spent_ms = excluded.time_spent_ms,
           submitted_at = excluded.submitted_at`,
      )
      .run(
        `lqs-${lessonId}-${elementId}-${studentId}`,
        lessonId,
        elementId,
        studentId,
        studentName || null,
        typeof answer === 'string' ? answer : JSON.stringify(answer),
        score,
        isCorrect ? 1 : 0,
        Number(timeSpentMs) || 0,
        Date.now(),
      );

    // 4. 派发白板测验作答事件
    try {
      await this.eventPublisher(
        CLASSROOM_EVENTS.WHITEBOARD_QUIZ_ANSWERED,
        {
          lessonId,
          elementId,
          studentId,
          studentName: studentName || null,
          answer,
          score,
          isCorrect,
          time: Date.now(),
          correctAnswer: dataObj.correctAnswer || null,
          question: dataObj.question || null,
        },
        { correlationId: lessonId },
      );
    } catch (e: any) {
      console.warn('[DiagnosticService] Failed to publish quiz answered event:', e?.message);
    }

    return {
      success: true,
      isCorrect,
      score,
      studentId,
    };
  }

  /**
   * 获取课节所有测验题目的作答人数统计（轻量安全查询）
   */
  public getQuizCounts(lessonId: string): QuizCountItem[] {
    const rows = this.db
      .prepare('SELECT element_id, COUNT(*) AS n FROM lesson_quiz_submissions WHERE lesson_id = ? GROUP BY element_id')
      .all(lessonId) as Array<{ element_id: string; n: number }>;

    return rows.map((r) => ({
      elementId: r.element_id,
      submissionCount: r.n,
    }));
  }

  /**
   * 获取课节测验题目的详细作答记录（教师/管理员视角，包含答案与逐生详情）
   */
  public getQuizSubmissions(lessonId: string): QuizDetailItem[] {
    const elements = this.db
      .prepare('SELECT id, type, data FROM whiteboard_elements WHERE lesson_id = ? AND type = ?')
      .all(lessonId, 'quiz') as Array<{ id: string; type: string; data: string }>;

    let relationalRows: Array<{
      element_id: string;
      student_id: string;
      student_name: string | null;
      answer: string;
      score: number;
      is_correct: number;
      time_spent_ms: number;
      submitted_at: number;
    }> = [];

    try {
      relationalRows = this.db
        .prepare(
          `SELECT element_id, student_id, student_name, answer, score, is_correct, time_spent_ms, submitted_at
           FROM lesson_quiz_submissions
           WHERE lesson_id = ?`,
        )
        .all(lessonId) as any[];
    } catch {
      // 容错回退
    }

    const relByElement = new Map<string, typeof relationalRows>();
    for (const row of relationalRows) {
      let list = relByElement.get(row.element_id);
      if (!list) {
        list = [];
        relByElement.set(row.element_id, list);
      }
      list.push(row);
    }

    return elements.map((el) => {
      let parsed: any = {};
      try {
        parsed = JSON.parse(el.data);
      } catch {
        parsed = {};
      }

      const submissions: Record<string, QuizDetailSubmission> = { ...(parsed.submissions || {}) };
      const rows = relByElement.get(el.id) || [];
      for (const row of rows) {
        let parsedAnswer: any = row.answer;
        try {
          parsedAnswer = JSON.parse(row.answer);
        } catch {
          // 保持原字符串
        }
        submissions[row.student_id] = {
          answer: parsedAnswer,
          score: row.score,
          time: row.submitted_at,
          studentName: row.student_name,
          isCorrect: row.is_correct === 1,
          timeSpentMs: row.time_spent_ms,
        };
      }

      return {
        elementId: el.id,
        question: parsed.question || '',
        options: parsed.options || [],
        correctAnswer: parsed.correctAnswer || null,
        submissions,
        submissionCount: Object.keys(submissions).length,
      };
    });
  }

  // ── 3. 学情榜单与卓越答题者计算 (Top Performers Engine) ───────────────────────

  /**
   * 查询课节或全局卓越答题者榜单（包含双源摄取与优雅降级）
   */
  public getTopPerformers(lessonId?: string, limit = 5): TopPerformersResult {
    const safeLimit = Math.min(20, Math.max(1, limit));

    if (lessonId) {
      return this.getLessonTopPerformers(lessonId, safeLimit);
    }
    return this.getGlobalTopPerformers(safeLimit);
  }

  private getLessonTopPerformers(lessonId: string, limit: number): TopPerformersResult {
    // 1. 从关系型 lesson_quiz_submissions 表查询当前课节学生的累计得分与作答统计
    let rows: any[] = [];
    try {
      rows = this.db
        .prepare(
          `
        SELECT 
          s.student_id,
          COALESCE(s.student_name, stu.name, s.student_id) as student_name,
          SUM(s.score) as cumulative_score,
          COUNT(s.id) as total_quizzes_answered,
          SUM(s.is_correct) as correct_count,
          ROUND(AVG(s.is_correct) * 100, 1) as accuracy,
          ROUND(AVG(s.time_spent_ms), 0) as avg_time_spent_ms,
          MAX(s.submitted_at) as last_submitted_at
        FROM lesson_quiz_submissions s
        LEFT JOIN students stu ON s.student_id = stu.id
        WHERE s.lesson_id = ?
        GROUP BY s.student_id
        ORDER BY cumulative_score DESC, accuracy DESC, correct_count DESC
        LIMIT ?
      `,
        )
        .all(lessonId, limit) as any[];
    } catch (err: any) {
      console.warn('[DiagnosticService:top-performers] query from lesson_quiz_submissions failed:', err?.message);
    }

    // 2. 如果关系表暂时无作答数据，补充从 whiteboard_elements (type='quiz') 摄取聚合降级
    if (!rows || rows.length === 0) {
      try {
        const quizElements = this.db
          .prepare("SELECT data FROM whiteboard_elements WHERE lesson_id = ? AND type = 'quiz'")
          .all(lessonId) as Array<{ data: string }>;

        if (quizElements.length > 0) {
          const studentMap: Record<
            string,
            {
              studentId: string;
              studentName: string;
              cumulativeScore: number;
              totalQuizzesAnswered: number;
              correctCount: number;
              lastSubmittedAt: number;
            }
          > = {};

          for (const el of quizElements) {
            try {
              const parsed = JSON.parse(el.data || '{}');
              const subs = parsed.submissions || {};
              const correctAnswer = parsed.correctAnswer;
              for (const [stId, subData] of Object.entries(subs) as [string, any][]) {
                if (!studentMap[stId]) {
                  const stRow = this.db.prepare('SELECT name FROM students WHERE id = ?').get(stId) as any;
                  studentMap[stId] = {
                    studentId: stId,
                    studentName: stRow?.name || stId,
                    cumulativeScore: 0,
                    totalQuizzesAnswered: 0,
                    correctCount: 0,
                    lastSubmittedAt: subData.time || Date.now(),
                  };
                }
                const score =
                  typeof subData.score === 'number' ? subData.score : subData.answer === correctAnswer ? 100 : 0;
                studentMap[stId].cumulativeScore += score;
                studentMap[stId].totalQuizzesAnswered += 1;
                if (score > 0) studentMap[stId].correctCount += 1;
                if (subData.time && subData.time > studentMap[stId].lastSubmittedAt) {
                  studentMap[stId].lastSubmittedAt = subData.time;
                }
              }
            } catch {
              // ignore json parse error
            }
          }

          rows = Object.values(studentMap)
            .map((s) => ({
              student_id: s.studentId,
              student_name: s.studentName,
              cumulative_score: s.cumulativeScore,
              total_quizzes_answered: s.totalQuizzesAnswered,
              correct_count: s.correctCount,
              accuracy: s.totalQuizzesAnswered > 0 ? Math.round((s.correctCount / s.totalQuizzesAnswered) * 100) : 0,
              avg_time_spent_ms: 12000,
              last_submitted_at: s.lastSubmittedAt,
            }))
            .sort((a, b) => b.cumulative_score - a.cumulative_score || b.accuracy - a.accuracy)
            .slice(0, limit);
        }
      } catch {
        // ignore fallback errors
      }
    }

    // 3. 统计全班答题总览
    let totalResponses = 0;
    let averageScore = 0;
    try {
      const stats = this.db
        .prepare(
          'SELECT COUNT(*) as count, AVG(score) as avg_score FROM lesson_quiz_submissions WHERE lesson_id = ?',
        )
        .get(lessonId) as any;
      totalResponses = stats?.count || 0;
      averageScore = Math.round(stats?.avg_score || 0);
    } catch {
      // ignore
    }

    return {
      success: true,
      lessonId,
      topPerformers: (rows || []).map((r, index) => ({
        rank: index + 1,
        studentId: r.student_id,
        studentName: r.student_name || `Student ${String(r.student_id).slice(-4)}`,
        cumulativeScore: Number(r.cumulative_score) || 0,
        totalQuizzesAnswered: Number(r.total_quizzes_answered) || 0,
        correctCount: Number(r.correct_count) || 0,
        accuracy: Number(r.accuracy) || 0,
        avgTimeSpentMs: Number(r.avg_time_spent_ms) || 0,
        lastSubmittedAt: Number(r.last_submitted_at) || Date.now(),
      })),
      summary: {
        totalParticipants: rows ? rows.length : 0,
        totalResponses,
        averageScore,
      },
    };
  }

  private getGlobalTopPerformers(limit: number): TopPerformersResult {
    const rows = this.db
      .prepare(
        `
      SELECT 
        s.student_id,
        COALESCE(s.student_name, stu.name, s.student_id) as student_name,
        SUM(s.score) as cumulative_score,
        COUNT(s.id) as total_quizzes_answered,
        SUM(s.is_correct) as correct_count,
        ROUND(AVG(s.is_correct) * 100, 1) as accuracy,
        ROUND(AVG(s.time_spent_ms), 0) as avg_time_spent_ms,
        MAX(s.submitted_at) as last_submitted_at
      FROM lesson_quiz_submissions s
      LEFT JOIN students stu ON s.student_id = stu.id
      GROUP BY s.student_id
      ORDER BY cumulative_score DESC, accuracy DESC, correct_count DESC
      LIMIT ?
    `,
      )
      .all(limit) as any[];

    return {
      success: true,
      topPerformers: (rows || []).map((r, index) => ({
        rank: index + 1,
        studentId: r.student_id,
        studentName: r.student_name || `Student ${String(r.student_id).slice(-4)}`,
        cumulativeScore: Number(r.cumulative_score) || 0,
        totalQuizzesAnswered: Number(r.total_quizzes_answered) || 0,
        correctCount: Number(r.correct_count) || 0,
        accuracy: Number(r.accuracy) || 0,
        avgTimeSpentMs: Number(r.avg_time_spent_ms) || 0,
        lastSubmittedAt: Number(r.last_submitted_at) || Date.now(),
      })),
      summary: {
        totalParticipants: rows.length,
        totalResponses: rows.reduce((acc, cur) => acc + (Number(cur.total_quizzes_answered) || 0), 0),
        averageScore:
          rows.length > 0
            ? Math.round(rows.reduce((acc, cur) => acc + (Number(cur.cumulative_score) || 0), 0) / rows.length)
            : 0,
      },
    };
  }

  /**
   * 模拟生成课堂随堂测验作答（供公开课演练或测试调试）
   */
  public async simulateQuizResponses(
    lessonId: string,
    onSimulated?: (eventPayload: any) => void,
  ): Promise<Array<{ studentId: string; name: string; score: number; isCorrect: boolean }>> {
    const studentsList = this.db.prepare('SELECT id, name FROM students LIMIT 8').all() as Array<{
      id: string;
      name: string;
    }>;

    if (studentsList.length === 0) {
      const err = new Error('No students found in system') as any;
      err.status = 400;
      throw err;
    }

    const dummyElementId = `quiz_sim_${Date.now()}`;
    const questions = [
      'Newton Second Law F=ma',
      'Kinetic Energy Formula 1/2mv^2',
      'Gravitational Constant G',
      'Conservation of Momentum',
    ];
    const chosenQuestion = questions[Math.floor(Math.random() * questions.length)];

    const results: Array<{ studentId: string; name: string; score: number; isCorrect: boolean }> = [];
    for (const st of studentsList) {
      const isCorrect = Math.random() > 0.2;
      const score = isCorrect ? Math.floor(Math.random() * 20 + 80) : Math.floor(Math.random() * 40);
      const timeSpent = Math.floor(Math.random() * 15000 + 4000);
      const subId = `sim-quiz-${lessonId}-${st.id}-${Date.now()}`;

      try {
        this.db
          .prepare(
            `
          INSERT INTO lesson_quiz_submissions
            (id, lesson_id, element_id, student_id, student_name, answer, score, is_correct, time_spent_ms, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE SET
            score = lesson_quiz_submissions.score + excluded.score,
            is_correct = excluded.is_correct,
            time_spent_ms = excluded.time_spent_ms,
            submitted_at = excluded.submitted_at
        `,
          )
          .run(
            subId,
            lessonId,
            dummyElementId,
            st.id,
            st.name,
            'A',
            score,
            isCorrect ? 1 : 0,
            timeSpent,
            Date.now(),
          );
      } catch {
        // ignore conflict errors
      }

      const eventPayload = {
        lessonId,
        elementId: dummyElementId,
        studentId: st.id,
        studentName: st.name,
        answer: 'A',
        score,
        isCorrect,
        time: Date.now(),
        question: chosenQuestion,
      };

      if (onSimulated) {
        onSimulated(eventPayload);
      }

      results.push({ studentId: st.id, name: st.name, score, isCorrect });
    }

    return results;
  }
}

export const diagnosticService = new DiagnosticService();
export { DiagnosticService as MistakeService };
