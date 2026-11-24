#!/usr/bin/env tsx
/**
 * report-duplicate-grades.ts — 历史重复成绩项只读体检（pnpm db:report-duplicate-grades）。
 *
 * 背景：同一底层成绩项历史上可能被写成多条 assignment（课件改名后的旧壳、
 * 学案活动重复补壳）。学期总评 / 学年对比 / 选人分层 / 课后报告已在读取侧
 * 按 `resolveGradeItemKey` 去重，但库里仍保留着这些冗余行。
 *
 * 本脚本**只读**，不修改任何数据：按「班级 + 成绩项键」分组作业壳，
 * 再按「学生 + 成绩项键」列出会被忽略的提交行与分数差异，
 * 用于人工判断是否需要进一步清理。默认输出可读报告，`--json` 输出结构化结果。
 *
 * 用法：
 *   pnpm db:report-duplicate-grades
 *   pnpm db:report-duplicate-grades -- --json
 *   OPENLEARN_DB_PATH=/path/to/educational_os.db pnpm db:report-duplicate-grades
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { resolveGradeItemKey } from '../packages/core/di/grade-item-key.js';

interface AssignmentRow {
  id: string;
  class_id: string | null;
  lesson_id: string | null;
  title: string | null;
  content: string | null;
  created_at: number | null;
  academic_year: string | null;
}

interface SubmissionRow {
  assignment_id: string;
  student_id: string;
  score: number | null;
  graded_at: number | null;
  submitted_at: number | null;
}

export interface DuplicateGradeStudent {
  studentId: string;
  kept: { assignmentId: string; score: number | null; at: number };
  ignored: Array<{ assignmentId: string; score: number | null; at: number; sameScore: boolean }>;
}

export interface DuplicateGradeGroup {
  key: string;
  kind: 'xuean' | 'courseware' | 'assignment';
  classId: string;
  lessonId: string | null;
  assignments: Array<{ id: string; title: string | null; createdAt: number | null; academicYear: string | null }>;
  students: DuplicateGradeStudent[];
  redundantAssignments: number;
  redundantSubmissions: number;
}

export interface DuplicateGradeReport {
  generatedAt: string;
  groups: DuplicateGradeGroup[];
  totals: {
    groups: number;
    redundantAssignments: number;
    affectedStudents: number;
    redundantSubmissions: number;
    scoreConflicts: number;
  };
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function kindOf(key: string): DuplicateGradeGroup['kind'] {
  if (key.startsWith('xuean:')) return 'xuean';
  if (key.startsWith('courseware:')) return 'courseware';
  return 'assignment';
}

/**
 * 生成只读体检报告：不写库，可安全对生产库副本执行。
 */
export function buildDuplicateGradeReport(db: Database.Database): DuplicateGradeReport {
  const assignments = db
    .prepare(
      `SELECT id, class_id, lesson_id, title, content, created_at, academic_year
         FROM assignments`,
    )
    .all() as AssignmentRow[];

  const submissions = db
    .prepare(
      `SELECT assignment_id, student_id, score, graded_at, submitted_at
         FROM assignment_submissions`,
    )
    .all() as SubmissionRow[];

  const submissionsByAssignment = new Map<string, SubmissionRow[]>();
  for (const row of submissions) {
    const list = submissionsByAssignment.get(row.assignment_id);
    if (list) list.push(row);
    else submissionsByAssignment.set(row.assignment_id, [row]);
  }

  // 按「班级 + 成绩项键」分组：成绩项键已包含课件所需的班级/课节维度。
  const groups = new Map<string, AssignmentRow[]>();
  for (const row of assignments) {
    const classId = row.class_id ?? '';
    const key = resolveGradeItemKey({
      id: row.id,
      classId: row.class_id,
      lessonId: row.lesson_id,
      content: row.content,
    });
    const groupKey = `${classId}\u0000${key}`;
    const list = groups.get(groupKey);
    if (list) list.push(row);
    else groups.set(groupKey, [row]);
  }

  const result: DuplicateGradeGroup[] = [];
  for (const [groupKey, rows] of groups) {
    if (rows.length <= 1) continue;
    const [classId, key] = groupKey.split('\u0000');
    const assignmentIds = new Set(rows.map((r) => r.id));

    // 同一学生在同一成绩项下可能有多条提交：保留最新一条（时间相同取较高分），
    // 其余即「会被读取侧去重逻辑忽略」的行。
    const byStudent = new Map<string, SubmissionRow[]>();
    for (const row of submissions) {
      if (!assignmentIds.has(row.assignment_id)) continue;
      const list = byStudent.get(row.student_id);
      if (list) list.push(row);
      else byStudent.set(row.student_id, [row]);
    }

    const students: DuplicateGradeStudent[] = [];
    let redundantSubmissions = 0;
    for (const [studentId, list] of byStudent) {
      if (list.length <= 1) continue;
      const sorted = [...list].sort((a, b) => {
        const atDiff = toNumber(b.graded_at ?? b.submitted_at) - toNumber(a.graded_at ?? a.submitted_at);
        if (atDiff !== 0) return atDiff;
        return toNumber(b.score) - toNumber(a.score);
      });
      const kept = sorted[0];
      const ignored = sorted.slice(1).map((row) => ({
        assignmentId: row.assignment_id,
        score: row.score,
        at: toNumber(row.graded_at ?? row.submitted_at),
        sameScore: row.score === kept.score,
      }));
      redundantSubmissions += ignored.length;
      students.push({
        studentId,
        kept: {
          assignmentId: kept.assignment_id,
          score: kept.score,
          at: toNumber(kept.graded_at ?? kept.submitted_at),
        },
        ignored,
      });
    }

    students.sort((a, b) => a.studentId.localeCompare(b.studentId));
    result.push({
      key,
      kind: kindOf(key),
      classId,
      lessonId: rows[0]?.lesson_id ?? null,
      assignments: rows
        .slice()
        .sort((a, b) => toNumber(a.created_at) - toNumber(b.created_at))
        .map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: row.created_at,
          academicYear: row.academic_year,
        })),
      students,
      redundantAssignments: rows.length - 1,
      redundantSubmissions,
    });
  }

  result.sort(
    (a, b) =>
      b.redundantAssignments - a.redundantAssignments ||
      b.students.length - a.students.length ||
      a.key.localeCompare(b.key),
  );

  const totals = result.reduce(
    (acc, group) => {
      acc.groups += 1;
      acc.redundantAssignments += group.redundantAssignments;
      acc.affectedStudents += group.students.length;
      acc.redundantSubmissions += group.redundantSubmissions;
      acc.scoreConflicts += group.students.reduce(
        (n, student) => n + student.ignored.filter((row) => !row.sameScore).length,
        0,
      );
      return acc;
    },
    { groups: 0, redundantAssignments: 0, affectedStudents: 0, redundantSubmissions: 0, scoreConflicts: 0 },
  );

  return { generatedAt: new Date().toISOString(), groups: result, totals };
}

