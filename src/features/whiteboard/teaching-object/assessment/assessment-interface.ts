import type { AssessmentResult } from '../types.js';

export class AssessmentInterface {
  private resultsMap = new Map<string, AssessmentResult[]>();

  public submit(result: AssessmentResult): void {
    const arr = this.resultsMap.get(result.objectId) || [];
    arr.push(result);
    this.resultsMap.set(result.objectId, arr);
  }

  public score(objectId: string, studentId: string, score: number, maxScore: number, feedback?: string): AssessmentResult {
    const result: AssessmentResult = {
      objectId,
      studentId,
      score,
      maxScore,
      feedback,
      submittedAt: Date.now(),
      isPassed: score >= maxScore * 0.6,
    };
    this.submit(result);
    return result;
  }

  public review(objectId: string, studentId: string, feedback: string): AssessmentResult | undefined {
    const results = this.resultsMap.get(objectId) || [];
    const target = results.find((r) => r.studentId === studentId);
    if (target) {
      target.feedback = feedback;
    }
    return target;
  }

  public getResults(objectId: string): AssessmentResult[] {
    return this.resultsMap.get(objectId) || [];
  }
}

export const assessmentInterface = new AssessmentInterface();
