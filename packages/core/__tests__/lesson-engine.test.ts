import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LessonRuntime,
  ActivityRegistry,
  TeachingTimeline,
  StageRuntime,
  WhiteboardStageAdapter,
  LessonReplayer,
  LessonAIInterface,
  Lesson,
  Flow,
  Stage,
  Activity,
  ActivityDefinition,
  CanvasElementData,
} from '../lesson-engine/index.js';
import { EventBus } from '../event-bus/index.js';

describe('Lesson Flow Engine Unit & Integration Test Suite', () => {
  let eventBus: EventBus;
  let runtime: LessonRuntime;

  const mockLesson: Lesson = {
    id: 'les_math_101',
    title: '高等数学 - 微积分初步',
    subject: '数学',
    grade: '高一',
    teacher: { id: 'usr_t1', name: '张老师', role: 'teacher' },
    durationMinutes: 45,
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    flows: [
      {
        id: 'flw_standard',
        name: '标准45分钟教学流程',
        description: '涵盖导入、讲解、练习与总结',
        version: 1,
        isCurrent: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stages: [
          {
            id: 'stg_1',
            title: '一、概念导入',
            estimatedDurationSeconds: 300,
            teachingGoals: ['理解极限直观定义'],
            knowledgePoints: ['极限概念'],
            completionStatus: 'pending',
            assignee: 'teacher',
            activities: [
              {
                id: 'act_1_1',
                type: 'video',
                title: '割圆术微视频',
                config: { autoAdvance: true },
                status: 'idle',
                teachingObjects: [],
              },
            ],
          },
          {
            id: 'stg_2',
            title: '二、新知学习',
            estimatedDurationSeconds: 600,
            teachingGoals: ['推导导数公式'],
            knowledgePoints: ['导数公式'],
            completionStatus: 'pending',
            assignee: 'teacher',
            activities: [
              {
                id: 'act_2_1',
                type: 'geogebra',
                title: '切线斜率动态模型',
                config: {},
                status: 'idle',
                teachingObjects: [],
              },
              {
                id: 'act_2_2',
                type: 'python',
                title: 'Python极限数值逼近',
                config: {},
                status: 'idle',
                teachingObjects: [],
              },
            ],
          },
          {
            id: 'stg_3',
            title: '三、课堂练习',
            estimatedDurationSeconds: 600,
            teachingGoals: ['巩固求导练习'],
            knowledgePoints: ['求导法则'],
            completionStatus: 'pending',
            assignee: 'student',
            activities: [
              {
                id: 'act_3_1',
                type: 'quiz',
                title: '随堂测验三连击',
                config: {},
                status: 'idle',
                teachingObjects: [],
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    eventBus = new EventBus();
    runtime = new LessonRuntime({ eventBus });
  });

  describe('1. Activity Registry', () => {
    it('should initialize with built-in activities', () => {
      const reg = new ActivityRegistry();
      expect(reg.hasActivity('video')).toBe(true);
      expect(reg.hasActivity('python')).toBe(true);
      expect(reg.hasActivity('quiz')).toBe(true);
      expect(reg.hasActivity('geogebra')).toBe(true);
      expect(reg.listActivities().length).toBeGreaterThanOrEqual(10);
    });

    it('should register and retrieve custom plugin activities', () => {
      const reg = new ActivityRegistry();
      const customDef: ActivityDefinition = {
        type: 'vr_space',
        name: 'VR太空探索',
        description: '沉浸式WebXR探索',
        category: 'simulation',
      };
      reg.registerActivity(customDef);
      expect(reg.hasActivity('vr_space')).toBe(true);
      expect(reg.getActivity('vr_space')?.name).toBe('VR太空探索');
    });
  });

  describe('2. Teaching Timeline', () => {
    it('should correctly navigate next, previous, jump, and restart', () => {
      const timeline = new TeachingTimeline(mockLesson.flows[0]);
      let state = timeline.getState();

      expect(state.currentStageIndex).toBe(0);
      expect(state.currentActivityIndex).toBe(0);

      // Advance to next activity in stage 2
      timeline.next();
      state = timeline.getState();
      expect(state.currentStageIndex).toBe(1);
      expect(state.currentActivityIndex).toBe(0);

      timeline.next();
      state = timeline.getState();
      expect(state.currentStageIndex).toBe(1);
      expect(state.currentActivityIndex).toBe(1);

      // Jump to stage 3
      timeline.jump(2);
      state = timeline.getState();
      expect(state.currentStageIndex).toBe(2);

      // Go previous
      timeline.previous();
      state = timeline.getState();
      expect(state.currentStageIndex).toBe(1);
      expect(state.currentActivityIndex).toBe(1);

      // Restart
      timeline.restart();
      state = timeline.getState();
      expect(state.currentStageIndex).toBe(0);
      expect(state.currentActivityIndex).toBe(0);
    });
  });

  describe('3. Stage Runtime & Analytics', () => {
    it('should manage stage lifecycle and calculate analytics', async () => {
      const stageRuntime = new StageRuntime({ eventBus });
      const stage = mockLesson.flows[0].stages[2]; // Quiz stage

      await stageRuntime.enterStage(stage, 'les_1', 'flw_1', 2);
      expect(stageRuntime.getCurrentStage()?.id).toBe('stg_3');
      expect(stageRuntime.isStagePaused()).toBe(false);

      // Record student interaction
      stageRuntime.recordStudentAction({
        id: 'act_sub_1',
        studentId: 'stu_01',
        studentName: '小明',
        stageId: 'stg_3',
        actionType: 'quiz_submit',
        payload: { score: 90, maxScore: 100 },
        timestamp: Date.now(),
      });

      stageRuntime.updateActivityStatus('act_3_1', 'completed');
      const analytics = await stageRuntime.exitStage('les_1', 'flw_1');

      expect(analytics).not.toBeNull();
      expect(analytics?.participantCount).toBe(1);
      expect(analytics?.interactionCount).toBe(1);
      expect(analytics?.completionRate).toBe(100);
      expect(analytics?.quizScores[0].score).toBe(90);
    });
  });

  describe('4. Lesson Runtime Master Orchestrator', () => {
    it('should start, pause, resume, and stop lesson', async () => {
      const eventSpy = vi.fn();
      eventBus.subscribe('LessonStarted', eventSpy);
      eventBus.subscribe('LessonEnded', eventSpy);

      await runtime.startLesson(mockLesson);
      expect(runtime.getCurrentLesson()?.status).toBe('active');
      expect(eventSpy).toHaveBeenCalledTimes(1);

      await runtime.pauseLesson();
      expect(runtime.getCurrentLesson()?.status).toBe('paused');

      await runtime.resumeLesson();
      expect(runtime.getCurrentLesson()?.status).toBe('active');

      const finalAnalytics = await runtime.stopLesson();
      expect(runtime.getCurrentLesson()?.status).toBe('completed');
      expect(eventSpy).toHaveBeenCalledTimes(3); // start, resume, stop
    });

    it('should perform teacher control operations (next, lock, jump, skip)', async () => {
      await runtime.startLesson(mockLesson);

      expect(runtime.timeline.getState().currentStageIndex).toBe(0);

      runtime.nextStage();
      expect(runtime.timeline.getState().currentStageIndex).toBe(1);

      runtime.lockStage('stg_2', true);
      expect(runtime.getActiveFlow()?.stages[1].locked).toBe(true);

      runtime.skipStage('stg_2');
      expect(runtime.timeline.getState().currentStageIndex).toBe(2);

      runtime.repeatStage('stg_1');
      expect(runtime.timeline.getState().currentStageIndex).toBe(0);
    });

    it('should support flow editing (add, remove, copy, reorder)', async () => {
      await runtime.startLesson(mockLesson);

      // Copy stage 1 in flow
      const clonedStage = runtime.copyStageInFlow('flw_standard', 'stg_1');
      expect(clonedStage).not.toBeNull();
      expect(runtime.getActiveFlow()?.stages.length).toBe(4);

      // Reorder stages (swap index 0 and 1)
      runtime.reorderStagesInFlow('flw_standard', 0, 1);
      expect(runtime.getActiveFlow()?.stages[0].id).toBe(clonedStage?.id);


      // Copy flow
      const copiedFlow = runtime.copyFlow('flw_standard', '副本工作流');
      expect(copiedFlow).not.toBeNull();
      expect(runtime.getCurrentLesson()?.flows.length).toBe(2);
    });
  });

  describe('5. Whiteboard Stage Adapter', () => {
    it('should isolate stage views and support cross-stage element sharing', () => {
      const adapter = new WhiteboardStageAdapter();

      // Create view for Stage 1
      adapter.updateStageView('stg_1', {
        elements: [
          { id: 'elem_1', type: 'text', x: 10, y: 10, content: 'Stage 1 Text' },
        ],
      });

      const view1 = adapter.getStageView('stg_1');
      expect(view1.elements.length).toBe(1);

      // Share an element across stg_1 and stg_2
      const sharedElem: CanvasElementData = {
        id: 'elem_shared',
        type: 'formula',
        x: 50,
        y: 50,
        content: 'E = mc^2',
      };
      adapter.shareObjectAcrossStages(sharedElem, ['stg_1', 'stg_2']);

      const view1WithShared = adapter.getStageView('stg_1');
      const view2WithShared = adapter.getStageView('stg_2');

      expect(view1WithShared.elements.some((e) => e.id === 'elem_shared')).toBe(true);
      expect(view2WithShared.elements.some((e) => e.id === 'elem_shared')).toBe(true);
    });
  });

  describe('6. AI Interface & Replayer', () => {
    it('should generate quiz and lesson plan fallbacks when AI service is unconfigured', async () => {
      const ai = new LessonAIInterface();
      const stage = mockLesson.flows[0].stages[0];

      const quiz = await ai.generateQuizForStage(stage, 2);
      expect(quiz.length).toBeGreaterThan(0);
      expect(quiz[0].question).toContain('极限概念');

      const plan = await ai.generateLessonPlan('数学', '高一', '微积分');
      expect(plan.stages?.length).toBe(5);
    });

    it('should record frames and perform playback in LessonReplayer', () => {
      const replayer = new LessonReplayer();
      const startTime = Date.now();

      replayer.recordEvent(
        {
          id: 'ev_1',
          type: 'StageEntered',
          source: 'test',
          payload: {},
          timestamp: startTime + 100,
        },
        startTime
      );

      const frames = replayer.getFrames();
      expect(frames.length).toBe(1);
      expect(frames[0].relativeTimeMs).toBe(100);
    });
  });
});
