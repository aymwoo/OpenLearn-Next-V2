/**
 * OpenLearn AI Classroom Context - Provider Registry (Sprint P5-01)
 * Manages official and plugin AI Context Providers and builds read-only snapshots.
 */

import { IAIContextProvider, AIClassroomContextSnapshot } from './ai-context-types.js';

export class AIContextProviderRegistry {
  private providers = new Map<string, IAIContextProvider>();

  public registerProvider(provider: IAIContextProvider): void {
    if (!provider || !provider.id) {
      throw new Error('AIContextProviderRegistry Error: IAIContextProvider must have a valid ID.');
    }
    this.providers.set(provider.id, provider);
  }

  public unregisterProvider(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  public getProvider(providerId: string): IAIContextProvider | undefined {
    return this.providers.get(providerId);
  }

  public listProviders(): ReadonlyArray<IAIContextProvider> {
    return Object.freeze(Array.from(this.providers.values()));
  }

  public buildSnapshot(classroomCtx?: any): AIClassroomContextSnapshot {
    const rawClassroomId = classroomCtx?.classroomId ?? 'cls_default_ai';
    const extensionData: Record<string, unknown> = {};

    let lesson = { lessonId: 'les_01', title: 'Default Lesson', stage: 'Teaching' };
    let teacher = { teacherId: 'tch_01', name: 'Dr. Smith', status: 'Active' };
    let students = [{ studentId: 'stu_01', name: 'Alice', online: true }];
    let groups = [{ groupId: 'grp_01', name: 'Group A', studentIds: ['stu_01'] }];
    let resources = [{ resourceId: 'res_01', title: 'Algebra PDF', type: 'PDF' }];
    let whiteboard = { elementCount: 5, activeTool: 'tool_pen' };
    let activities = { activeQuizId: 'quiz_01', activityType: 'Quiz' };
    let workspace = { activeRegions: ['CenterWorkspace', 'RightSidebar'], visibleWidgets: ['widget_whiteboard'] };
    let analyticsSummary = { totalInteractions: 42, averageEngagementScore: 92.5 };
    let plugins = { activePluginIds: ['ext-homework-hub'] };
    let permissions = { allowedCapabilities: ['capability_chat', 'capability_completion'] };

    for (const provider of this.providers.values()) {
      try {
        const provided = provider.provideContext(classroomCtx);
        if (provided) {
          if (provided.lesson) lesson = { ...lesson, ...provided.lesson };
          if (provided.teacher) teacher = { ...teacher, ...provided.teacher };
          if (provided.students) students = provided.students as any;
          if (provided.groups) groups = provided.groups as any;
          if (provided.resources) resources = provided.resources as any;
          if (provided.whiteboard) whiteboard = { ...whiteboard, ...provided.whiteboard };
          if (provided.activities) activities = { ...activities, ...provided.activities };
          if (provided.workspace) workspace = { ...workspace, ...provided.workspace };
          if (provided.analyticsSummary) analyticsSummary = { ...analyticsSummary, ...provided.analyticsSummary };
          if (provided.plugins) plugins = { ...plugins, ...provided.plugins };
          if (provided.permissions) permissions = { ...permissions, ...provided.permissions };
          if (provided.extensionData) Object.assign(extensionData, provided.extensionData);
        }
      } catch {
        // Ignore provider errors to ensure snapshot resilience
      }
    }

    const snapshot: AIClassroomContextSnapshot = {
      classroomId: rawClassroomId,
      timestamp: Date.now(),
      lesson: Object.freeze(lesson),
      teacher: Object.freeze(teacher),
      students: Object.freeze(students),
      groups: Object.freeze(groups),
      resources: Object.freeze(resources),
      whiteboard: Object.freeze(whiteboard),
      activities: Object.freeze(activities),
      workspace: Object.freeze(workspace),
      analyticsSummary: Object.freeze(analyticsSummary),
      plugins: Object.freeze(plugins),
      permissions: Object.freeze(permissions),
      extensionData: Object.freeze(extensionData),
    };

    return Object.freeze(snapshot);
  }

  public clear(): void {
    this.providers.clear();
  }
}
