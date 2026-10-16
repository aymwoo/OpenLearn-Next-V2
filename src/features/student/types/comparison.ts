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
  submissionRate: number; // 0 - 100
  onTimeRate: number; // 0 - 100
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
