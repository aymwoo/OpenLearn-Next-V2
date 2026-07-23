import { v7 as uuidv7 } from 'uuid';
import type { TeachingCapabilities, TeachingCategory, TeachingMetadata, TeachingObject } from '../types.js';
import { objectRegistry } from '../../canvas-model/registry/object-registry.js';

export interface TeachingObjectDescriptor<T = Record<string, unknown>> {
  type: string;
  displayName: string;
  category: TeachingCategory;
  defaultCapabilities: TeachingCapabilities;
  createDefaultPayload: () => T;
  createDefaultMetadata?: () => TeachingMetadata;
}

export class TeachingObjectRegistry {
  private descriptors = new Map<string, TeachingObjectDescriptor>();

  constructor() {
    this.registerBuiltinTeachingObjects();
  }

  public registerTeachingObject<T = Record<string, unknown>>(descriptor: TeachingObjectDescriptor<T>): void {
    if (this.descriptors.has(descriptor.type)) {
      console.warn(`[TeachingObjectRegistry] Overwriting descriptor for type: "${descriptor.type}"`);
    }
    this.descriptors.set(descriptor.type, descriptor as TeachingObjectDescriptor);
  }

  public unregisterTeachingObject(type: string): boolean {
    return this.descriptors.delete(type);
  }

  public getTeachingObject<T = Record<string, unknown>>(type: string): TeachingObjectDescriptor<T> | undefined {
    return this.descriptors.get(type) as TeachingObjectDescriptor<T> | undefined;
  }

  public listByCategory(category: TeachingCategory): TeachingObjectDescriptor[] {
    return Array.from(this.descriptors.values()).filter((d) => d.category === category);
  }

  public createTeachingObject<T = Record<string, unknown>>(
    type: string,
    overrides?: Partial<TeachingObject<T>>
  ): TeachingObject<T> {
    const baseCanvasObj = objectRegistry.createObject<T>(type, overrides);
    const descriptor = this.descriptors.get(type);

    const category: TeachingCategory = overrides?.category || descriptor?.category || 'content';
    const capabilities: TeachingCapabilities = overrides?.capabilities || descriptor?.defaultCapabilities || {
      editable: true,
      runnable: false,
      answerable: false,
      scorable: false,
      collaborative: true,
      presentable: true,
      replayable: true,
      evaluatable: false,
      aiEditable: true,
      pluginExtendable: true,
    };

    const teachingMetadata: TeachingMetadata = overrides?.teachingMetadata || {
      title: descriptor?.displayName || baseCanvasObj.name,
      description: 'Teaching Object instance',
      author: 'Teacher',
      version: '2.0',
    };

    return {
      ...baseCanvasObj,
      category,
      capabilities,
      teachingMetadata,
      lifecycleStage: overrides?.lifecycleStage || 'Create',
      runtimeStatus: overrides?.runtimeStatus || 'idle',
    };
  }

  public cloneTeachingObject<T = Record<string, unknown>>(obj: TeachingObject<T>): TeachingObject<T> {
    const clonedBase = objectRegistry.cloneObject(obj);
    return {
      ...clonedBase,
      category: obj.category,
      capabilities: { ...obj.capabilities },
      teachingMetadata: { ...obj.teachingMetadata },
      lifecycleStage: 'Create',
      runtimeStatus: 'idle',
    };
  }

  public serializeTeachingObject<T>(obj: TeachingObject<T>): string {
    return JSON.stringify(obj, null, 2);
  }

  private registerBuiltinTeachingObjects(): void {
    // 1. Content Category
    this.registerTeachingObject({
      type: 'presentation',
      displayName: '演示文稿 Markdown 幻灯片',
      category: 'content',
      defaultCapabilities: { editable: true, runnable: false, answerable: false, scorable: false, collaborative: true, presentable: true, replayable: true, evaluatable: false, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ markdown: '# Slide Title\n---\n## Content' }),
    });

    // 2. Programming Category
    this.registerTeachingObject({
      type: 'code-sandbox',
      displayName: '交互代码沙箱',
      category: 'programming',
      defaultCapabilities: { editable: true, runnable: true, answerable: true, scorable: true, collaborative: true, presentable: true, replayable: true, evaluatable: true, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ code: "console.log('Hello OpenLearn!');", language: 'javascript' }),
    });

    // 3. Interactive Category
    this.registerTeachingObject({
      type: 'quiz',
      displayName: '随堂互动测验',
      category: 'interactive',
      defaultCapabilities: { editable: true, runnable: true, answerable: true, scorable: true, collaborative: true, presentable: true, replayable: true, evaluatable: true, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ question: '本节课的核心概念？', options: ['A', 'B', 'C', 'D'], correctIndex: 0 }),
    });

    // 4. Learning Category
    this.registerTeachingObject({
      type: 'assignment',
      displayName: '课堂作业任务',
      category: 'learning',
      defaultCapabilities: { editable: true, runnable: false, answerable: true, scorable: true, collaborative: true, presentable: true, replayable: true, evaluatable: true, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ title: '课堂作业', description: '请按要求提交代码或文件' }),
    });

    // 5. AI Category
    this.registerTeachingObject({
      type: 'ai-tutor',
      displayName: 'AI 智能助教 Widget',
      category: 'ai',
      defaultCapabilities: { editable: true, runnable: true, answerable: true, scorable: false, collaborative: true, presentable: true, replayable: true, evaluatable: true, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ prompt: '请解答学生疑问' }),
    });

    // 6. Plugin Category
    this.registerTeachingObject({
      type: 'plugin',
      displayName: '第三方教学插件对象',
      category: 'plugin',
      defaultCapabilities: { editable: true, runnable: true, answerable: true, scorable: true, collaborative: true, presentable: true, replayable: true, evaluatable: true, aiEditable: true, pluginExtendable: true },
      createDefaultPayload: () => ({ pluginId: '', widgetId: '' }),
    });
  }
}

export const teachingObjectRegistry = new TeachingObjectRegistry();
