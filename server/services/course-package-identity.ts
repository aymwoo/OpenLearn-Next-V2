/**
 * 课程包身份（Course Package Identity）—— 判定「这是不是同一个课程包」。
 *
 * ## 为什么需要它
 *
 * `docs/audit/course-import-audit.md` 的 G-06：课程包导入此前**没有任何去重键**。
 * 同一份包导入两次会得到两节同名课程，各自带一整套白板元素与课件附件 ——
 * 清理成本随重复次数线性上升，而用户完全看不出「我是不是导了两次」。
 *
 * 课程包格式本身没有天然主键（不像数据库行有 id），所以这里定义一个**派生身份**：
 *
 * 1. `meta.id`（若包声明了）—— 包的作者给它的稳定标识。优先采用：
 *    教师改了课程标题再导出，身份不变，仍然被认作同一个包。
 * 2. **内容哈希**（缺省）—— 对包的**规范化内容**取 sha256。
 *
 * ## 为什么内容哈希要「规范化」
 *
 * 同一个包两次导出，JSON 的键顺序、空格、数组元素顺序都可能不同（不同工具、
 * 不同版本的导出器）。直接对原始字符串取哈希会得到不同的值，去重就漏了。
 * 因此这里做两件事：
 *
 * - **键排序**：递归地把对象的键按字典序排列后再序列化；
 * - **剔除易变字段**：`assets[].base64` 是附件二进制内容，体积大且每次导出
 *   可能因重新压缩而不同 —— 它已被 `assets[].filename + contentType` 间接标识，
 *   参与哈希只会制造假差异。这里用「附件 id + 文件名 + 类型 + base64 长度」
 *   代替，附件真变了（长度变）仍能被发现。
 *
 * ## 哈希覆盖哪些字段
 *
 * 覆盖**全部会影响落库结果**的部分：教学环节、白板元素、附件清单、课程标题与正文。
 * 唯独不覆盖 `meta.description` / `meta.author` / `meta.tags` —— 这些是展示用的
 * 装饰信息，改了不影响导入产物，把它们算进身份只会制造假差异。
 */
import { createHash } from 'node:crypto';
import type { CoursePackage } from './course-package.js';

/** 派生身份。 */
export interface CoursePackageIdentity {
  /**
   * 去重键 —— 落库到 `lessons.source_package_key`。
   *
   * 形如 `id:<meta.id>` 或 `sha256:<hex>`，前缀让两种来源在值上可区分，
   * 便于事后排查「这节课是按 id 认出的还是按内容认出的」。
   */
  key: string;
  /** 内容哈希（sha256 hex，64 字符）—— 落库到 `lessons.source_package_hash`。 */
  hash: string;
  /** 包声明的 `meta.id`（若有）—— 落库到 `lessons.source_package_id`。 */
  packageId: string | null;
  /** `meta.id` 存在与否 —— 前端据此决定提示文案。 */
  hasDeclaredId: boolean;
}

/**
 * 递归按键排序序列化。
 *
 * 数组**保持原顺序** —— 白板元素的顺序就是画布上的前后关系，排序会改变语义。
 * 对象键排序是为了让「同一份数据、不同键序」得到同一个字符串。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue;
    parts.push(JSON.stringify(key) + ':' + stableStringify(v));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * 取出参与哈希的规范化内容。
 *
 * 刻意排除 `meta.description` / `meta.author` / `meta.tags`（展示用装饰信息）
 * 与 `assets[].base64`（附件二进制，见文件头注释）。
 */
function canonicalContent(pkg: CoursePackage): unknown {
  return {
    version: pkg.version,
    lesson: {
      title: pkg.lesson.title,
      content: pkg.lesson.content,
      progressMode: pkg.lesson.progressMode,
      timeline: pkg.lesson.timeline,
    },
    elements: pkg.elements,
    assets: pkg.assets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      contentType: asset.contentType,
      // 用 base64 长度代替内容本身：附件真的换了（长度变）仍能被发现，
      // 但重新压缩导致的字节差异不会制造假差异。
      base64Length: asset.base64.length,
    })),
  };
}

/**
 * 计算课程包的内容哈希（sha256 hex）。
 *
 * 导出为独立函数，便于测试直接断言「同一内容 → 同一哈希」。
 */
export function computeCoursePackageHash(pkg: CoursePackage): string {
  return createHash('sha256').update(stableStringify(canonicalContent(pkg))).digest('hex');
}

/**
 * 解析课程包身份。
 *
 * `meta.id` 优先：它是包作者显式声明的稳定标识，比内容哈希更抗「改了内容」
 * 带来的漂移。缺省时用内容哈希兜底 —— 这样连没写 `meta.id` 的包（以及
 * 内置模板）也能享受去重。
 */
export function resolveCoursePackageIdentity(pkg: CoursePackage): CoursePackageIdentity {
  const hash = computeCoursePackageHash(pkg);
  const declaredId = typeof pkg.meta?.id === 'string' ? pkg.meta.id.trim() : '';
  if (declaredId) {
    return {
      key: `id:${declaredId}`,
      hash,
      packageId: declaredId,
      hasDeclaredId: true,
    };
  }
  return {
    key: `sha256:${hash}`,
    hash,
    packageId: null,
    hasDeclaredId: false,
  };
}
