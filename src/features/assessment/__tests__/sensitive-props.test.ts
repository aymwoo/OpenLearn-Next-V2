// @vitest-environment node
/**
 * 测评敏感字段投影（Q2）。
 *
 * 关键不变量：
 * - L0/L1 槽位即使声明也不注入；
 * - L2 槽位必须「声明 + 槽位允许 + 角色合格」三者同时满足；
 * - 源数据缺失时字段不构造（不用 undefined 占位）。
 */
import { describe, expect, it } from 'vitest';
import { projectAssessmentSensitive } from '../sensitive-props';

function ext(requiresSensitive?: string[]) {
  return { requiresSensitive } as never;
}

describe('projectAssessmentSensitive', () => {
  it('L0 槽位：学生统计扩展声明也不注入', () => {
    const result = projectAssessmentSensitive(ext(['answerKey']), {
      slot: 'assessment.stats.item.addon',
      viewer: 'teacher',
      role: 'teacher',
      source: { answerKey: 'SENTINEL' },
    });
    expect(result).toEqual({ sensitiveAccess: false });
  });

  it('L2 槽位未声明：不注入', () => {
    const result = projectAssessmentSensitive(ext(), {
      slot: 'assessment.grading.answer.addon',
      viewer: 'teacher',
      role: 'teacher',
      source: { answerKey: 'SENTINEL' },
    });
    expect(result).toEqual({ sensitiveAccess: false });
  });

  it('L2 声明 + 授予：按字段注入', () => {
    const result = projectAssessmentSensitive(ext(['answerKey', 'config']), {
      slot: 'assessment.grading.answer.addon',
      viewer: 'teacher',
      role: 'teacher',
      granted: new Set(['answerKey'] as const),
      source: { answerKey: 'SENTINEL', config: { options: [] } },
    });
    expect(result.sensitiveAccess).toBe(true);
    expect(result.sensitive).toEqual({ answerKey: 'SENTINEL' });
  });

  it('槽位不允许的字段被丢弃（editor.item.addon 不接受 studentIdentity）', () => {
    const result = projectAssessmentSensitive(ext(['answerKey', 'studentIdentity']), {
      slot: 'assessment.editor.item.addon',
      viewer: 'teacher',
      role: 'teacher',
      source: { answerKey: 'SENTINEL', studentIdentity: { id: 'stu-1' } },
    });
    expect(result.sensitive).toEqual({ answerKey: 'SENTINEL' });
  });

  it('学生 result.item.addon 可拿本人作答；answerKey 只随 source 提供', () => {
    const result = projectAssessmentSensitive(ext(['answerKey', 'studentAnswer']), {
      slot: 'assessment.result.item.addon',
      viewer: 'student',
      role: 'student',
      source: { studentAnswer: '我的答案' },
    });
    expect(result.sensitiveAccess).toBe(true);
    expect(result.sensitive).toEqual({ studentAnswer: '我的答案' });
  });

  it('学生非 result 槽位一律拒绝', () => {
    const result = projectAssessmentSensitive(ext(['answerKey']), {
      slot: 'assessment.grading.answer.addon',
      viewer: 'student',
      role: 'student',
      source: { answerKey: 'SENTINEL' },
    });
    expect(result).toEqual({ sensitiveAccess: false });
  });

  it('源数据缺失不构造字段', () => {
    const result = projectAssessmentSensitive(ext(['answerKey']), {
      slot: 'assessment.grading.answer.addon',
      viewer: 'teacher',
      role: 'teacher',
      source: {},
    });
    expect(result).toEqual({ sensitiveAccess: false });
  });
});
