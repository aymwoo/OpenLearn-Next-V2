import React, { useState, useMemo, useCallback } from 'react';
import type { StudentType, ClassType } from '../store/appStore';
import {
  generateClassPDFReport,
  exportClassGradesCSV,
  exportAllClassesCombinedCSV,
  computeCsvPreviewData,
} from '../services/gradeReportService';

export interface UseGradeExportOptions {
  lang: 'zh' | 'en';
  classes: ClassType[];
  classStudentsMap: Record<string, StudentType[]>;
  classDashboardMap: Record<string, any>;
  fetchClassStudents: (classId: string) => Promise<void> | void;
  fetchClassDashboard: (classId: string) => Promise<void> | void;
  fetchClassProgress: (classId: string) => Promise<void> | void;
  addToast?: (title: string, message: string, type?: any) => void;
}

export function useGradeExport(options: UseGradeExportOptions) {
  const {
    lang,
    classes,
    classStudentsMap,
    classDashboardMap,
    fetchClassStudents,
    fetchClassDashboard,
    fetchClassProgress,
    addToast = () => {},
  } = options;

  const [isExportWeightModalOpen, setIsExportWeightModalOpen] = useState(false);
  const [exportClassId, setExportClassId] = useState<string>('');
  const [exportClassName, setExportClassName] = useState<string>('');
  const [quizzesWeight, setQuizzesWeight] = useState<number>(40);
  const [assignmentsWeight, setAssignmentsWeight] = useState<number>(60);
  const [customCategoryOverrides, setCustomCategoryOverrides] = useState<Record<string, 'quiz' | 'assignment'>>({});
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [exportTooltipOpen, setExportTooltipOpen] = useState(false);
  const [loadingExportClassId, setLoadingExportClassId] = useState<string | null>(null);
  const [isExportingAllCombined, setIsExportingAllCombined] = useState(false);
  const [isGeneratingPDFReport, setIsGeneratingPDFReport] = useState<Record<string, boolean>>({});

  const handleQuizzesWeightChange = useCallback((val: number) => {
    const qWeight = Math.min(100, Math.max(0, val));
    setQuizzesWeight(qWeight);
    setAssignmentsWeight(100 - qWeight);
  }, []);

  const handleAssignmentsWeightChange = useCallback((val: number) => {
    const aWeight = Math.min(100, Math.max(0, val));
    setAssignmentsWeight(aWeight);
    setQuizzesWeight(100 - aWeight);
  }, []);

  const csvPreviewData = useMemo(() => {
    return computeCsvPreviewData({
      exportClassId,
      classStudentsMap,
      classDashboardMap,
      quizzesWeight,
      assignmentsWeight,
      customCategoryOverrides,
      lang,
    });
  }, [
    exportClassId,
    quizzesWeight,
    assignmentsWeight,
    customCategoryOverrides,
    classStudentsMap,
    classDashboardMap,
    lang,
  ]);

  const triggerExportForClass = useCallback(
    async (classId: string, className: string) => {
      setLoadingExportClassId(classId);
      try {
        await fetchClassStudents(classId);
        await fetchClassDashboard(classId);
        await fetchClassProgress(classId);

        setExportClassId(classId);
        setExportClassName(className);
        setQuizzesWeight(40);
        setAssignmentsWeight(60);
        setCustomCategoryOverrides({});
        setIsExportWeightModalOpen(true);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingExportClassId(null);
        setExportDropdownOpen(false);
      }
    },
    [fetchClassStudents, fetchClassDashboard, fetchClassProgress],
  );

  const handleExportGrades = useCallback(
    (
      classId: string,
      className: string,
      qWeight: number = 40,
      aWeight: number = 60,
      overrides: Record<string, 'quiz' | 'assignment'> = {},
    ) => {
      exportClassGradesCSV({
        className,
        students: classStudentsMap[classId] || [],
        dashData: classDashboardMap[classId],
        qWeight,
        aWeight,
        overrides,
      });
    },
    [classStudentsMap, classDashboardMap],
  );

  const handleGeneratePDFReport = useCallback(
    async (classId: string, className: string) => {
      await fetchClassStudents(classId);
      await fetchClassDashboard(classId);
      await fetchClassProgress(classId);
      await generateClassPDFReport({
        classId,
        className,
        students: classStudentsMap[classId] || [],
        dashData: classDashboardMap[classId],
        lang,
        addToast,
        setIsGeneratingPDFReport,
      });
    },
    [classStudentsMap, classDashboardMap, lang, addToast, fetchClassStudents, fetchClassDashboard, fetchClassProgress],
  );

  const handleExportAllClassesCombined = useCallback(async () => {
    setIsExportingAllCombined(true);
    try {
      await exportAllClassesCombinedCSV({
        classes,
        classStudentsMap,
        classDashboardMap,
        fetchClassStudents,
        fetchClassDashboard,
        fetchClassProgress,
      });
    } catch (e) {
      console.error('Export all classes error:', e);
    } finally {
      setIsExportingAllCombined(false);
      setExportDropdownOpen(false);
    }
  }, [classes, classStudentsMap, classDashboardMap, fetchClassStudents, fetchClassDashboard, fetchClassProgress]);

  const get30DayAverageWarning = useCallback(
    (studentId: string, classId: string) => {
      const dashData = classDashboardMap[classId];
      if (!dashData || !dashData.performance) return null;

      const thirtyDaysAgo = Date.now() - 2592000000;
      const studentPerf = dashData.performance.filter((p: any) => p.student_id === studentId);

      const recentSubmissions = studentPerf.filter(
        (p: any) =>
          p.submitted_at &&
          p.submitted_at >= thirtyDaysAgo &&
          p.score !== null &&
          p.score !== undefined,
      );

      if (recentSubmissions.length === 0) return null;

      const scoreSum = recentSubmissions.reduce((sum: number, p: any) => sum + Number(p.score), 0);
      const avg = scoreSum / recentSubmissions.length;
      if (avg < 60) {
        return Math.round(avg);
      }
      return null;
    },
    [classDashboardMap],
  );

  return {
    isExportWeightModalOpen,
    setIsExportWeightModalOpen,
    exportClassId,
    setExportClassId,
    exportClassName,
    setExportClassName,
    quizzesWeight,
    setQuizzesWeight,
    assignmentsWeight,
    setAssignmentsWeight,
    customCategoryOverrides,
    setCustomCategoryOverrides,
    exportDropdownOpen,
    setExportDropdownOpen,
    exportTooltipOpen,
    setExportTooltipOpen,
    loadingExportClassId,
    setLoadingExportClassId,
    isExportingAllCombined,
    setIsExportingAllCombined,
    isGeneratingPDFReport,
    setIsGeneratingPDFReport,
    handleQuizzesWeightChange,
    handleAssignmentsWeightChange,
    csvPreviewData,
    triggerExportForClass,
    handleExportGrades,
    handleGeneratePDFReport,
    handleExportAllClassesCombined,
    get30DayAverageWarning,
  };
}
