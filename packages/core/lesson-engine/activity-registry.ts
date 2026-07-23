/**
 * OpenLearn Lesson Flow Engine - Activity Registry
 * Enables plugins and core extensions to dynamically register Activity types.
 */

import { ActivityDefinition } from './types.js';

export class ActivityRegistry {
  private activities = new Map<string, ActivityDefinition>();

  constructor() {
    this.registerBuiltins();
  }

  /**
   * Register a new Activity definition.
   */
  public registerActivity(definition: ActivityDefinition): void {
    if (!definition.type) {
      throw new Error('[ActivityRegistry] Activity definition must specify a "type" property.');
    }
    this.activities.set(definition.type, definition);
  }

  /**
   * Unregister an Activity definition by type.
   */
  public unregisterActivity(type: string): boolean {
    return this.activities.delete(type);
  }

  /**
   * Retrieve an Activity definition by type.
   */
  public getActivity(type: string): ActivityDefinition | undefined {
    return this.activities.get(type);
  }

  /**
   * Check if an Activity type is registered.
   */
  public hasActivity(type: string): boolean {
    return this.activities.has(type);
  }

  /**
   * List all registered Activity definitions.
   */
  public listActivities(): ActivityDefinition[] {
    return Array.from(this.activities.values());
  }

  /**
   * Helper to register default built-in activity types.
   */
  private registerBuiltins(): void {
    const builtins: ActivityDefinition[] = [
      { type: 'video', name: '播放视频', description: '支持MP4/HLS及网页视频流', category: 'media' },
      { type: 'image', name: '展示图片', description: '高质量图像及图表展示', category: 'media' },
      { type: 'python', name: '运行Python', description: '代码编辑器与Pyodide在线运行', category: 'coding' },
      { type: 'quiz', name: '开始Quiz', description: '单选、多选、填空即时测验', category: 'assessment' },
      { type: 'discussion', name: '开始讨论', description: '分组与全班实时互动研讨', category: 'collaboration' },
      { type: 'ai_question', name: 'AI生成问题', description: 'AI智能提问与实时反馈', category: 'ai' },
      { type: 'web_browse', name: '网页浏览', description: '内置浏览器嵌入外部网页资源', category: 'custom' },
      { type: 'geogebra', name: 'GeoGebra演示', description: '动态数学与几何三维建模', category: 'simulation' },
      { type: 'mindmap', name: '思维导图', description: '协作式思维导图绘制', category: 'collaboration' },
      { type: 'simulation', name: '科学实验模拟', description: '物理化学交互式仿真', category: 'simulation' },
      { type: 'vr', name: 'VR沉浸式体验', description: 'WebXR 3D虚拟现实场景', category: 'simulation' },
    ];

    for (const act of builtins) {
      this.registerActivity(act);
    }
  }
}
