import { useState } from 'react';
import type { ClassType, StudentType } from '../store/appStore';

export interface UseClassBatchOperationsOptions {
  lang: 'zh' | 'en';
  classes: ClassType[];
  expandedClassId: string | null;
  fetchClasses: () => Promise<void>;
  fetchClassStudents: (classId: string) => Promise<void>;
  handleExportAllClassesCombined: (targetClasses?: any[]) => Promise<void>;
}

export function useClassBatchOperations(options: UseClassBatchOperationsOptions) {
  const {
    lang,
    classes,
    expandedClassId,
    fetchClasses,
    fetchClassStudents,
    handleExportAllClassesCombined,
  } = options;

  const [batchMode, setBatchMode] = useState<boolean>(false);
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());

  const [batchPicker, setBatchPicker] = useState<null | 'schedule' | 'lockedLesson' | 'transfer'>(null);
  const [batchPickerLesson, setBatchPickerLesson] = useState<string>('');
  const [batchPickerDate, setBatchPickerDate] = useState<string>('');
  const [batchPickerTargetClass, setBatchPickerTargetClass] = useState<string>('');

  const toggleClassSelection = (id: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllClasses = () => {
    setSelectedClassIds((prev) =>
      prev.size === classes.length && classes.length > 0
        ? new Set()
        : new Set(classes.map((c) => c.id)),
    );
  };

  const toggleStudentSelection = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllStudents = (list: StudentType[]) => {
    setSelectedStudentIds((prev) =>
      prev.size === list.length && list.length > 0
        ? new Set()
        : new Set(list.map((s) => s.id)),
    );
  };

  const handleBatchDeleteClasses = async () => {
    if (selectedClassIds.size === 0) return;
    if (
      !confirm(
        lang === 'zh'
          ? `确认彻底删除选中的 ${selectedClassIds.size} 个班级吗？该操作不可恢复。`
          : `Delete ${selectedClassIds.size} selected classes permanently?`,
      )
    )
      return;
    for (const id of selectedClassIds) {
      await fetch(`/api/classes/${id}`, { method: 'DELETE' });
    }
    setSelectedClassIds(new Set());
    await fetchClasses();
  };

  const handleBatchExportClasses = async () => {
    if (selectedClassIds.size === 0) return;
    await handleExportAllClassesCombined(
      classes.filter((c) => selectedClassIds.has(c.id)),
    );
  };

  const handleBatchSetPasscode = async () => {
    if (selectedClassIds.size === 0) return;
    const val = window.prompt(
      lang === 'zh'
        ? '请输入临时班级密码（留空则清除）:'
        : 'Enter temporary passcode (leave empty to clear):',
    );
    if (val === null) return;
    for (const id of selectedClassIds) {
      await fetch(`/api/classes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ class_passcode: val === '' ? null : val }),
      });
    }
    setSelectedClassIds(new Set());
    await fetchClasses();
  };

  const handleBatchScheduleClasses = () => {
    if (selectedClassIds.size === 0) return;
    setBatchPickerLesson('');
    setBatchPickerDate(new Date().toISOString().split('T')[0]);
    setBatchPicker('schedule');
  };

  const handleBatchDeleteStudents = async () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    if (
      !confirm(
        lang === 'zh'
          ? `确认彻底删除选中的 ${selectedStudentIds.size} 名学生账号吗？将删除其全部关联数据，不可恢复。`
          : `Permanently delete ${selectedStudentIds.size} selected student accounts?`,
      )
    )
      return;
    for (const id of selectedStudentIds) {
      await fetch(`/api/students/${id}`, { method: 'DELETE' });
    }
    setSelectedStudentIds(new Set());
    await fetchClassStudents(expandedClassId);
  };

  const handleBatchResetPassword = async () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    const val = window.prompt(
      lang === 'zh'
        ? '请输入要为选中学生设置的新密码:'
        : 'Enter new password for selected students:',
    );
    if (val === null || val.trim() === '') return;
    for (const id of selectedStudentIds) {
      await fetch(`/api/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: val }),
      });
    }
    setSelectedStudentIds(new Set());
    await fetchClassStudents(expandedClassId);
  };

  const handleBatchTransferStudents = () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    setBatchPickerTargetClass('');
    setBatchPicker('transfer');
  };

  const handleBatchSetLockedLesson = () => {
    if (selectedStudentIds.size === 0 || !expandedClassId) return;
    setBatchPickerLesson('');
    setBatchPicker('lockedLesson');
  };

  const confirmBatchPicker = async () => {
    if (!expandedClassId) return;
    if (batchPicker === 'schedule') {
      if (!batchPickerLesson) {
        alert(lang === 'zh' ? '请选择课程' : 'Please select a lesson');
        return;
      }
      for (const id of selectedClassIds) {
        await fetch(`/api/classes/${id}/schedules`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonId: batchPickerLesson,
            scheduledDate: batchPickerDate + ' 09:00:00',
            status: 'scheduled',
          }),
        });
      }
      setSelectedClassIds(new Set());
    } else if (batchPicker === 'lockedLesson') {
      if (!batchPickerLesson) {
        alert(lang === 'zh' ? '请选择课程' : 'Please select a lesson');
        return;
      }
      for (const id of selectedStudentIds) {
        await fetch(`/api/students/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locked_lesson_id: batchPickerLesson }),
        });
      }
      setSelectedStudentIds(new Set());
    } else if (batchPicker === 'transfer') {
      if (!batchPickerTargetClass || batchPickerTargetClass === expandedClassId) {
        alert(
          lang === 'zh'
            ? '请选择不同的目标班级'
            : 'Please select a different target class',
        );
        return;
      }
      for (const id of selectedStudentIds) {
        await fetch(`/api/classes/${expandedClassId}/students/${id}`, {
          method: 'DELETE',
        });
        await fetch(`/api/classes/${batchPickerTargetClass}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: id }),
        });
      }
      setSelectedStudentIds(new Set());
    }
    setBatchPicker(null);
    if (expandedClassId) await fetchClassStudents(expandedClassId);
  };

  return {
    batchMode,
    setBatchMode,
    selectedClassIds,
    setSelectedClassIds,
    selectedStudentIds,
    setSelectedStudentIds,
    batchPicker,
    setBatchPicker,
    batchPickerLesson,
    setBatchPickerLesson,
    batchPickerDate,
    setBatchPickerDate,
    batchPickerTargetClass,
    setBatchPickerTargetClass,
    toggleClassSelection,
    toggleSelectAllClasses,
    toggleStudentSelection,
    toggleSelectAllStudents,
    handleBatchDeleteClasses,
    handleBatchExportClasses,
    handleBatchSetPasscode,
    handleBatchScheduleClasses,
    handleBatchDeleteStudents,
    handleBatchResetPassword,
    handleBatchTransferStudents,
    handleBatchSetLockedLesson,
    confirmBatchPicker,
  };
}
