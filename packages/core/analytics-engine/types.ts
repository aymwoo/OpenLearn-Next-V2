/**
 * OpenLearn Learning Analytics Engine - Strict TypeScript Type Definitions
 * No `any` types permitted. Uses Interfaces, Generics, and Readonly types throughout.
 */

export interface EventActor {
  readonly id: string;
  readonly role: string;
}

export interface EventTarget {
  readonly id: string;
  readonly type: string;
}

export interface NormalizedAnalyticsEvent<T = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: number;
  readonly actor: EventActor;
  readonly target?: EventTarget;
  readonly lessonId?: string;
  readonly stageId?: string;
  readonly activityId?: string;
  readonly metadata: T;
}

export interface RawAnalyticsMetrics {
  readonly onlineCount: number;
  readonly activeCount: number;
  readonly participationRate: number; // 0 - 100%
  readonly totalInteractions: number;
  readonly quizAnswerRate: number; // 0 - 100%
  readonly quizAccuracyRate: number; // 0 - 100%
  readonly averageTimeSeconds: number;
  readonly completionRate: number; // 0 - 100%
  readonly codeExecutionCount: number;
  readonly whiteboardEditCount: number;
  readonly aiInvocationCount: number;
  readonly timestamp: number;
}

export interface HighLevelIndicators {
  readonly participationIndex: number; // 0 - 100
  readonly focusIndex: number; // 0 - 100
  readonly paceIndex: number; // 0 - 100
  readonly collaborationIndex: number; // 0 - 100
  readonly thinkingActivityIndex: number; // 0 - 100
  readonly knowledgeMasteryIndex: number; // 0 - 100
  readonly teacherPatrolIndex: number; // 0 - 100
  readonly aiAssistanceIndex: number; // 0 - 100
  readonly timestamp: number;
}

// ── Domain Analytics Models ────────────────────────────────────────────────

export interface StudentTrajectoryPoint {
  readonly timestamp: number;
  readonly stageId: string;
  readonly actionType: string;
  readonly score?: number;
}

export interface StudentAnalyticsModel {
  readonly studentId: string;
  readonly learningTrajectory: ReadonlyArray<StudentTrajectoryPoint>;
  readonly totalQuizSubmits: number;
  readonly correctQuizSubmits: number;
  readonly totalCodeExecutions: number;
  readonly totalWhiteboardEdits: number;
}

export interface GroupAnalyticsModel {
  readonly groupId: string;
  readonly activityLevel: number;
  readonly collaborationEfficiency: number;
  readonly memberContribution: Readonly<Record<string, number>>;
  readonly completionRate: number;
}

export interface LessonAnalyticsModel {
  readonly lessonId: string;
  readonly stageDurationMap: Readonly<Record<string, number>>;
  readonly paceRatio: number;
  readonly peakInteractionTimestamp: number;
  readonly knowledgeCoverageRate: number;
}

export interface WhiteboardAnalyticsModel {
  readonly objectCount: number;
  readonly editHeatmaps: ReadonlyArray<{ readonly x: number; readonly y: number; readonly intensity: number }>;
  readonly focusRegions: ReadonlyArray<string>;
  readonly presentationDurationSeconds: number;
  readonly annotationFrequency: number;
}

export interface CodeAnalyticsModel {
  readonly runCount: number;
  readonly errorRate: number;
  readonly debugCount: number;
  readonly completionRate: number;
}

export interface QuizAnalyticsModel {
  readonly accuracyRate: number;
  readonly knowledgeMasteryMap: Readonly<Record<string, number>>;
  readonly averageTimeSeconds: number;
  readonly optionDistribution: Readonly<Record<string, number>>;
}

export interface AIAnalyticsModel {
  readonly callCount: number;
  readonly generatedContentCount: number;
  readonly teacherAdoptionRate: number;
  readonly studentUsageRate: number;
  readonly averageResponseTimeMs: number;
}

// ── Insight Engine Models ──────────────────────────────────────────────────

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface AnalyticsInsight {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: InsightSeverity;
  readonly category: 'interaction' | 'completion' | 'duration' | 'mastery' | 'pace';
  readonly recommendation?: string;
  readonly timestamp: number;
}

// ── Prediction Interface ───────────────────────────────────────────────────

export interface PredictionResult {
  readonly targetStudentId?: string;
  readonly predictedCompletionRate: number;
  readonly riskLevel: 'low' | 'medium' | 'high';
  readonly predictedPaceRatio: number;
  readonly timestamp: number;
}

export interface IPredictionProvider {
  predictLearningOutcome(studentId: string): Promise<PredictionResult>;
  predictClassroomPace(lessonId: string): Promise<Record<string, unknown>>;
}

// ── Privacy & SDK Extensions ───────────────────────────────────────────────

export interface AnalyticsPrivacyConfig {
  readonly anonymousAnalysis: boolean;
  readonly dataMasking: boolean;
  readonly retentionPeriodDays: number;
}

export interface CustomMetricDefinition {
  readonly name: string;
  readonly description: string;
  readonly computeFn: (events: ReadonlyArray<NormalizedAnalyticsEvent>) => number;
}

export interface CustomIndicatorDefinition {
  readonly name: string;
  readonly description: string;
  readonly computeFn: (metrics: RawAnalyticsMetrics) => number;
}

export interface CustomInsightRule {
  readonly id: string;
  readonly evaluateFn: (
    metrics: RawAnalyticsMetrics,
    indicators: HighLevelIndicators
  ) => AnalyticsInsight | null;
}