function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().slice(0, 19).replace('T', ' ');
}

function printReport(report: DuplicateGradeReport, dbPath: string): void {
  const t = report.totals;
  console.log(`[duplicate-grades] DB: ${dbPath}`);
  console.log(`[duplicate-grades] 只读体检，不修改任何数据。生成时间：${report.generatedAt}`);
  if (t.groups === 0) {
    console.log('[duplicate-grades] 未发现重复成绩项。');
    return;
  }
  console.log(
    `[duplicate-grades] 发现 ${t.groups} 组重复成绩项：冗余作业壳 ${t.redundantAssignments} 条，` +
      `涉及学生 ${t.affectedStudents} 人，冗余提交 ${t.redundantSubmissions} 条，分数不一致 ${t.scoreConflicts} 处。`,
  );

  report.groups.forEach((group, index) => {
    console.log('');
    console.log(`${index + 1}) ${group.key}  [${group.kind}]`);
    console.log(`   班级: ${group.classId || '—'}   课节: ${group.lessonId || '—'}`);
    group.assignments.forEach((asg, i) => {
      console.log(
        `   ${i === 0 ? '保留' : '冗余'}: ${asg.id}  ${JSON.stringify(asg.title ?? '')}  ` +
          `created=${formatTime(asg.createdAt)}  year=${asg.academicYear ?? '—'}`,
      );
    });
    if (group.students.length === 0) {
      console.log('   提交: 无（仅作业壳重复，未产生重复提交）');
      return;
    }
    for (const student of group.students) {
      const ignored = student.ignored
        .map(
          (row) => `${row.assignmentId}=${row.score ?? '—'}分@${formatTime(row.at)}${row.sameScore ? '' : '（分差）'}`,
        )
        .join('，');
      console.log(
        `   学生 ${student.studentId}: 保留 ${student.kept.assignmentId}=${student.kept.score ?? '—'}分` +
          `@${formatTime(student.kept.at)}；忽略 ${ignored}`,
      );
    }
  });
  console.log('');
  console.log('[duplicate-grades] 提示：本脚本只出报告；如需清理，请先备份数据库并逐组人工确认。');
}

function resolveDbPath(explicit?: string): string {
  return path.resolve(
    explicit || process.env.OPENLEARN_DB_PATH || path.join('packages', 'core', 'db', 'educational_os.db'),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const explicit = args.find((arg) => !arg.startsWith('--'));
  const dbPath = resolveDbPath(explicit);

  if (!fs.existsSync(dbPath)) {
    console.error(`[duplicate-grades] 找不到数据库文件：${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const report = buildDuplicateGradeReport(db);
    if (json) console.log(JSON.stringify({ dbPath, ...report }, null, 2));
    else printReport(report, dbPath);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
