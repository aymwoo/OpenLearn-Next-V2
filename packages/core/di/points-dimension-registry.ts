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

  getDimension(id: string): PointsDimensionSpec | undefined {
    return this.dimensions.get(id);
  }

  listDimensions(): PointsDimensionSpec[] {
    return Array.from(this.dimensions.values());
  }
}
