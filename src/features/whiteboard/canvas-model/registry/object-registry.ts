import { v7 as uuidv7 } from 'uuid';
import type { CanvasObject, ObjectTypeDescriptor, Size2D } from '../types.js';

/**
 * ObjectRegistry & Factory
 * 
 * Central registry for all Canvas Object types.
 * Enables core features and external plugins to register custom object types
 * without modifying Whiteboard Core source code.
 */
export class ObjectRegistry {
  private descriptors = new Map<string, ObjectTypeDescriptor>();

  constructor() {
    this.registerBuiltinObjectTypes();
  }

  /**
   * Register a new Object Type Descriptor
   */
  public registerObject<T = Record<string, unknown>>(descriptor: ObjectTypeDescriptor<T>): void {
    if (this.descriptors.has(descriptor.type)) {
      console.warn(`[ObjectRegistry] Overwriting object type registration for: "${descriptor.type}"`);
    }
    this.descriptors.set(descriptor.type, descriptor as ObjectTypeDescriptor);
  }

  /**
   * Unregister an Object Type Descriptor
   */
  public unregisterObject(type: string): boolean {
    return this.descriptors.delete(type);
  }

  /**
   * Get an Object Type Descriptor by type string
   */
  public getObject<T = Record<string, unknown>>(type: string): ObjectTypeDescriptor<T> | undefined {
    return this.descriptors.get(type) as ObjectTypeDescriptor<T> | undefined;
  }

  /**
   * Check if an Object Type is registered
   */
  public hasObject(type: string): boolean {
    return this.descriptors.has(type);
  }

  /**
   * List all registered Object Types
   */
  public listObjectTypes(): ObjectTypeDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  /**
   * Factory Method: Create a new CanvasObject instance with defaults
   */
  public createObject<T = Record<string, unknown>>(
    type: string,
    overrides?: Partial<CanvasObject<T>>
  ): CanvasObject<T> {
    const descriptor = this.descriptors.get(type);
    const defaultPayload = descriptor ? (descriptor.createDefaultPayload() as T) : ({} as T);
    const defaultSize: Size2D = descriptor ? descriptor.defaultSize : { width: 300, height: 200 };

    const now = Date.now();
    const newObj: CanvasObject<T> = {
      id: overrides?.id || uuidv7(),
      type,
      name: overrides?.name || `${descriptor?.displayName || type}_${now.toString().slice(-4)}`,
      position: overrides?.position || { x: 100, y: 100 },
      rotation: overrides?.rotation ?? 0,
      scale: overrides?.scale || { x: 1, y: 1 },
      size: overrides?.size || defaultSize,
      opacity: overrides?.opacity ?? 1,
      visible: overrides?.visible ?? true,
      locked: overrides?.locked ?? false,
      zIndex: overrides?.zIndex ?? 1,
      parentId: overrides?.parentId ?? null,
      groupId: overrides?.groupId ?? null,
      layerId: overrides?.layerId || 'layer-default',
      createdAt: overrides?.createdAt || now,
      updatedAt: overrides?.updatedAt || now,
      createdBy: overrides?.createdBy || 'teacher',
      metadata: overrides?.metadata || {},
      payload: overrides?.payload ? { ...defaultPayload, ...overrides.payload } : defaultPayload,
    };

    return newObj;
  }

