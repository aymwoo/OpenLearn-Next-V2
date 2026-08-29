import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import type { ClassType, StudentType } from '../types/app';

export interface CsvPreviewData {
  headers: string[];
  rows: string[][];
  totalStudents: number;
}

export function escapeCSV(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const stringified = String(val);
  if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return stringified;
}

export interface GeneratePDFReportOptions {
  classId: string;
  className: string;
  students: StudentType[];
  dashData: any;
  lang: 'zh' | 'en';
  addToast: (title: string, msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
  setIsGeneratingPDFReport: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}

export async function generateClassPDFReport(options: GeneratePDFReportOptions) {
  const { classId, className, students, dashData, lang, addToast, setIsGeneratingPDFReport } = options;

  setIsGeneratingPDFReport((prev) => ({ ...prev, [classId]: true }));
  try {
    if (!dashData) {
      addToast(
        lang === 'zh' ? '暂无班级评分数据' : 'No Class Performance Data',
        lang === 'zh'
          ? '请确保在此班级加载了作业与测验。'
          : 'Please check if assignments or quizzes are present for this class.',
        'warning',
      );
      return;
    }

    const performanceData = dashData.performance || [];
    const assignmentsData = dashData.assignments || [];

    // Determine Student Ranking Distributions
    const studentStatsMap: Record<
      string,
      {
        id: string;
        name: string;
        totalGradesSum: number;
        gradedCount: number;
        submittedCount: number;
        totalCount: number;
      }
    > = {};

    students.forEach((st) => {
      studentStatsMap[st.id] = {
        id: st.id,
        name: st.name,
        totalGradesSum: 0,
        gradedCount: 0,
        submittedCount: 0,
        totalCount: 0,
      };
    });

    performanceData.forEach((p: any) => {
      const sId = p.student_id;
      if (studentStatsMap[sId]) {
        studentStatsMap[sId].totalCount++;
        if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
          studentStatsMap[sId].submittedCount++;
        }
        if (p.score !== null && p.score !== undefined) {
          studentStatsMap[sId].totalGradesSum += p.score;
          studentStatsMap[sId].gradedCount++;
        }
      }
    });

    const studentRanks = Object.values(studentStatsMap).map((st) => {
      const avgScore = st.gradedCount > 0 ? st.totalGradesSum / st.gradedCount : 0;
      const submissionRate = st.totalCount > 0 ? (st.submittedCount / st.totalCount) * 100 : 0;
      return {
        ...st,
        avgScore,
        submissionRate,
      };
    });

    // Sort students by average score descending (ranking distribution)
    studentRanks.sort((a, b) => b.avgScore - a.avgScore);

    // Overall class metrics
    let totalClassGradesSum = 0;
    let totalClassGradedCount = 0;
    let totalClassSubmissions = 0;
    let totalClassOpportunities = 0;

    performanceData.forEach((p: any) => {
      totalClassOpportunities++;
      if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
        totalClassSubmissions++;
      }
      if (p.score !== null && p.score !== undefined) {
        totalClassGradesSum += p.score;
        totalClassGradedCount++;
      }
    });

    const classAvgScore =
      totalClassGradedCount > 0 ? totalClassGradesSum / totalClassGradedCount : 0;
    const classSubmissionRate =
      totalClassOpportunities > 0
        ? (totalClassSubmissions / totalClassOpportunities) * 100
        : 0;

    // Assignment Stats Breakdown
    const assignmentStatsMap: Record<
      string,
      {
        id: string;
        title: string;
        scores: number[];
        submittedCount: number;
        totalCount: number;
      }
    > = {};

    assignmentsData.forEach((a: any) => {
      assignmentStatsMap[a.id] = {
        id: a.id,
        title: a.title,
        scores: [],
        submittedCount: 0,
        totalCount: 0,
      };
    });

