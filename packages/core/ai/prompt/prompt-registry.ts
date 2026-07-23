/**
 * OpenLearn AI Infrastructure - Centralized Prompt Registry
 * Manages versioned, categorized prompt templates with variable interpolation.
 */

import { PromptTemplate } from '../types/index.js';
import { AIEventBus } from '../event/ai-event-bus.js';

export class PromptRegistry {
  private templates = new Map<string, PromptTemplate>();
  private eventBus: AIEventBus;

  constructor(eventBus: AIEventBus) {
    this.eventBus = eventBus;
    this.seedDefaultPrompts();
  }

  public registerPrompt(template: PromptTemplate): void {
    this.templates.set(template.id, Object.freeze(template));
  }

  public getPrompt(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  public buildPrompt(id: string, variables: Record<string, string | number> = {}): string {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Prompt template not found: ${id}`);
    }

    let result = template.template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }

    this.eventBus.publish('PromptBuilt', {
      promptId: id,
      interpolatedPrompt: result,
    });

    return result;
  }

  public listPrompts(category?: string): ReadonlyArray<PromptTemplate> {
    const all = Array.from(this.templates.values());
    if (category) {
      return Object.freeze(all.filter((t) => t.category === category));
    }
    return Object.freeze(all);
  }

  private seedDefaultPrompts(): void {
    // 1. Agent System Instruction (zh/en)
    this.registerPrompt({
      id: 'agent_system_instruction_zh',
      name: 'OS Agent 中文系统提示词',
      category: 'agent',
      version: 1,
      template: '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作。如果老师让你创建一节课，请务必利用工具生成详细的初始课程内容。如果老师要求管理进程/任务，请使用 process.spawn, process.kill, process.list。如果需存储文件、素材或创建目录，请使用 vfs.* 并在需要时管理班级和学生。你支持通过 class_create 创建班级, student_create 创建学生, class_add_student 将学生加入班级。当老师要求从提供的数据（如CSV、JSON、Markdown或对话中）创建班级或学生时，请依次发出这些指令。如果上一阶段返回了创建成功的班级ID或学生ID，你需要在后续的 functionCall 中引用这些ID（例如：把刚创建的学生ID加入到刚创建的班级ID中）。通过往复的工具调用，你可以自动完成完整的流程。',
      tags: ['agent', 'system', 'zh'],
    });

    this.registerPrompt({
      id: 'agent_system_instruction_en',
      name: 'OS Agent English System Instruction',
      category: 'agent',
      version: 1,
      template: 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools (commands) to execute them. If the teacher asks to create a lesson, always generate some detailed initial content for it. If the teacher asks to spawn or kill processes, use process tools. Use vfs tools to store assets, and manage classes/students as necessary. You support class_create, student_create, class_add_student. Always use tool chaining if you need to create a class and enroll students: first call class_create/student_create, receive their returned IDs, and then call class_add_student in the next turn. Always answer with a helpful summary.',
      tags: ['agent', 'system', 'en'],
    });

    // 2. Lesson Quiz Generation
    this.registerPrompt({
      id: 'stage_quiz_generation',
      name: '阶段 Quiz 选择题生成 Prompt',
      category: 'lesson',
      version: 1,
      template: 'Based on the teaching stage "{{title}}" with knowledge points [{{knowledgePoints}}] and goals [{{teachingGoals}}], generate {{count}} multiple choice questions in JSON array format with fields: question, options (array of 4 strings), answerIndex (0-3), explanation. Return ONLY JSON.',
      tags: ['lesson', 'quiz'],
    });

    // 3. Activity Summary
    this.registerPrompt({
      id: 'activity_summary',
      name: '教学环节总结 Prompt',
      category: 'lesson',
      version: 1,
      template: 'Summarize the educational activity "{{title}}" (Type: {{type}}) for teacher recap. Keep it under 100 words.',
      tags: ['lesson', 'summary'],
    });

    // 4. Lesson Plan Generation
    this.registerPrompt({
      id: 'lesson_plan_generation',
      name: '5阶段教案规划 Prompt',
      category: 'lesson',
      version: 1,
      template: 'Generate a structured lesson flow for {{grade}} {{subject}} topic "{{topic}}". Include 5 stages: 导入, 新知学习, 课堂演示, 课堂练习, 课堂总结. Return standard JSON.',
      tags: ['lesson', 'plan'],
    });
  }
}
