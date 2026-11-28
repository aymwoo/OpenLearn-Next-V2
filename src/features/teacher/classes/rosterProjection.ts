/**
 * 班级/学生白名单投影助手（Issue IKYMS2）。
 *
 * 班级学生管理域的扩展槽位（class.batch.action / student.row.action /
 * student.enroll.source / class.list.toolbar.action）向插件传递实体时，
 * 一律先经这里的投影函数裁剪：`StudentType.password` / `private_notes`
 * （教师私密备忘）与 `ClassType.class_passcode` 属敏感字段，绝不进入
 * 插件可见的 slotProps（与测评域 SlotProps 白名单基线一致）。
 */

import type { ClassRosterSummary, StudentRosterSummary } from '../../../plugin-host/types';
import type { ClassType, StudentType } from '../../../types/app';

/** 从完整 StudentType 裁剪出插件可见的花名册摘要。 */
export function toStudentRosterSummary(st: StudentType): StudentRosterSummary {
  return {
    id: st.id,
    name: st.name,
    student_number: st.student_number,
    email: st.email,
    gender: st.gender ?? null,
    avatar: st.avatar ?? null,
    locked_lesson_id: st.locked_lesson_id ?? null,
    created_at: st.created_at,
  };
}

/** 从完整 ClassType 裁剪出插件可见的班级摘要。 */
export function toClassRosterSummary(cls: ClassType): ClassRosterSummary {
  return {
    id: cls.id,
    name: cls.name,
    description: cls.description,
    student_count: cls.student_count,
    course_count: cls.course_count,
    assignment_count: cls.assignment_count,
    created_at: cls.created_at,
  };
}