    performanceData.forEach((p: any) => {
      const aId = p.assignment_id;
      if (assignmentStatsMap[aId]) {
        assignmentStatsMap[aId].totalCount++;
        if (p.submission_status === 'submitted' || p.submission_status === 'graded') {
          assignmentStatsMap[aId].submittedCount++;
        }
        if (p.score !== null && p.score !== undefined) {
          assignmentStatsMap[aId].scores.push(p.score);
        }
      }
    });

    const assignmentStats = Object.values(assignmentStatsMap).map((ast) => {
      const count = ast.scores.length;
      const sumVal = ast.scores.reduce((s, v) => s + v, 0);
      const avgVal = count > 0 ? sumVal / count : 0;
      const maxVal = count > 0 ? Math.max(...ast.scores) : 0;
      const minVal = count > 0 ? Math.min(...ast.scores) : 0;
      const subRateVal =
        ast.totalCount > 0 ? (ast.submittedCount / ast.totalCount) * 100 : 0;
      return {
        ...ast,
        avg: avgVal,
        max: maxVal,
        min: minVal,
        subRate: subRateVal,
      };
    });

    // Initialize jsPDF Doc
    const doc = new jsPDF({
      orientation: 'p',
      unit: 'mm',
      format: 'a4',
    });

    // Colors definition (Executive palette)
    const primaryColor = [15, 23, 42]; // Slate 900
    const accentColor = [79, 70, 229]; // Indigo 600
    const textColor = [51, 65, 85]; // Slate 700
    const borderLineColor = [226, 232, 240]; // Slate 200

    const drawDivider = (yPos: number) => {
      doc.setDrawColor(borderLineColor[0], borderLineColor[1], borderLineColor[2]);
      doc.setLineWidth(0.3);
      doc.line(14, yPos, 196, yPos);
    };

