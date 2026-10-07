import { IPointsDimensionRegistry, PointsDimensionSpec } from './interfaces.js';

export class PointsDimensionRegistry implements IPointsDimensionRegistry {
  private dimensions: Map<string, PointsDimensionSpec> = new Map();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    const defaults: PointsDimensionSpec[] = [
      {
        id: 'attendance',
        name: '考勤出勤分',
        category: 'builtin',
        defaultWeight: 0.15,
        maxScore: 100,
        description: '出勤、迟到、请假与缺勤折算得分',
      },
      {
        id: 'progress',
        name: '学习进度分',
        category: 'builtin',
        defaultWeight: 0.25,
        maxScore: 100,
        description: '课时学习进度与完成度折算得分',
      },
      {
        id: 'assignment',
        name: '平时作业分',
        category: 'builtin',
        defaultWeight: 0.35,
        maxScore: 100,
        description: '平时作业提交与教师批改得分',
      },
      {
        id: 'exam',
        name: '期末/大考得分',
        category: 'builtin',
        defaultWeight: 0.25,
        maxScore: 100,
        description: '期末考试与阶段性测验卷面得分',
      },
    ];

    defaults.forEach((dim) => this.registerDimension(dim));
  }

  registerDimension(spec: PointsDimensionSpec): void {
    if (!spec || !spec.id) {
      throw new Error('Points dimension specification must include a valid id');
    }
    this.dimensions.set(spec.id, spec);
  }

  /**
   * 注销维度（审计 D-1）。
   *
   * 拒绝注销 `category === 'builtin'` 的内置维度 —— 平台的三个基础维度
   * （progress / assignment / exam）是所有评分的分母，插件无权移除。
   *
   * @returns 是否真的移除了（内置维度或不存在时返回 false）
   */
  unregisterDimension(id: string): boolean {
    const existing = this.dimensions.get(id);
    if (!existing) return false;
    if (existing.category === 'builtin') {
      console.warn(`[PointsDimensionRegistry] 拒绝注销内置维度 "${id}"`);
      return false;
    }
    return this.dimensions.delete(id);
  }

  getDimension(id: string): PointsDimensionSpec | undefined {
    return this.dimensions.get(id);
  }

  listDimensions(): PointsDimensionSpec[] {
    return Array.from(this.dimensions.values());
  }
}
