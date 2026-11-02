/**
 * 能力字符串清单（Issue #368）
 *
 * 这组用例守住两件事：
 * 1. 清单是**唯一**权威来源 —— 守卫 / 方法策略 / SDK 都从 `CAP` 取值，
 *    新增能力只改一处；
 * 2. 校验函数必须把「捏造串」和通配符都判为未知 —— 静默接受等于让人以为
 *    「声明了就生效」，而真实事故里 4 个插件的 addPoints 因此全部失效。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAP,
  CAPABILITIES,
  KNOWN_CAPABILITIES,
  assertValidManifestCapabilities,
  isKnownCapability,
  validateManifestCapabilities,
} from '../catalog.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('能力清单', () => {
  it('19 个资源型能力全部在清单里（与能力矩阵 §1.1 对齐）', () => {
    const resourceCaps = [
      'management:write',
      'management:read',
      'lesson:write',
      'lesson:read',
      'lesson:delete',
      'whiteboard:write',
      'whiteboard:read',
      'plugin:write',
      'plugin:read',
      'vfs:write',
      'vfs:read',
      'process:write',
      'process:read',
      'assignment:manage',
      'assignment:read',
      'assignment:write',
      'assignment:submit',
      'assignment:review',
      'student:write',
    ];
    for (const cap of resourceCaps) expect(isKnownCapability(cap), cap).toBe(true);
  });

  it('方法级能力同样来自同一份清单（method-policy 只做别名）', () => {
    const methodCaps = [
      CAP.API_WRITE,
      CAP.API_ADMIN,
      CAP.GRADES_WRITE,
      CAP.AGENT_TOOL,
      CAP.AI_INVOKE,
      CAP.TASK_REGISTER,
      CAP.STUDENT_DATA_READ,
      CAP.STUDENT_DATA_WRITE,
    ];
    for (const cap of methodCaps) expect(KNOWN_CAPABILITIES.has(cap), cap).toBe(true);
  });

  it('清单无重复项', () => {
    expect(CAPABILITIES.length).toBe(new Set(CAPABILITIES).size);
  });

  it('未知串与通配符被判为未知（不会静默生效）', () => {
    const { valid, unknown } = validateManifestCapabilities([
      CAP.LESSON_READ,
      'storage:write',
      'points:write',
      'student-data:delete',
      '*',
      '*:*',
    ]);
    expect(valid).toBe(false);
    expect(unknown).toEqual(['storage:write', 'points:write', 'student-data:delete', '*', '*:*']);
    expect(validateManifestCapabilities([CAP.LESSON_READ, CAP.STUDENT_DATA_WRITE]).valid).toBe(true);
  });

  it('assert 版本抛出可读错误（构建期自检用）', () => {
    expect(() => assertValidManifestCapabilities(['storage:write'], 'ext-demo')).toThrow(/ext-demo/);
    expect(() => assertValidManifestCapabilities(['storage:write'], 'ext-demo')).toThrow(/storage:write/);
    expect(() => assertValidManifestCapabilities(['storage:write'], 'ext-demo')).toThrow(/合法值只能取自/);
    expect(() => assertValidManifestCapabilities([CAP.MANAGEMENT_READ])).not.toThrow();
  });

  it('能力矩阵文档 §1.1 / §1.2 里的每个字符串都在代码清单中（文档与代码不分叉）', () => {
    const doc = fs.readFileSync(path.join(repoRoot, 'docs/reference/plugin-capability-matrix.md'), 'utf-8');
    const section = doc.split('### 1.3')[0]; // §1.1 + §1.2
    const declared = new Set<string>();
    for (const m of section.matchAll(/^\| `([a-z-]+:[a-z_]+)`/gm)) declared.add(m[1]);
    expect(declared.size).toBeGreaterThanOrEqual(20);
    for (const cap of declared) expect(isKnownCapability(cap), cap).toBe(true);
  });
});
