/**
 * 课程包（Course Package）前端服务。
 *
 * 课程包是**自包含**的单个 JSON 文档：课程本体 + 教学环节 + 白板元素 + 课件附件
 * （附件以 base64 内联）。教师下载模板 → 改一改 → 拖回导入框，即可得到一节
 * 结构完整的课程，而不是只有标题和正文的空课。
 *
 * 本文件只做 fetch / 文件解析 / 浏览器下载，UI 状态由调用方（useResourceLibrary）管理。
 */

/** 课程包格式标识 —— 与服务端 server/services/course-package.ts 保持一致。 */
export const COURSE_PACKAGE_FORMAT = 'openlearn.course-package';

/** 课程包预览信息（导入框里展示给教师看）。 */
export interface CoursePackagePreview {
  /** 选中的文件名。 */
  fileName: string;
  /** 课程标题。 */
  title: string;
  /** 模板元信息里的名称。 */
  metaName: string;
  /** 教学环节数。 */
  segments: number;
  /** 白板元素数。 */
  elements: number;
  /** 内嵌附件数。 */
  assets: number;
  /** 覆盖的组件类型（去重）。 */
  componentTypes: string[];
}

/** 导入结果摘要。 */
export interface CoursePackageImportResult {
  lessonId: string;
  title: string;
  segments: number;
  elements: number;
  assets: number;
  assetFiles: Array<{ filename: string; fileUrl: string; fileType: string; slideCount: number }>;
  /** 本次导入的课程包去重键。 */
  packageKey?: string;
  /** 内容哈希。 */
  packageHash?: string;
  /** 包声明的 meta.id（可空）。 */
  packageId?: string | null;
  /** 是否为「强制导入的副本」（命中去重后仍导入了）。 */
  duplicate?: boolean;
}

/**
 * 命中去重时服务端返回的冲突信息（HTTP 409）。
 *
 * 「已存在同名课程」不等于「禁止导入」——教师有时确实要导两份
 * （两个班各上一门），所以服务端把冲突信息原样带回，由前端询问后再决定。
 */
export interface CoursePackageDuplicate {
  /** 已存在的课程 id。 */
  lessonId: string;
  /** 已存在的课程标题。 */
  lessonTitle: string;
  /** 已存在课程的创建时间（毫秒时间戳）。 */
  importedAt: number;
  /** 命中的去重键。 */
  packageKey: string;
  /** 包是否声明了 meta.id。 */
  hasDeclaredId: boolean;
}

/**
 * 下载内置课程模板。
 *
 * 走 fetch + blob 而不是直接开新窗口：端点要求教师会话鉴权，
 * 同源 fetch 会自动带上会话 cookie。
 */
export async function downloadCourseTemplate(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/course-packages/template');
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error || '';
      } catch {
        /* 忽略非 JSON 响应体 */
      }
      return { ok: false, error: detail || `模板下载失败（HTTP ${res.status}）` };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'openlearn-course-template.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * 读取并校验一个课程包文件。
 *
 * 只做「是不是课程包」的判定与摘要提取；真正的结构校验在服务端做一次
 * （服务端才是权威 —— 前端校验只是为了给教师一个即时的、友好的提示）。
 */
export async function readCoursePackageFile(
  file: File,
): Promise<{ ok: true; package: any; preview: CoursePackagePreview } | { ok: false; error: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch (err: any) {
    return { ok: false, error: err?.message || '无法读取所选文件' };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是合法的 JSON，无法作为课程包导入' };
  }

  if (!parsed || parsed.format !== COURSE_PACKAGE_FORMAT) {
    return {
      ok: false,
      error: `不是 OpenLearn 课程包文件（format 应为 "${COURSE_PACKAGE_FORMAT}"）`,
    };
  }

  const elements: any[] = Array.isArray(parsed.elements) ? parsed.elements : [];
  const componentTypes = Array.from(new Set(elements.map((el) => String(el?.type || '')).filter(Boolean))).sort();

  return {
    ok: true,
    package: parsed,
    preview: {
      fileName: file.name,
      title: String(parsed?.lesson?.title || '(未命名课程)'),
      metaName: String(parsed?.meta?.name || ''),
      segments: Array.isArray(parsed?.lesson?.timeline) ? parsed.lesson.timeline.length : 0,
      elements: elements.length,
      assets: Array.isArray(parsed?.assets) ? parsed.assets.length : 0,
      componentTypes,
    },
  };
}

/**
 * 提交导入。
 *
 * `allowDuplicate` 为 true 时，即使命中去重（409）也会照常导入一份副本 ——
 * 对应「教师确认过了，我就是要导两份」。
 */
export async function importCoursePackage(
  pkg: any,
  options: { allowDuplicate?: boolean } = {},
): Promise<{
  ok: boolean;
  result?: CoursePackageImportResult;
  error?: string;
  /** 命中去重时的冲突信息（仅 409 时存在）。 */
  duplicate?: CoursePackageDuplicate;
}> {
  try {
    const res = await fetch('/api/course-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkg, allowDuplicate: options.allowDuplicate === true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      const duplicate = body?.duplicate as CoursePackageDuplicate | undefined;
      return {
        ok: false,
        error: body?.error || `课程包导入失败（HTTP ${res.status}）`,
        ...(duplicate ? { duplicate } : {}),
      };
    }
    return { ok: true, result: body.result as CoursePackageImportResult };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
