import { describe, it, expect } from 'vitest';
import { buildTemplateCoursePackage } from '../services/course-package.js';
import {
  computeCoursePackageHash,
  resolveCoursePackageIdentity,
} from '../services/course-package-identity.js';

/**
 * 课程包身份（G-06 去重键的派生规则）。
 *
 * 这里钉的是**判定语义**，不是实现细节：
 * - 同一份包的不同 JSON 写法（键序不同）必须得到同一个哈希；
 * - 影响落库结果的字段变了，哈希必须变；
 * - 纯展示字段（description/author/tags）变了，哈希不该变 —— 否则
 *   「改个描述」就会让去重失效，教师会莫名其妙地能重复导入同一门课；
 * - 声明了 meta.id 就用 id，不看内容。
 */
describe('course package identity', () => {
  it('produces the same hash regardless of object key order', async () => {
    const pkg = await buildTemplateCoursePackage();
    // 重建一份「键序完全反过来」的等价对象
    const reordered = JSON.parse(JSON.stringify(pkg));
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(reordered).reverse()) {
      reversed[key] = reordered[key];
    }
    // 元素内部的键也反过来
    reversed.elements = (reordered.elements as any[]).map((el) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(el).reverse()) out[k] = el[k];
      return out;
    });

    expect(computeCoursePackageHash(reversed as any)).toBe(computeCoursePackageHash(pkg));
  });

  it('changes the hash when the lesson content changes', async () => {
    const pkg = await buildTemplateCoursePackage();
    const before = computeCoursePackageHash(pkg);
    pkg.lesson.content = '完全不同的正文';
    expect(computeCoursePackageHash(pkg)).not.toBe(before);
  });

  it('changes the hash when a whiteboard element changes', async () => {
    const pkg = await buildTemplateCoursePackage();
    const before = computeCoursePackageHash(pkg);
    (pkg.elements[0].data as any).tampered = true;
    expect(computeCoursePackageHash(pkg)).not.toBe(before);
  });

  it('ignores decorative meta fields (description / author / tags)', async () => {
    // 这几个字段不参与落库，改它们不应该让去重失效 ——
    // 否则「改个描述就能重复导入同一门课」，幂等形同虚设。
    const pkg = await buildTemplateCoursePackage();
    const before = computeCoursePackageHash(pkg);
    pkg.meta.description = '改过的描述';
    pkg.meta.author = '另一个人';
    pkg.meta.tags = ['新标签'];
    expect(computeCoursePackageHash(pkg)).toBe(before);
  });

  it('falls back to the content hash when meta.id is absent', async () => {
    const pkg = await buildTemplateCoursePackage();
    expect(pkg.meta.id).toBeUndefined();
    const identity = resolveCoursePackageIdentity(pkg);
    expect(identity.hasDeclaredId).toBe(false);
    expect(identity.packageId).toBeNull();
    expect(identity.key).toBe(`sha256:${identity.hash}`);
    expect(identity.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('prefers meta.id over the content hash', async () => {
    const pkg = await buildTemplateCoursePackage();
    pkg.meta = { ...pkg.meta, id: 'declared-id-1' };
    const identity = resolveCoursePackageIdentity(pkg);
    expect(identity.key).toBe('id:declared-id-1');
    expect(identity.packageId).toBe('declared-id-1');
    expect(identity.hasDeclaredId).toBe(true);

    // 改了内容，键不变（这正是 meta.id 的价值），但 hash 会变（内容确实变了）
    const beforeHash = identity.hash;
    pkg.lesson.title = '改名 + 改内容';
    const after = resolveCoursePackageIdentity(pkg);
    expect(after.key).toBe('id:declared-id-1');
    expect(after.hash).not.toBe(beforeHash);
  });

  it('treats a blank meta.id as absent', async () => {
    const pkg = await buildTemplateCoursePackage();
    pkg.meta = { ...pkg.meta, id: '   ' };
    const identity = resolveCoursePackageIdentity(pkg);
    expect(identity.hasDeclaredId).toBe(false);
    expect(identity.key.startsWith('sha256:')).toBe(true);
  });
});
