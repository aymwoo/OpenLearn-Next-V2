import { describe, it, expect } from 'vitest';
import { toClassRosterSummary, toStudentRosterSummary } from '../rosterProjection';
import type { ClassType, StudentType } from '../../../../types/app';

const fullStudent: StudentType = {
  id: 'stu_1',
  name: '张三',
  student_number: '2026001',
  email: 'zhangsan@example.com',
  password: 'secret-hash',
  gender: 'male',
  avatar: '/uploads/avatars/stu_1.png',
  locked_lesson_id: 'les_1',
  lock_mode: 'full',
  lock_target: '{"tab":"whiteboard"}',
  private_notes: '{"html":"<p>家庭情况敏感记录</p>","category":"SpecialCare"}',
  created_at: 1712000000000,
};

const fullClass: ClassType = {
  id: 'cls_1',
  name: '高一(1)班',
  description: '重点实验班',
  class_passcode: '8848',
  class_passcode_expires_at: 1712999999999,
  created_at: 1712000000000,
  student_count: 42,
  course_count: 6,
  assignment_count: 3,
};

describe('rosterProjection（Issue IKYMS2 白名单投影）', () => {
  it('toStudentRosterSummary 保留花名册可见字段', () => {
    const summary = toStudentRosterSummary(fullStudent);
    expect(summary).toEqual({
      id: 'stu_1',
      name: '张三',
      student_number: '2026001',
      email: 'zhangsan@example.com',
      gender: 'male',
      avatar: '/uploads/avatars/stu_1.png',
      locked_lesson_id: 'les_1',
      created_at: 1712000000000,
    });
  });

  it('toStudentRosterSummary 绝不携带 password / private_notes / lock_mode / lock_target', () => {
    const summary = toStudentRosterSummary(fullStudent) as unknown as Record<string, unknown>;
    expect(summary).not.toHaveProperty('password');
    expect(summary).not.toHaveProperty('private_notes');
    expect(summary).not.toHaveProperty('lock_mode');
    expect(summary).not.toHaveProperty('lock_target');
    expect(JSON.stringify(summary)).not.toContain('secret-hash');
    expect(JSON.stringify(summary)).not.toContain('敏感记录');
  });

  it('toStudentRosterSummary 对可选字段落 null（保持键稳定）', () => {
    const summary = toStudentRosterSummary({
      id: 'stu_2',
      name: '李四',
      email: '',
      created_at: 0,
    });
    expect(summary.gender).toBeNull();
    expect(summary.avatar).toBeNull();
    expect(summary.locked_lesson_id).toBeNull();
  });

  it('toClassRosterSummary 保留统计字段且不携带 class_passcode', () => {
    const summary = toClassRosterSummary(fullClass);
    expect(summary).toEqual({
      id: 'cls_1',
      name: '高一(1)班',
      description: '重点实验班',
      student_count: 42,
      course_count: 6,
      assignment_count: 3,
      created_at: 1712000000000,
    });
    expect(summary).not.toHaveProperty('class_passcode');
    expect(summary).not.toHaveProperty('class_passcode_expires_at');
    expect(JSON.stringify(summary)).not.toContain('8848');
  });
});
