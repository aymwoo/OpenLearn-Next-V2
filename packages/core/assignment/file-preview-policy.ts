/**
 * 作业附件预览策略 —— **前后端共用的单一事实源**。
 *
 * ## 为什么放这里
 *
 * 前端要判断「这个附件能不能预览、用什么渲染器」，服务端要判断「这个附件
 * 能不能 inline 返回、用什么 Content-Type」。两侧各写一份必然漂移 ——
 * 典型后果是前端认为是图片、后端按 text/plain 返回，或反过来。
 *
 * 纯函数 + 纯类型，不依赖 React / express / better-sqlite3，
 * 与 `packages/core/assessment/` 的做法一致。
 *
 * ## 两条铁律
 *
 * 1. **Content-Type 由服务端按扩展名推导，绝不采信客户端自报的 mime。**
 *    `plugin_assignment_files.mime` 存的是上传时客户端填的 `Content-Type`
 *    （`server/services/assignment-service.ts` 直接存 `req.header('content-type')`），
 *    客户端可以随便填 —— 拿它决定「以什么类型 inline 回浏览器」等于让上传者
 *    决定浏览器的解释方式。
 *
 * 2. **可执行内容一律不 inline。**
 *    `text/html` / `image/svg+xml` / `application/xhtml+xml` 这类内容在浏览器
 *    里是**文档**而不是数据：inline 回去就等于把学生上传的文件变成同源页面，
 *    能读 cookie、能调本平台的 API。因此它们一律 `attachment` 下载。
 *    SVG 仍然可以预览 —— 但只走 `<img>`（图片上下文不执行 SVG 脚本）。
 */

/** 预览类型。`unsupported` 表示宿主不内置渲染，交由扩展插槽接管。 */
export type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported';

/** 参与预览判定的最小文件描述（只需名字，可选 mime/size）。 */
export interface PreviewFileDescriptor {
  /** 原始文件名（含扩展名），如 `方案.pdf`。 */
  name: string;
  /** 客户端自报的 mime（**不可信**，仅作提示，不参与判定）。 */
  mime?: string | null;
  /** 字节数。 */
  size?: number | null;
}

/** 扩展名（小写，含前导点）。取不到时返回空串。 */
export function extensionOf(fileName: string): string {
  if (typeof fileName !== 'string') return '';
  const base = fileName.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

/**
 * 扩展名 → Content-Type（服务端据此设置响应头）。
 *
 * 覆盖 `server/utils/assignment-upload-policy.ts` 白名单里所有能被浏览器
 * 有意义地解释的格式；其余（zip / 各种源码）一律按二进制流处理。
 */
export const PREVIEW_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  // 文档
  '.pdf': 'application/pdf',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // 纯文本 / 代码 / 数据 —— 宿主按文本渲染
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.csv': 'text/plain',
  '.json': 'text/plain',
  '.xml': 'text/plain',
  '.html': 'text/plain',
  '.css': 'text/plain',
  '.py': 'text/plain',
  '.js': 'text/plain',
  '.mjs': 'text/plain',
  '.cjs': 'text/plain',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.java': 'text/plain',
  '.c': 'text/plain',
  '.h': 'text/plain',
  '.cpp': 'text/plain',
  '.cs': 'text/plain',
  '.go': 'text/plain',
  '.rs': 'text/plain',
  '.rb': 'text/plain',
  '.php': 'text/plain',
  '.sql': 'text/plain',
  '.ino': 'text/plain',
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  // 压缩包
  '.zip': 'application/zip',
});

/** 宿主可用 `<img>` 直接渲染的图片扩展名。 */
export const IMAGE_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.heic',
]);

/** 宿主可按文本渲染的扩展名（严格按 text/plain 返回，绝不当 HTML 解析）。 */
export const TEXT_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.css',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.ino',
]);

