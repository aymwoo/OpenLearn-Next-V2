import type { ShowcaseWork } from '../peer-review/types';
import type { DiffStudentWork } from './types';

interface AttemptLike {
  id?: string;
  student_id?: string;
  student_name?: string;
  courseware_title?: string;
  title?: string;
  status?: string;
  score?: number | null;
  max_score?: number | null;
  time_spent_sec?: number;
  submission_raw?: unknown;
  submitted_at?: string;
}

interface StudentLike {
  id: string;
  name?: string;
  student_number?: string;
  seat_number?: string;
  seatNumber?: string;
}

function extractAttemptContent(attempt: AttemptLike): { content: string; isCode: boolean } {
  const raw = attempt.submission_raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return extractFromParsed(parsed, raw);
    } catch {
      return { content: raw, isCode: /function |const |def |import |=>|\{[\s\S]*\}/.test(raw) };
    }
  }
  if (raw && typeof raw === 'object') {
    return extractFromParsed(raw as Record<string, unknown>, '');
  }
  const scorePart =
    typeof attempt.score === 'number'
      ? `得分: ${attempt.score}${typeof attempt.max_score === 'number' ? `/${attempt.max_score}` : ''}`
      : '已提交作答';
  return {
    content: `${attempt.courseware_title || attempt.title || '课堂练习'}\n状态: ${attempt.status || 'submitted'}\n${scorePart}`,
    isCode: false,
  };
}

function extractFromParsed(obj: Record<string, unknown>, fallback: string): { content: string; isCode: boolean } {
  const code = obj?.code ?? obj?.sourceCode ?? obj?.program ?? obj?.script;
  if (typeof code === 'string' && code.trim()) {
    return { content: code, isCode: true };
  }
  const text = obj?.answer ?? obj?.text ?? obj?.content ?? obj?.summary ?? obj?.response;
  if (typeof text === 'string' && text.trim()) {
    return { content: text, isCode: false };
  }
  const serialized = fallback || JSON.stringify(obj, null, 2);
  return { content: serialized.slice(0, 1600), isCode: false };
}

/**
 * 将课堂真实作品（showcaseWorks）与交互课件实时作答记录（attempts）合并转换为
 * ShowcaseDiffModal 可展示的 DiffStudentWork[]；无任何真实提交时诚实返回 []。
 */
export function buildShowcaseDiffCandidateWorks(
  showcaseWorks: ShowcaseWork[],
  attempts: AttemptLike[],
  students: StudentLike[],
): DiffStudentWork[] {
  const byStudent = new Map<string, DiffStudentWork>();
  const studentMap = new Map(students.map((s) => [s.id, s]));

  for (const w of showcaseWorks) {
    const stu = studentMap.get(w.studentId);
    const content = w.codeSnippet || w.textContent || w.summary || w.title;
    if (!content) continue;
    byStudent.set(w.studentId, {
      studentId: w.studentId,
      studentName: w.studentName || stu?.name || stu?.student_number || w.studentId,
      studentNumber: stu?.student_number,
      seatNumber: stu?.seat_number || stu?.seatNumber,
      source: w.codeSnippet ? 'code' : w.source === 'assignment' ? 'quiz_answer' : 'screen_snapshot',
      title: w.title || w.sourceLabel || '课堂提交作品',
      content,
      tags: [w.sourceLabel].filter(Boolean),
      durationSec: 0,
      category:
        typeof w.score === 'number'
          ? w.score >= 85
            ? 'exemplary'
            : w.score < 60
              ? 'typical_error'
              : 'alternative'
          : 'exemplary',
      accuracyScore: typeof w.score === 'number' ? Math.round(w.score) : undefined,
      submittedAt: w.submittedAt
        ? new Date(w.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : undefined,
    });
  }

  for (const a of attempts) {
    const sid = a.student_id;
    if (!sid || byStudent.has(sid)) continue;
    const stu = studentMap.get(sid);
    const { content, isCode } = extractAttemptContent(a);
    const score = typeof a.score === 'number' ? Math.round(a.score) : undefined;
    byStudent.set(sid, {
      studentId: sid,
      studentName: a.student_name || stu?.name || stu?.student_number || sid,
      studentNumber: stu?.student_number,
      seatNumber: stu?.seat_number || stu?.seatNumber,
      source: isCode ? 'code' : 'quiz_answer',
      title: a.courseware_title || a.title || '课堂实时作答',
      content,
      tags: [a.status === 'submitted' || a.status === 'completed' ? '已提交' : '作答中'],
      durationSec: Number(a.time_spent_sec) || 0,
      category:
        typeof score === 'number'
          ? score >= 85
            ? 'exemplary'
            : score < 60
              ? 'typical_error'
              : 'alternative'
          : 'alternative',
      accuracyScore: score,
      submittedAt: a.submitted_at
        ? new Date(a.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : undefined,
    });
  }

  return Array.from(byStudent.values());
}
