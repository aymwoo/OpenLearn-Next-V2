import { describe, it, expect, vi } from 'vitest';
import { SubmissionRegistry, SubmissionAggregator, type GradeWriterPort } from '../registry.js';
import type { SubmissionAdapter, NormalizedSubmission } from '../types.js';

function makeSubmission(overrides: Partial<NormalizedSubmission> = {}): NormalizedSubmission {
  return {
    id: 'ext-xuean:sub-1',
    source: { pluginId: 'ext-xuean', adapterId: 'xuean-adapter', externalId: 'sub-1', modeId: 'xuean' },
    lessonId: 'les-1',
    classId: 'cls-1',
    studentId: 'stu-1',
    studentName: '张三',
    kind: 'artifact',
    status: 'graded',
    submittedAt: 1000,
    score: 85,
    completion: 1,
    ...overrides,
  };
}

function makeAdapter(
  id: string,
  owner: string,
  items: NormalizedSubmission[],
  opts: {
    modeIds?: string[];
    gradeMapping?: boolean;
    fail?: boolean;
  } = {},
): SubmissionAdapter {
  return {
    descriptor: {
      id,
      owner,
      kinds: ['artifact', 'quiz'],
      modeIds: opts.modeIds,
    },
    listSubmissions: opts.fail
      ? () => {
          throw new Error('boom');
        }
      : () => items,
    ...(opts.gradeMapping
      ? {
          toGradeInput: (s: NormalizedSubmission) => ({
            assignmentId: 'asg-1',
            studentId: s.studentId,
            score: s.score ?? null,
            source: 'plugin' as const,
            reason: 'xuean-step',
          }),
        }
      : {}),
  };
}

describe('SubmissionRegistry', () => {
  it('注册/拒绝重复/按 owner 清理', () => {
    const reg = new SubmissionRegistry();
    expect(reg.register(makeAdapter('a', 'ext-x', [])).ok).toBe(true);
    expect(reg.register(makeAdapter('a', 'ext-y', [])).code).toBe('ADAPTER_EXISTS');
    expect(reg.register({ descriptor: { id: '', owner: '', kinds: [] }, listSubmissions: () => [] }).code).toBe(
      'INVALID_ADAPTER',
    );
    reg.register(makeAdapter('b', 'ext-x', []));
    reg.register(makeAdapter('c', 'ext-y', []));
    reg.clearOwner('ext-x');
    expect(reg.list().map((a) => a.descriptor.id)).toEqual(['c']);
  });
});

describe('SubmissionAggregator', () => {
  const gradeWriter: GradeWriterPort = { applyGradeChange: vi.fn(() => ({ ok: true, historyId: 'h1' })) };

  it('聚合多适配器提交并按 id 去重', async () => {
    const reg = new SubmissionRegistry();
    reg.register(makeAdapter('a1', 'ext-x', [makeSubmission()]));
    reg.register(
      makeAdapter('a2', 'ext-y', [makeSubmission(), makeSubmission({ id: 'ext-y:sub-2', studentId: 'stu-2' })]),
    );
    const agg = new SubmissionAggregator(reg, gradeWriter);
    const result = await agg.list({ lessonId: 'les-1' });
    expect(result.submissions).toHaveLength(2); // sub-1 去重
    expect(result.errors).toHaveLength(0);
  });

  it('单适配器失败被隔离，不影响其它来源', async () => {
    const reg = new SubmissionRegistry();
    reg.register(makeAdapter('bad', 'ext-x', [], { fail: true }));
    reg.register(makeAdapter('good', 'ext-y', [makeSubmission()]));
    const agg = new SubmissionAggregator(reg, gradeWriter);
    const result = await agg.list({});
    expect(result.submissions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('boom');
  });

  it('按 modeIds 过滤适配器', async () => {
    const reg = new SubmissionRegistry();
    reg.register(makeAdapter('xuean', 'ext-x', [makeSubmission()], { modeIds: ['xuean'] }));
    reg.register(makeAdapter('moodle', 'ext-y', [makeSubmission({ id: 'moodle:1' })], { modeIds: ['moodle'] }));
    const agg = new SubmissionAggregator(reg, gradeWriter);
    expect((await agg.list({}, 'xuean')).submissions).toHaveLength(1);
    expect((await agg.list({}, 'none')).submissions).toHaveLength(0);
  });

  it('成绩写回走 grade-writer，无映射/找不到提交被拒', async () => {
    const reg = new SubmissionRegistry();
    reg.register(makeAdapter('a1', 'ext-x', [makeSubmission()], { gradeMapping: true }));
    const writer: GradeWriterPort = { applyGradeChange: vi.fn(() => ({ ok: true, historyId: 'h1' })) };
    const agg = new SubmissionAggregator(reg, writer);

    const ok = await agg.writeGrade('a1', 'ext-xuean:sub-1', {});
    expect(ok.ok).toBe(true);
    expect(writer.applyGradeChange).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'stu-1', score: 85, source: 'plugin' }),
    );

    expect((await agg.writeGrade('a1', 'missing', {})).reason).toBe('submission-not-found');
    expect((await agg.writeGrade('nope', 'ext-x:sub-1', {})).reason).toBe('adapter-not-found-or-no-grade-mapping');
  });
});