/**
 * 允许以 `Content-Disposition: inline` 内联返回的 Content-Type。
 *
 * - `application/pdf`：浏览器内置查看器渲染（业界通行做法；PDF 自身的脚本
 *   在浏览器 PDF 沙箱内执行，不与页面同源）。
 * - `text/plain`：配合 `nosniff` 不会被嗅探成 HTML。
 * - 常见位图格式：`<img>` / `<iframe>` 渲染。
 *
 * **不含** `text/html`、`image/svg+xml`、`application/xhtml+xml` —— 它们在
 * 浏览器里是可执行文档，inline 回去等于把上传文件变成同源页面。
 */
export const INLINE_SAFE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

/** 文本预览时最多读取的字节数（超出截断，避免一次拉 50MB 进内存）。 */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

/** 预览结果的完整描述。 */
export interface PreviewStrategy {
  /** 预览类型。 */
  kind: PreviewKind;
  /** 扩展名（小写，含前导点；无扩展名时为空串）。 */
  extension: string;
  /** 服务端推导的 Content-Type（宿主据此决定渲染方式；宿主渲染时按 kind 走）。 */
  contentType: string;
  /** 是否允许 inline 返回（false 时只能下载 / `<img>` 加载）。 */
  inlineSafe: boolean;
  /** 是否可按文本渲染。 */
  asText: boolean;
}

/**
 * 按文件名（必要时参考 mime）判定预览策略。
 *
 * @param file 文件描述
 * @returns {PreviewStrategy}
 */
export function resolvePreviewStrategy(file: PreviewFileDescriptor): PreviewStrategy {
  const extension = extensionOf(file?.name ?? '');
  const contentType = PREVIEW_CONTENT_TYPES[extension] ?? 'application/octet-stream';

  if (extension === '.pdf') {
    return { kind: 'pdf', extension, contentType, inlineSafe: true, asText: false };
  }
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) {
    // SVG 只能用 <img> 加载：图片上下文不执行 SVG 内的脚本；
    // 但**不允许** inline 成顶层文档（那会让它变成可执行页面）。
    return {
      kind: 'image',
      extension,
      contentType,
      inlineSafe: INLINE_SAFE_CONTENT_TYPES.has(contentType),
      asText: false,
    };
  }
  if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
    return { kind: 'text', extension, contentType: 'text/plain', inlineSafe: true, asText: true };
  }
  return { kind: 'unsupported', extension, contentType, inlineSafe: false, asText: false };
}

/**
 * 服务端用：按文件名推导应当返回的 Content-Type。
 *
 * 未知扩展名一律 `application/octet-stream`（下载），**不猜**。
 *
 * @param fileName 原始文件名
 * @returns {string}
 */
export function resolveContentType(fileName: string): string {
  const extension = extensionOf(fileName);
  return PREVIEW_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * 服务端用：该 Content-Type 是否允许 inline 返回。
 *
 * @param contentType 已推导出的 Content-Type
 * @returns {boolean}
 */
export function isInlineSafeContentType(contentType: string): boolean {
  return INLINE_SAFE_CONTENT_TYPES.has((contentType || '').toLowerCase());
}

/**
 * 扩展插槽匹配：某个预览器声明的扩展名集合是否覆盖当前文件。
 *
 * 扩展插槽是**数据型**的（远程插件不能带 React 组件），所以宿主只能问
 * 「这个插件声明能处理 .docx 吗」，再决定要不要给它一个入口。
 *
 * 特殊值 `'*'` 表示**通配**：声明它的预览器对所有文件类型都匹配（兜底型预览器，
 * 例如「把文件交给某个在线转换服务」）。未声明 extensions / mimeTypes 的贡献
 * **不匹配**任何文件 —— 静默出现在每个对话框里的预览器比不出现更糟。
 *
 * @param declared 插件声明的扩展名（可带或不带前导点，大小写不敏感）
 * @param fileExtension 当前文件扩展名（小写，含前导点）
 * @returns {boolean}
 */
export function matchesDeclaredExtension(declared: unknown, fileExtension: string): boolean {
  if (!Array.isArray(declared)) return false;
  const target = (fileExtension || '').toLowerCase();
  const normalizedList = declared
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  if (normalizedList.includes('*')) return true;
  if (!target) return false;
  return normalizedList.some((normalized) => (normalized.startsWith('.') ? normalized : `.${normalized}`) === target);
}
