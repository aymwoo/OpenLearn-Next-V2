/**
 * 学生跨学年学情对比领域服务 (AcademicYearComparisonService)
 *
 * 承载学生多学年作业提交率、按时提交率、作业均分、课程参与/完成度、科目成绩分布及同比/环比变化计算。
 * 提供插件自定义指标扩展点，独立于 HTTP 传输层，可直接进行无状态单元测试。
 */
import type Database from 'better-sqlite3';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import {
  isValidAcademicYear,
  parseAcademicYearList,
  getDefaultComparisonAcademicYears,
  getCurrentAcademicYear,
} from '../utils/academic-year.js';

export interface CourseScoreItem {
  courseId: string;
  courseTitle: string;
  averageScore: number;
  gradedAssignmentCount: number;
  totalAssignmentCount: number;
}

export interface AcademicYearMetrics {
  academicYear: string;
  hasData: boolean;
  totalAssignments: number;
  submittedAssignments: number;
  onTimeAssignments: number;
  submissionRate: number; // 0 - 100 (百分比)
  onTimeRate: number; // 0 - 100 (百分比)
  averageScore: number; // 0 - 100
  enrolledCoursesCount: number;
  completedCoursesCount: number;
  courseScores: CourseScoreItem[];
  customMetrics?: Record<string, unknown>;
}

export interface MetricDelta {
  diff: number;
  percentageDiff?: number;
  direction: 'up' | 'down' | 'flat';
}

export interface AcademicYearComparisonDelta {
  fromYear: string;
  toYear: string;
  submissionRateDelta: MetricDelta;
  onTimeRateDelta: MetricDelta;
  averageScoreDelta: MetricDelta;
  enrolledCoursesDelta: MetricDelta;
}

export interface AcademicYearComparisonResult {
  studentId: string;
  availableYears: string[];
  selectedYears: string[];
  metricsByYear: AcademicYearMetrics[];
  deltas: AcademicYearComparisonDelta[];
}

export interface CustomMetricContext {
  studentId: string;
  academicYear: string;
  db: Database.Database;
}