    // PAGE 1: Header/Branding Area
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 42, 'F'); // Dark primary banner

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text('CLASS PERFORMANCE REPORT', 14, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(194, 205, 225); // Slate 300
    doc.text(`Academic Insights • Generative Report Summary`, 14, 25);
    doc.text(
      `Classroom: ${className} | Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      14,
      32,
    );

    // Logo-box
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(172, 10, 24, 24, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text('OS', 180, 26);

    let currentY = 52;

    // Executive Metrics Grid
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('I. EXECUTIVE OVERVIEW', 14, currentY);
    currentY += 6;

    const summaryRows = [
      ['Classroom/Subject Name', className],
      ['Total Enrolled Students', `${students.length} student(s)`],
      ['Curriculum Items (Assignments/Quizzes)', `${assignmentsData.length} items`],
      ['Global Assignment Submission Rate', `${classSubmissionRate.toFixed(1)}%`],
      ['Class Average Performance Score', `${classAvgScore.toFixed(1)}%`],
    ];

    (doc as any).autoTable({
      startY: currentY,
      head: [['Metric Indicator', 'Class-wide Metric Value']],
      body: summaryRows,
      theme: 'striped',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
      },
      bodyStyles: {
        textColor: textColor,
        fontSize: 8.5,
      },
      margin: { left: 14, right: 14 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;

    // Ranking Distribution Table
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('II. STUDENT RANKING DISTRIBUTION', 14, currentY);
    currentY += 6;

    const rankingRows = studentRanks.map((sr, index) => {
      let tier = 'Excellent';
      if (sr.avgScore >= 90) tier = 'Excellent (A)';
      else if (sr.avgScore >= 75) tier = 'Good (B)';
      else if (sr.avgScore >= 60) tier = 'Satisfactory (C)';
      else tier = 'Needs Improvement (D)';

      return [
        `${index + 1}`,
        sr.name,
        `${sr.submittedCount}/${sr.totalCount} (${sr.submissionRate.toFixed(0)}%)`,
        `${sr.avgScore.toFixed(1)}%`,
        tier,
      ];
    });

    (doc as any).autoTable({
      startY: currentY,
      head: [
        [
          'Rank',
          'Student Name',
          'Completion Rate',
          'Average Score',
          'Academic Standing Tier',
        ],
      ],
      body: rankingRows,
      theme: 'grid',
      headStyles: {
        fillColor: accentColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: {
        textColor: textColor,
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252], // light grey slate
      },
      columnStyles: {
        0: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
        1: { fontStyle: 'bold' },
        2: { halign: 'center' },
        3: { halign: 'center', fontStyle: 'bold' },
      },
      margin: { left: 14, right: 14 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 12;

    // Check for page overflow
    if (currentY > 210) {
      doc.addPage();
      currentY = 20;
    }

    // Assignment Stats Table
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('III. ASSIGNMENT PERFORMANCE METRICS', 14, currentY);
    currentY += 6;

    const assignmentRows = assignmentStats.map((ast) => {
      return [
        ast.title,
        `${ast.subRate.toFixed(0)}%`,
        `${ast.avg.toFixed(1)}%`,
        `${ast.min.toFixed(0)}% - ${ast.max.toFixed(0)}%`,
      ];
    });

    (doc as any).autoTable({
      startY: currentY,
      head: [
        ['Assignment/Quiz Title', 'Submission Rate', 'Average Grade', 'Range (Min - Max)'],
      ],
      body:
        assignmentRows.length > 0
          ? assignmentRows
          : [['No assignment performance records found.', '-', '-', '-']],
      theme: 'striped',
      headStyles: {
        fillColor: [100, 116, 139], // Slate 500
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      bodyStyles: {
        textColor: textColor,
        fontSize: 8,
      },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'center', fontStyle: 'bold' },
        3: { halign: 'center' },
      },
      margin: { left: 14, right: 14 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 15;

    // Footer with timestamp & signature box
    drawDivider(275);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184); // Slate 400
    doc.text(
      'Generated by OpenLearn Next • Educational Operating System',
      14,
      282,
    );
    doc.text(`Page 1 of 1 • Internal Educational Audit`, 196, 282, {
      align: 'right',
    });

    // Output File
    const cleanClassName = className.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateStr = new Date().toISOString().split('T')[0];
    doc.save(`Class_Report_${cleanClassName}_${dateStr}.pdf`);

    addToast(
      lang === 'zh' ? '📄 PDF 报告导出完成' : '📄 PDF Report Generated',
      lang === 'zh'
        ? `班级【${className}】的综合学情 PDF 报告已生成并下载。`
        : `Class performance report for ${className} saved to your device.`,
      'success',
    );
  } catch (error: any) {
    console.error('PDF Generation Failed:', error);
    addToast(
      lang === 'zh' ? '❌ PDF 报告生成失败' : '❌ PDF Report Failed',
      error.message || 'Error occurred during PDF generation',
      'warning',
    );
  } finally {
    setIsGeneratingPDFReport((prev) => ({ ...prev, [classId]: false }));
  }
}

export function exportClassGradesCSV(options: {
  className: string;
  students: StudentType[];
  dashData: any;
  qWeight?: number;
  aWeight?: number;
  overrides?: Record<string, 'quiz' | 'assignment'>;
}) {
  const {
    className,
    students,
    dashData,
    qWeight = 40,
    aWeight = 60,
    overrides = {},
  } = options;

  if (!dashData || !dashData.assignments) {
    alert(
      'No performance data available to export. Please open the dashboard to load class data first.',
    );
    return;
  }

  if (students.length === 0) {
    alert('No students in this class to export grades for.');
    return;
  }

  const assignments = dashData.assignments || [];
  const performance = dashData.performance || [];

  // Classify assignments
  const classifiedAssignments = assignments.map((a: any) => {
    let category: 'quiz' | 'assignment' = 'assignment';
    if (overrides[a.id]) {
      category = overrides[a.id];
    } else {
      const isMcq =
        a.content &&
        a.content.startsWith('{"quizType":"mcq_learning_objectives"');
      const hasQuizInTitle =
        a.title &&
        (a.title.toLowerCase().includes('quiz') ||
          a.title.toLowerCase().includes('test') ||
          a.title.includes('测验') ||
          a.title.includes('测试'));
      category = isMcq || hasQuizInTitle ? 'quiz' : 'assignment';
    }
    return { ...a, category };
  });

  const headerRow: string[] = ['Student Name', 'Student Email'];
  classifiedAssignments.forEach((a: any) => {
    const catLabel = a.category === 'quiz' ? 'Quiz' : 'Assignment';
    headerRow.push(`${catLabel}: ${a.title}`);
  });

  headerRow.push(
    'Quizzes Average',
    'Assignments Average',
    `Weighted Average (${qWeight}% Quizzes, ${aWeight}% Assignments)`,
    'Simple Average Score',
    'Submitted Count',
    'Total Items',
  );

  const csvRows: string[][] = [headerRow];

  students.forEach((st: any) => {
    const studentRow: string[] = [st.name, st.email];

    let quizScoreSum = 0;
    let quizGradedCount = 0;

    let assignmentScoreSum = 0;
    let assignmentGradedCount = 0;

    let totalScoreSum = 0;
    let totalGradedCount = 0;
    let submittedCount = 0;

    classifiedAssignments.forEach((a: any) => {
      const perf = performance.find(
        (p: any) =>
          p.assignment_id === a.id &&
          p.student_id === st.id,
      );
      if (perf && perf.score !== null && perf.score !== undefined) {
        studentRow.push(`${perf.score}%`);
        const scoreVal = Number(perf.score);

        if (a.category === 'quiz') {
          quizScoreSum += scoreVal;
          quizGradedCount++;
        } else {
          assignmentScoreSum += scoreVal;
          assignmentGradedCount++;
        }

        totalScoreSum += scoreVal;
        totalGradedCount++;
        submittedCount++;
      } else if (perf && perf.submission_status === 'submitted') {
        studentRow.push('Pending Grade');
        submittedCount++;
      } else {
        studentRow.push('Not Submitted');
      }
    });

    const quizAvg =
      quizGradedCount > 0 ? Math.round(quizScoreSum / quizGradedCount) : null;
    const assignmentAvg =
      assignmentGradedCount > 0
        ? Math.round(assignmentScoreSum / assignmentGradedCount)
        : null;

    let weightedAvgStr = 'N/A';
    if (quizAvg !== null && assignmentAvg !== null) {
      const weighted =
        quizAvg * (qWeight / 100) + assignmentAvg * (aWeight / 100);
      weightedAvgStr = `${Math.round(weighted)}%`;
    } else if (quizAvg !== null) {
      weightedAvgStr = `${quizAvg}%`;
    } else if (assignmentAvg !== null) {
      weightedAvgStr = `${assignmentAvg}%`;
    }

    const quizAvgStr = quizAvg !== null ? `${quizAvg}%` : 'N/A';
    const assignmentAvgStr = assignmentAvg !== null ? `${assignmentAvg}%` : 'N/A';
    const simpleAvgStr =
      totalGradedCount > 0
        ? `${Math.round(totalScoreSum / totalGradedCount)}%`
        : 'N/A';

    studentRow.push(
      quizAvgStr,
      assignmentAvgStr,
      weightedAvgStr,
      simpleAvgStr,
      `${submittedCount}`,
      `${assignments.length}`,
    );

    csvRows.push(studentRow.map(escapeCSV));
  });

  const csvContent = csvRows.map((row) => row.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const cleanClassName = className.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${cleanClassName}_grades_report_${dateStr}.csv`;

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function computeCsvPreviewData(options: {
  exportClassId: string;
  classStudentsMap: Record<string, StudentType[]>;
  classDashboardMap: Record<string, any>;
  quizzesWeight: number;
  assignmentsWeight: number;
  customCategoryOverrides: Record<string, 'quiz' | 'assignment'>;
  lang: 'zh' | 'en';
}): CsvPreviewData | null {
  const {
    exportClassId,
    classStudentsMap,
    classDashboardMap,
    quizzesWeight,
    assignmentsWeight,
    customCategoryOverrides,
    lang,
  } = options;

  if (!exportClassId) return null;
  const cStudents = classStudentsMap[exportClassId] || [];
  const dashData = classDashboardMap[exportClassId];
  if (!dashData || !dashData.assignments || cStudents.length === 0) {
    return null;
  }

  const assignments = dashData.assignments || [];
  const performance = dashData.performance || [];

  const classifiedAssignments = assignments.map((a: any) => {
    let category: 'quiz' | 'assignment' = 'assignment';
    if (customCategoryOverrides[a.id]) {
      category = customCategoryOverrides[a.id];
    } else {
      const isMcq =
        a.content &&
        a.content.startsWith('{"quizType":"mcq_learning_objectives"');
      const hasQuizInTitle =
        a.title &&
        (a.title.toLowerCase().includes('quiz') ||
          a.title.toLowerCase().includes('test') ||
          a.title.includes('测验') ||
          a.title.includes('测试'));
      category = isMcq || hasQuizInTitle ? 'quiz' : 'assignment';
    }
    return { ...a, category };
  });

  const headers: string[] = ['Student Name', 'Student Email'];
  classifiedAssignments.forEach((a: any) => {
    const catLabel = a.category === 'quiz' ? 'Quiz' : 'Assignment';
    headers.push(`${catLabel}: ${a.title}`);
  });

  headers.push(
    'Quizzes Average',
    'Assignments Average',
    `Weighted Average (${quizzesWeight}% Quizzes, ${assignmentsWeight}% Assignments)`,
    'Simple Average Score',
    'Submitted Count',
    'Total Items',
  );

  const rows: string[][] = [];
  const previewStudents = cStudents.slice(0, 5);

  previewStudents.forEach((st: any) => {
    const studentRow: string[] = [st.name, st.email];

    let quizScoreSum = 0;
    let quizGradedCount = 0;
    let assignmentScoreSum = 0;
    let assignmentGradedCount = 0;
    let totalScoreSum = 0;
    let totalGradedCount = 0;
    let submittedCount = 0;

    classifiedAssignments.forEach((a: any) => {
      const perf = performance.find(
        (p: any) =>
          p.assignment_id === a.id &&
          p.student_id === st.id,
      );
      if (perf && perf.score !== null && perf.score !== undefined) {
        studentRow.push(`${perf.score}%`);
        const scoreVal = Number(perf.score);

        if (a.category === 'quiz') {
          quizScoreSum += scoreVal;
          quizGradedCount++;
        } else {
          assignmentScoreSum += scoreVal;
          assignmentGradedCount++;
        }

        totalScoreSum += scoreVal;
        totalGradedCount++;
        submittedCount++;
      } else if (perf && perf.submission_status === 'submitted') {
        studentRow.push(lang === 'zh' ? '待评分' : 'Pending Grade');
        submittedCount++;
      } else {
        studentRow.push(lang === 'zh' ? '未提交' : 'Not Submitted');
      }
    });

    const quizAvg =
      quizGradedCount > 0 ? Math.round(quizScoreSum / quizGradedCount) : null;
    const assignmentAvg =
      assignmentGradedCount > 0
        ? Math.round(assignmentScoreSum / assignmentGradedCount)
        : null;

    let weightedAvgStr = 'N/A';
    if (quizAvg !== null && assignmentAvg !== null) {
      const weighted =
        quizAvg * (quizzesWeight / 100) +
        assignmentAvg * (assignmentsWeight / 100);
      weightedAvgStr = `${Math.round(weighted)}%`;
    } else if (quizAvg !== null) {
      weightedAvgStr = `${quizAvg}%`;
    } else if (assignmentAvg !== null) {
      weightedAvgStr = `${assignmentAvg}%`;
    }

    const quizAvgStr = quizAvg !== null ? `${quizAvg}%` : 'N/A';
    const assignmentAvgStr =
      assignmentAvg !== null ? `${assignmentAvg}%` : 'N/A';
    const simpleAvgStr =
      totalGradedCount > 0
        ? `${Math.round(totalScoreSum / totalGradedCount)}%`
        : 'N/A';

    studentRow.push(
      quizAvgStr,
      assignmentAvgStr,
      weightedAvgStr,
      simpleAvgStr,
      `${submittedCount}`,
      `${assignments.length}`,
    );

    rows.push(studentRow);
  });

  return { headers, rows, totalStudents: cStudents.length };
}

export function exportAllClassesCombinedCSV(options: {
  classes: ClassType[];
  classStudentsMap: Record<string, StudentType[]>;
  classDashboardMap: Record<string, any>;
  lang: 'zh' | 'en';
}) {
  const { classes, classStudentsMap, classDashboardMap, lang } = options;

  const headerRow = [
    'Class Name',
    'Student Name',
    'Student Email',
    'Quizzes Average',
    'Assignments Average',
    'Calculated Weighted Score (40% Quiz / 60% Assignment)',
    'Simple Average Score',
    'Submitted Count',
    'Total Items',
  ];

  const csvRows: string[][] = [headerRow];

  classes.forEach((cls) => {
    const cStudents = classStudentsMap[cls.id] || [];
    const dashData = classDashboardMap[cls.id];
    if (!dashData || !dashData.assignments || cStudents.length === 0) return;

    const assignments = dashData.assignments || [];

    const classifiedAssignments = assignments.map((a: any) => {
      const isMcq =
        a.content &&
        a.content.startsWith('{"quizType":"mcq_learning_objectives"');
      const hasQuizInTitle =
        a.title &&
        (a.title.toLowerCase().includes('quiz') ||
          a.title.toLowerCase().includes('test') ||
          a.title.includes('测验') ||
          a.title.includes('测试'));
      const category = isMcq || hasQuizInTitle ? 'quiz' : 'assignment';
      return { ...a, category };
    });

    cStudents.forEach((st: any) => {
      let quizScoreSum = 0;
      let quizCount = 0;
      let assignmentScoreSum = 0;
      let assignmentCount = 0;
      let overallSum = 0;
      let gradedCount = 0;

      classifiedAssignments.forEach((a: any) => {
        const scoreObj = dashData.performance?.find(
          (p: any) =>
            p.student_id === st.id &&
            p.assignment_id === a.id &&
            p.submission_status === 'graded' &&
            p.score !== null,
        );
        if (scoreObj) {
          const scoreVal = Number(scoreObj.score);
          overallSum += scoreVal;
          gradedCount++;
          if (a.category === 'quiz') {
            quizScoreSum += scoreVal;
            quizCount++;
          } else {
            assignmentScoreSum += scoreVal;
            assignmentCount++;
          }
        }
      });

      const qAvg =
        quizCount > 0 ? Math.round(quizScoreSum / quizCount) : null;
      const aAvg =
        assignmentCount > 0 ? Math.round(assignmentScoreSum / assignmentCount) : null;

      let weightedScore = 0;
      if (qAvg !== null && aAvg !== null) {
        weightedScore = Math.round(qAvg * 0.4 + aAvg * 0.6);
      } else if (qAvg !== null) {
        weightedScore = Math.round(qAvg);
      } else if (aAvg !== null) {
        weightedScore = Math.round(aAvg);
      }
      const simpleAvg =
        gradedCount > 0 ? Math.round(overallSum / gradedCount) : 0;

      const studentRow = [
        cls.name,
        st.name,
        st.email,
        qAvg !== null ? `${qAvg}%` : 'N/A',
        aAvg !== null ? `${aAvg}%` : 'N/A',
        `${weightedScore}%`,
        `${simpleAvg}%`,
        `${gradedCount}`,
        `${assignments.length}`,
      ];

      csvRows.push(studentRow);
    });
  });

  if (csvRows.length <= 1) {
    alert(
      lang === 'zh'
        ? '暂无可导出的成绩数据。请确保班级中有已评分的作业。'
        : 'No graded performance data available to export.',
    );
    return;
  }

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' +
    csvRows.map((e) => e.map(escapeCSV).join(',')).join('\n');

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute(
    'download',
    `All_Classes_Combined_Grades_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
