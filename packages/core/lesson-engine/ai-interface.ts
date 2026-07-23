/**
 * OpenLearn Lesson Flow Engine - AI Interface Facade
 * Allows AI agents to inspect Lesson, Flow, Stage, Activity structures and generate educational materials.
 */

import { Lesson, Flow, Stage, Activity } from './types.js';
import { IAIService } from '../di/interfaces.js';

export class LessonAIInterface {
  private aiService?: IAIService;

  constructor(aiService?: IAIService) {
    this.aiService = aiService;
  }

  public setAIService(aiService: IAIService): void {
    this.aiService = aiService;
  }

  /**
   * Get AI-readable summary of the stage.
   */
  public getStageContextForAI(stage: Stage): string {
    return `[Stage Context]
Title: ${stage.title}
Goals: ${stage.teachingGoals.join(', ') || 'N/A'}
Knowledge Points: ${stage.knowledgePoints.join(', ') || 'N/A'}
Assignee: ${stage.assignee}
Activities Count: ${stage.activities.length}
Activities: ${stage.activities.map((a) => `${a.title} (${a.type})`).join(' -> ')}`;
  }

  /**
   * Get AI-readable summary of the active lesson.
   */
  public getLessonContextForAI(lesson: Lesson, activeFlow?: Flow): string {
    return `[Lesson Context]
Title: ${lesson.title}
Subject: ${lesson.subject}
Grade: ${lesson.grade}
Teacher: ${lesson.teacher.name}
Active Flow: ${activeFlow?.name || 'Default Flow'}
Stages Count: ${activeFlow?.stages.length || 0}`;
  }

  /**
   * AI-generated Quiz based on current Stage knowledge points & goals.
   */
  public async generateQuizForStage(stage: Stage, count = 3): Promise<Array<{ question: string; options: string[]; answerIndex: number; explanation: string }>> {
    const prompt = `Based on the teaching stage "${stage.title}" with knowledge points [${stage.knowledgePoints.join(', ')}] and goals [${stage.teachingGoals.join(', ')}], generate ${count} multiple choice questions in JSON array format with fields: question, options (array of 4 strings), answerIndex (0-3), explanation. Return ONLY JSON.`;

    if (this.aiService) {
      try {
        const rawJson = await this.aiService.generateText(prompt, { temperature: 0.3 });
        const parsed = JSON.parse(rawJson.replace(/```json|```/g, '').trim());
        if (Array.isArray(parsed)) return parsed;
      } catch (err) {
        console.warn('[LessonAIInterface] Fallback to synthetic quiz generation due to AI call error:', err);
      }
    }

    // Fallback template-based quiz generation
    return stage.knowledgePoints.map((kp, idx) => ({
      question: `关于 ${kp}，下列哪项说法是正确的？`,
      options: [
        `${kp} 是本阶段核心学习要点A`,
        `${kp} 的定义与逻辑推导B`,
        `${kp} 的实际应用场景C`,
        `以上说法均正确`,
      ],
      answerIndex: 3,
      explanation: `本题考查${stage.title}中关于${kp}的基础理解。`,
    }));
  }

  /**
   * AI-generated summary for an Activity.
   */
  public async generateSummaryForActivity(activity: Activity): Promise<string> {
    const prompt = `Summarize the educational activity "${activity.title}" (Type: ${activity.type}) for teacher recap. Keep it under 100 words.`;

    if (this.aiService) {
      try {
        return await this.aiService.generateText(prompt, { temperature: 0.4 });
      } catch (err) {
        console.warn('[LessonAIInterface] AI service failed, returning fallback summary:', err);
      }
    }

    return `环节 [${activity.title}] (类型: ${activity.type}) 已顺利完成。学生积极参与了互动与思考，达成了该环节的预定教学指标。`;
  }

  /**
   * AI-generated complete Lesson Plan (Flow + Stages + Activities).
   */
  public async generateLessonPlan(subject: string, grade: string, topic: string): Promise<Partial<Flow>> {
    const prompt = `Generate a structured lesson flow for ${grade} ${subject} topic "${topic}". Include 5 stages: 导入, 新知学习, 课堂演示, 课堂练习, 课堂总结. Return standard JSON.`;

    if (this.aiService) {
      try {
        const raw = await this.aiService.generateText(prompt, { temperature: 0.5 });
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        if (parsed && Array.isArray(parsed.stages)) return parsed;
      } catch (err) {
        console.warn('[LessonAIInterface] AI lesson plan generation failed, using standard template:', err);
      }
    }

    return {
      name: `${topic} 教学流程`,
      description: `${grade}${subject}《${topic}》标准教学流程`,
      version: 1,
      stages: [
        {
          id: `stg_import_${Date.now()}`,
          title: '一、导入',
          estimatedDurationSeconds: 300,
          teachingGoals: ['激发学习兴趣', '引入课题背景'],
          knowledgePoints: [topic],
          completionStatus: 'pending',
          assignee: 'teacher',
          activities: [
            { id: `act_img_${Date.now()}`, type: 'image', title: '情境图片展示', config: {}, status: 'idle', teachingObjects: [] },
            { id: `act_vid_${Date.now()}`, type: 'video', title: '导入短视频', config: {}, status: 'idle', teachingObjects: [] },
          ],
        },
        {
          id: `stg_learn_${Date.now()}`,
          title: '二、新知学习',
          estimatedDurationSeconds: 900,
          teachingGoals: ['讲解核心概念', '剖析要点推导'],
          knowledgePoints: [`${topic}基础概念`, `${topic}主要定理`],
          completionStatus: 'pending',
          assignee: 'teacher',
          activities: [
            { id: `act_ppt_${Date.now()}`, type: 'image', title: '知识点课件讲解', config: {}, status: 'idle', teachingObjects: [] },
          ],
        },
        {
          id: `stg_demo_${Date.now()}`,
          title: '三、课堂演示',
          estimatedDurationSeconds: 600,
          teachingGoals: ['示例演示', '直观模型说明'],
          knowledgePoints: [`${topic}应用示例`],
          completionStatus: 'pending',
          assignee: 'teacher',
          activities: [
            { id: `act_geo_${Date.now()}`, type: 'geogebra', title: '动态模型演示', config: {}, status: 'idle', teachingObjects: [] },
            { id: `act_py_${Date.now()}`, type: 'python', title: 'Python代码验证', config: {}, status: 'idle', teachingObjects: [] },
          ],
        },
        {
          id: `stg_practice_${Date.now()}`,
          title: '四、课堂练习',
          estimatedDurationSeconds: 600,
          teachingGoals: ['巩固练习', '查漏补缺'],
          knowledgePoints: [`${topic}习题训练`],
          completionStatus: 'pending',
          assignee: 'student',
          activities: [
            { id: `act_quiz_${Date.now()}`, type: 'quiz', title: '随堂测验Quiz', config: {}, status: 'idle', teachingObjects: [] },
          ],
        },
        {
          id: `stg_summary_${Date.now()}`,
          title: '五、课堂总结',
          estimatedDurationSeconds: 300,
          teachingGoals: ['梳理知识脉络', '总结注意事项'],
          knowledgePoints: [`${topic}知识小结`],
          completionStatus: 'pending',
          assignee: 'teacher',
          activities: [
            { id: `act_mind_${Date.now()}`, type: 'mindmap', title: '思维导图总结', config: {}, status: 'idle', teachingObjects: [] },
          ],
        },
      ],
    };
  }
}