export type CustomMetricProvider = (
  ctx: CustomMetricContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

function calculateDelta(curr: number, prev: number): MetricDelta {
  const diff = Math.round((curr - prev) * 10) / 10;
  if (diff > 0) return { diff, direction: 'up' };
  if (diff < 0) return { diff, direction: 'down' };
  return { diff: 0, direction: 'flat' };
}

export class AcademicYearComparisonService {
  private db: Database.Database;
  private customMetricProviders: CustomMetricProvider[] = [];

  constructor(db?: Database.Database) {
    this.db = db || kernelContainer.db;
  }

  /**
   * 注册第三方插件自定义学年指标提供器
   * 返回解除注册的清理函数
   */
  public registerCustomMetricProvider(provider: CustomMetricProvider): () => void {
    this.customMetricProviders.push(provider);
    return () => {
      this.customMetricProviders = this.customMetricProviders.filter((p) => p !== provider);
    };
  }

  /**
   * 查询学生拥有历史数据的所有学年列表，并按升序排列
   */
  public getAvailableAcademicYears(studentId: string): string[] {
    const yearsSet = new Set<string>();

    // 1. 从 schedules 中找
    const scheduleYears = this.db
      .prepare(
        `SELECT DISTINCT s.academic_year
         FROM schedules s
         JOIN class_students cs ON s.class_id = cs.class_id
         WHERE cs.student_id = ? AND s.academic_year IS NOT NULL`,
      )
      .all(studentId) as Array<{ academic_year: string }>;
    scheduleYears.forEach(
      (r) => r.academic_year && isValidAcademicYear(r.academic_year) && yearsSet.add(r.academic_year),
    );

    // 2. 从 assignments 中找
    const assignmentYears = this.db
      .prepare(
        `SELECT DISTINCT a.academic_year
         FROM assignments a
         JOIN class_students cs ON a.class_id = cs.class_id
         WHERE cs.student_id = ? AND a.academic_year IS NOT NULL`,
      )
      .all(studentId) as Array<{ academic_year: string }>;
    assignmentYears.forEach(
      (r) => r.academic_year && isValidAcademicYear(r.academic_year) && yearsSet.add(r.academic_year),
    );

    // 3. 从 student_lesson_progress 中找
    const progressYears = this.db
      .prepare(
        `SELECT DISTINCT academic_year
         FROM student_lesson_progress
         WHERE student_id = ? AND academic_year IS NOT NULL`,
      )
      .all(studentId) as Array<{ academic_year: string }>;
    progressYears.forEach(
      (r) => r.academic_year && isValidAcademicYear(r.academic_year) && yearsSet.add(r.academic_year),
    );

    // 兜底补齐当前与上一学年
    const [prev, curr] = getDefaultComparisonAcademicYears();
    yearsSet.add(prev);
    yearsSet.add(curr);

    return Array.from(yearsSet).sort((a, b) => a.localeCompare(b));
  }

  /**
   * 计算指定学年维度的具体学生学情指标
   */
  public async getMetricsForYear(studentId: string, academicYear: string): Promise<AcademicYearMetrics> {
    if (!isValidAcademicYear(academicYear)) {
      throw new Error(`非法学年格式: ${academicYear}`);
    }

    // 1. 获取该学生所属班级在该学年布置的作业与该学生的提交
    const assignments = this.db
      .prepare(
        `SELECT a.id, a.lesson_id, a.title,
                sub.status as submission_status, sub.score, sub.submitted_at
         FROM assignments a
         JOIN class_students cs ON a.class_id = cs.class_id
         LEFT JOIN assignment_submissions sub ON a.id = sub.assignment_id AND sub.student_id = ?
         WHERE cs.student_id = ? AND a.academic_year = ?`,
      )
      .all(studentId, studentId, academicYear) as Array<{
      id: string;
      lesson_id?: string | null;
      title: string;
      submission_status?: string | null;
      score?: number | null;
      submitted_at?: string | null;
    }>;

    const totalAssignments = assignments.length;
    const submittedRows = assignments.filter((a) => a.submission_status || a.submitted_at);
    const submittedCount = submittedRows.length;
    // 作业提交即视作按时提交
    const onTimeCount = submittedCount;

    const submissionRate = totalAssignments > 0 ? Math.round((submittedCount / totalAssignments) * 1000) / 10 : 0;
    const onTimeRate = submittedCount > 0 ? Math.round((onTimeCount / submittedCount) * 1000) / 10 : 0;

    const scoredRows = assignments.filter((a) => a.score != null && !Number.isNaN(Number(a.score)));
    const averageScore =
      scoredRows.length > 0
        ? Math.round((scoredRows.reduce((acc, cur) => acc + Number(cur.score), 0) / scoredRows.length) * 10) / 10
        : 0;

    // 2. 课程选修数与完成数
    const scheduledLessons = this.db
      .prepare(
        `SELECT DISTINCT s.lesson_id
         FROM schedules s
         JOIN class_students cs ON s.class_id = cs.class_id
         WHERE cs.student_id = ? AND s.academic_year = ? AND s.lesson_id IS NOT NULL`,
      )
      .all(studentId, academicYear) as Array<{ lesson_id: string }>;

    const progressLessons = this.db
      .prepare(
        `SELECT lesson_id, progress_percent,
                COALESCE(completed, 0) as completed
         FROM student_lesson_progress
         WHERE student_id = ? AND academic_year = ?`,
      )
      .all(studentId, academicYear) as Array<{
      lesson_id: string;
      progress_percent?: number | null;
      completed?: number | boolean | null;
    }>;

    const courseIds = new Set<string>();
    scheduledLessons.forEach((row) => courseIds.add(row.lesson_id));
    progressLessons.forEach((row) => courseIds.add(row.lesson_id));
    assignments.forEach((a) => a.lesson_id && courseIds.add(a.lesson_id));

    const enrolledCoursesCount = courseIds.size;
    const completedCoursesCount = progressLessons.filter(
      (p) => (p.progress_percent != null && p.progress_percent >= 100) || p.completed === 1 || p.completed === true,
    ).length;

    // 3. 按课程统计成绩分布
    const courseScoresMap = new Map<
      string,
      { title: string; totalAssignments: number; gradedCount: number; scoreSum: number }
    >();

    for (const a of assignments) {
      if (!a.lesson_id) continue;
      if (!courseScoresMap.has(a.lesson_id)) {
        let lessonTitle = a.title || '未命名课程';
        const lessonRow = this.db.prepare('SELECT title FROM lessons WHERE id = ?').get(a.lesson_id) as
          { title: string } | undefined;
        if (lessonRow?.title) {
          lessonTitle = lessonRow.title;
        }
        courseScoresMap.set(a.lesson_id, {
          title: lessonTitle,
          totalAssignments: 0,
          gradedCount: 0,
          scoreSum: 0,
        });
      }
      const item = courseScoresMap.get(a.lesson_id)!;
      item.totalAssignments++;
      if (a.score != null && !Number.isNaN(Number(a.score))) {
        item.gradedCount++;
        item.scoreSum += Number(a.score);
      }
    }

    const courseScores: CourseScoreItem[] = Array.from(courseScoresMap.entries()).map(([cid, data]) => ({
      courseId: cid,
      courseTitle: data.title,
      totalAssignmentCount: data.totalAssignments,
      gradedAssignmentCount: data.gradedCount,
      averageScore: data.gradedCount > 0 ? Math.round((data.scoreSum / data.gradedCount) * 10) / 10 : 0,
    }));

    const hasData = totalAssignments > 0 || enrolledCoursesCount > 0 || scoredRows.length > 0;

    // 4. 插件扩展指标
    let customMetrics: Record<string, unknown> = {};
    if (this.customMetricProviders.length > 0) {
      const ctx: CustomMetricContext = {
        studentId,
        academicYear,
        db: this.db,
      };
      for (const provider of this.customMetricProviders) {
        try {
          const res = await provider(ctx);
          if (res && typeof res === 'object') {
            customMetrics = { ...customMetrics, ...res };
          }
        } catch (e) {
          // 插件异常安全隔离，避免影响主流程
        }
      }
    }

    return {
      academicYear,
      hasData,
      totalAssignments,
      submittedAssignments: submittedCount,
      onTimeAssignments: onTimeCount,
      submissionRate,
      onTimeRate,
      averageScore,
      enrolledCoursesCount,
      completedCoursesCount,
      courseScores,
      ...(Object.keys(customMetrics).length > 0 ? { customMetrics } : {}),
    };
  }

  /**
   * 获取多学年对比完整视图与同比/环比变化数据
   */
  public async getAcademicYearComparison(
    studentId: string,
    requestedYears?: string[] | string,
  ): Promise<AcademicYearComparisonResult> {
    const availableYears = this.getAvailableAcademicYears(studentId);

    let selectedYears = parseAcademicYearList(requestedYears);
    if (selectedYears.length === 0) {
      // 默认选中最近的两个学年，如果不足两个则选全部可用学年
      if (availableYears.length >= 2) {
        selectedYears = availableYears.slice(-2);
      } else {
        selectedYears = availableYears.length > 0 ? [...availableYears] : getDefaultComparisonAcademicYears();
      }
    }

    // 升序排列保证对比时间线的因果性
    selectedYears.sort((a, b) => a.localeCompare(b));

    const metricsByYear: AcademicYearMetrics[] = [];
    for (const year of selectedYears) {
      const m = await this.getMetricsForYear(studentId, year);
      metricsByYear.push(m);
    }

    // 计算相邻学年的变化差异 (Delta)
    const deltas: AcademicYearComparisonDelta[] = [];
    for (let i = 1; i < metricsByYear.length; i++) {
      const prev = metricsByYear[i - 1];
      const curr = metricsByYear[i];
      deltas.push({
        fromYear: prev.academicYear,
        toYear: curr.academicYear,
        submissionRateDelta: calculateDelta(curr.submissionRate, prev.submissionRate),
        onTimeRateDelta: calculateDelta(curr.onTimeRate, prev.onTimeRate),
        averageScoreDelta: calculateDelta(curr.averageScore, prev.averageScore),
        enrolledCoursesDelta: calculateDelta(curr.enrolledCoursesCount, prev.enrolledCoursesCount),
      });
    }

    return {
      studentId,
      availableYears,
      selectedYears,
      metricsByYear,
      deltas,
    };
  }
}