  /**
   * Clone a CanvasObject with a new unique ID
   */
  public cloneObject<T = Record<string, unknown>>(
    obj: CanvasObject<T>,
    positionOffset: { x: number; y: number } = { x: 20, y: 20 }
  ): CanvasObject<T> {
    const now = Date.now();
    return {
      ...JSON.parse(JSON.stringify(obj)),
      id: uuidv7(),
      name: `${obj.name}_copy`,
      position: {
        x: obj.position.x + positionOffset.x,
        y: obj.position.y + positionOffset.y,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Serialize a CanvasObject to JSON string
   */
  public serializeObject<T>(obj: CanvasObject<T>): string {
    return JSON.stringify(obj);
  }

  /**
   * Deserialize a JSON string or object back into CanvasObject<T>
   */
  public deserializeObject<T = Record<string, unknown>>(data: string | Record<string, unknown>): CanvasObject<T> {
    const parsed: CanvasObject<T> = typeof data === 'string' ? JSON.parse(data) : (data as unknown as CanvasObject<T>);
    
    // Ensure base structural fallback values
    return {
      id: parsed.id || uuidv7(),
      type: parsed.type || 'unknown',
      name: parsed.name || 'Unnamed Object',
      position: parsed.position || { x: 0, y: 0 },
      rotation: parsed.rotation ?? 0,
      scale: parsed.scale || { x: 1, y: 1 },
      size: parsed.size || { width: 300, height: 200 },
      opacity: parsed.opacity ?? 1,
      visible: parsed.visible ?? true,
      locked: parsed.locked ?? false,
      zIndex: parsed.zIndex ?? 1,
      parentId: parsed.parentId ?? null,
      groupId: parsed.groupId ?? null,
      layerId: parsed.layerId || 'layer-default',
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: parsed.updatedAt || Date.now(),
      createdBy: parsed.createdBy || 'system',
      metadata: parsed.metadata || {},
      payload: (parsed.payload || {}) as T,
    };
  }

  /**
   * Register standard built-in object types
   */
  private registerBuiltinObjectTypes(): void {
    this.registerObject({
      type: 'text',
      displayName: '文本对象',
      category: 'basic',
      defaultSize: { width: 200, height: 60 },
      createDefaultPayload: () => ({
        text: '点击输入文本',
        fontFamily: 'sans-serif',
        fontSize: 18,
        fill: '#1e293b',
        align: 'left',
      }),
    });

    this.registerObject({
      type: 'rect',
      displayName: '矩形对象',
      category: 'shape',
      defaultSize: { width: 160, height: 120 },
      createDefaultPayload: () => ({
        shapeType: 'rect',
        fill: '#e0e7ff',
        stroke: '#4f46e5',
        strokeWidth: 2,
        cornerRadius: 8,
      }),
    });

    this.registerObject({
      type: 'circle',
      displayName: '圆形对象',
      category: 'shape',
      defaultSize: { width: 120, height: 120 },
      createDefaultPayload: () => ({
        shapeType: 'circle',
        fill: '#fef3c7',
        stroke: '#d97706',
        strokeWidth: 2,
      }),
    });

    this.registerObject({
      type: 'pen',
      displayName: '自由画笔',
      category: 'shape',
      defaultSize: { width: 200, height: 200 },
      createDefaultPayload: () => ({
        shapeType: 'pen',
        stroke: '#4f46e5',
        strokeWidth: 3,
        points: [],
      }),
    });

    this.registerObject({
      type: 'highlighter',
      displayName: '高亮荧光笔',
      category: 'shape',
      defaultSize: { width: 200, height: 200 },
      createDefaultPayload: () => ({
        shapeType: 'highlighter',
        stroke: '#facc15',
        strokeWidth: 14,
        points: [],
      }),
    });

    this.registerObject({
      type: 'code-sandbox',
      displayName: '代码沙箱',
      category: 'interactive',
      defaultSize: { width: 400, height: 320 },
      createDefaultPayload: () => ({
        code: "console.log('Hello OpenLearn!');",
        language: 'javascript',
      }),
    });

    this.registerObject({
      type: 'math-graph',
      displayName: '数学函数图表',
      category: 'interactive',
      defaultSize: { width: 400, height: 350 },
      createDefaultPayload: () => ({
        equation: 'Math.sin(x)',
      }),
    });

    this.registerObject({
      type: 'quiz',
      displayName: '随堂测验',
      category: 'interactive',
      defaultSize: { width: 320, height: 280 },
      createDefaultPayload: () => ({
        question: '请问本节课的核心概念是？',
        options: ['选项 A', '选项 B', '选项 C', '选项 D'],
        correctIndex: 0,
      }),
    });

    this.registerObject({
      type: 'presentation',
      displayName: '演示文稿幻灯片',
      category: 'media',
      defaultSize: { width: 600, height: 400 },
      createDefaultPayload: () => ({
        markdown: '# Title Slide\n---\n## Slide 2',
        currentSlideIndex: 0,
      }),
    });

    this.registerObject({
      type: 'rollcall',
      displayName: '随机点名助手',
      category: 'interactive',
      defaultSize: { width: 320, height: 310 },
      createDefaultPayload: () => ({
        title: '随机点名助手',
      }),
    });

    this.registerObject({
      type: 'plugin',
      displayName: '扩展插件组件',
      category: 'plugin',
      defaultSize: { width: 500, height: 400 },
      createDefaultPayload: () => ({
        pluginId: '',
        widgetId: '',
        slot: 'whiteboard.widget',
      }),
    });
  }
}

/** Singleton Export */
export const objectRegistry = new ObjectRegistry();
