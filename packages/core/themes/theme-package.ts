import path from 'node:path';
import JSZip from 'jszip';
import { PLATFORM_VERSION } from '../version.js';
import {
  ThemeValidationError,
  normalizeSafeRelativeAssetPath,
  resolveSafeLayouts,
  validateAndSanitizeThemeCss,
  validateThemeManifest,
  type ThemePackageManifest,
  type ValidatedThemeBundle,
} from './theme-spec.js';

export const MAX_THEME_ZIP_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_THEME_UNCOMPRESSED_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_THEME_FILES = 64;

const ALLOWED_EXTENSIONS = new Set([
  '.json',
  '.css',
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.html',
  '.htm',
  '.xhtml',
  '.php',
  '.sh',
  '.bash',
  '.bat',
  '.cmd',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.py',
]);

const UNSAFE_SVG_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /<\s*script/i, reason: 'SVG 资源中禁止包含 <script> 脚本' },
  { pattern: /<\s*foreignObject/i, reason: 'SVG 资源中禁止包含 <foreignObject>' },
  { pattern: /\bon[a-z]+\s*=/i, reason: 'SVG 资源中禁止包含内联事件处理器' },
  { pattern: /javascript\s*:/i, reason: 'SVG 资源中禁止使用 javascript: 协议' },
  { pattern: /(?:https?|ftp):\/\//i, reason: 'SVG 资源中禁止加载外部 HTTP/HTTPS 链接' },
  { pattern: /\bhref\s*=\s*['"]\s*\/\//i, reason: 'SVG 资源中禁止引用协议相对外部 URL' },
];

export interface ParsedThemePackage {
  bundle: ValidatedThemeBundle;
  assets: Map<string, Buffer>;
  zipBytes: number;
}

function validateSvgBuffer(name: string, buf: Buffer): void {
  const rawText = buf.toString('utf8');
  // Allow standard W3C XML namespace declarations (xmlns="http://www.w3.org/2000/svg", etc.)
  const sanitizedForUrlScan = rawText.replace(
    /\bxmlns(?::[a-z0-9_-]+)?\s*=\s*["']https?:\/\/www\.w3\.org\/[^"']*["']/gi,
    '',
  );
  for (const rule of UNSAFE_SVG_PATTERNS) {
    if (rule.pattern.test(sanitizedForUrlScan)) {
      throw new ThemeValidationError('UNSAFE_SVG_ASSET', `${name}: ${rule.reason}`);
    }
  }
}

export async function parseAndValidateThemeZip(
  zipBuffer: Buffer,
  options: { platformVersion?: string } = {},
): Promise<ParsedThemePackage> {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
    throw new ThemeValidationError('EMPTY_ZIP', '主题压缩包不能为空');
  }
  if (zipBuffer.length > MAX_THEME_ZIP_BYTES) {
    throw new ThemeValidationError(
      'ZIP_TOO_LARGE',
      `主题 ZIP 体积 ${(zipBuffer.length / (1024 * 1024)).toFixed(2)} MB 超过上限 ${MAX_THEME_ZIP_BYTES / (1024 * 1024)} MB`,
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    throw new ThemeValidationError('INVALID_ZIP', '无法解压 ZIP 文件，请确认上传的是有效的主题 .zip 压缩包');
  }

  const rawEntries = Object.values(zip.files).filter((f) => !f.dir);
  if (rawEntries.length === 0) {
    throw new ThemeValidationError('EMPTY_ZIP', '主题压缩包内不包含任何文件');
  }
  if (rawEntries.length > MAX_THEME_FILES) {
    throw new ThemeValidationError(
      'TOO_MANY_FILES',
      `主题包文件数 (${rawEntries.length}) 超过上限 (${MAX_THEME_FILES})`,
    );
  }

  // Normalize & validate every archive entry path (supporting optional single root wrapper folder)
  const rawNames = rawEntries.map((e) => e.name);
  let stripPrefix = '';
  const hasRootManifest = rawNames.includes('theme.json');
  if (!hasRootManifest) {
    const nestedManifest = rawNames.find((n) => /^[^/\\]+\/theme\.json$/.test(n));
    if (nestedManifest) {
      stripPrefix = nestedManifest.slice(0, nestedManifest.indexOf('/') + 1);
    }
  }

  const assets = new Map<string, Buffer>();
  let totalUncompressed = 0;

  for (const entry of rawEntries) {
    if ((entry as { unixPermissions?: number | null }).unixPermissions) {
      const mode = (entry as { unixPermissions: number }).unixPermissions;
      if ((mode & 0o170000) === 0o120000) {
        throw new ThemeValidationError('SYMLINK_FORBIDDEN', `禁止主题包包含符号链接 "${entry.name}"`);
      }
    }

    const rawEntryName = entry.name;
    // Check raw path BEFORE prefix stripping for traversal attempts
    if (
      rawEntryName.includes('\0') ||
      rawEntryName.includes('\\') ||
      rawEntryName.startsWith('/') ||
      /^[a-zA-Z]:/.test(rawEntryName) ||
      rawEntryName.split('/').some((seg) => seg === '..')
    ) {
      throw new ThemeValidationError('PATH_TRAVERSAL', `检测到非法文件路径 "${rawEntryName}"`);
    }

    const relativeName =
      stripPrefix && rawEntryName.startsWith(stripPrefix) ? rawEntryName.slice(stripPrefix.length) : rawEntryName;
    const normalized = normalizeSafeRelativeAssetPath(relativeName);
    if (!normalized) {
      throw new ThemeValidationError('INVALID_FILE_PATH', `非法主题文件路径 "${rawEntryName}"`);
    }

    const ext = path.posix.extname(normalized).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
      throw new ThemeValidationError(
        'FORBIDDEN_FILE_TYPE',
        `主题包禁止包含 "${normalized}"（不允许的文件类型 ${ext || '无扩展名'}，主题不允许附带可执行代码或脚本）`,
      );
    }

    const buf = await entry.async('nodebuffer');
    totalUncompressed += buf.length;
    if (totalUncompressed > MAX_THEME_UNCOMPRESSED_BYTES) {
      throw new ThemeValidationError(
        'UNCOMPRESSED_TOO_LARGE',
        `主题包解压后总体积超过 ${MAX_THEME_UNCOMPRESSED_BYTES / (1024 * 1024)} MB 安全上限`,
      );
    }

    if (ext === '.svg') {
      validateSvgBuffer(normalized, buf);
    }

    assets.set(normalized, buf);
  }

  const manifestBuf = assets.get('theme.json');
  if (!manifestBuf) {
    throw new ThemeValidationError('MISSING_MANIFEST', '主题包根目录缺少 theme.json 清单文件');
  }

  let parsedManifestRaw: unknown;
  try {
    parsedManifestRaw = JSON.parse(manifestBuf.toString('utf8'));
  } catch {
    throw new ThemeValidationError('INVALID_MANIFEST_JSON', 'theme.json 不是合法的 JSON 格式');
  }

  const knownAssetSet = new Set(assets.keys());
  const manifest = validateThemeManifest(parsedManifestRaw, {
    platformVersion: options.platformVersion || PLATFORM_VERSION,
    knownAssets: knownAssetSet,
  });

  const targetStyleFile = manifest.stylesFile || (assets.has('styles.css') ? 'styles.css' : undefined);
  let scopedCss = '';
  if (targetStyleFile) {
    const cssBuf = assets.get(targetStyleFile);
    if (!cssBuf) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `声明的样式文件 "${targetStyleFile}" 不存在`);
    }
    scopedCss = validateAndSanitizeThemeCss(cssBuf.toString('utf8'), knownAssetSet);
  }

  const lightTokens = manifest.modes?.light?.tokens || manifest.tokens || {};
  const darkTokens = manifest.modes?.dark?.tokens || manifest.tokens || lightTokens;

  const bundle: ValidatedThemeBundle = {
    manifest,
    modes: {
      light: lightTokens,
      dark: darkTokens,
    },
    typography: manifest.typography || {},
    appearance: manifest.appearance || { borderRadius: 'rounded', cardStyle: 'bordered', density: 'comfortable' },
    layouts: resolveSafeLayouts(manifest.layouts),
    scopedCss,
    assetPaths: Array.from(knownAssetSet).filter((k) => k !== 'theme.json' && k !== targetStyleFile),
  };

  return {
    bundle,
    assets,
    zipBytes: zipBuffer.length,
  };
}

export async function buildThemeZipBuffer(input: {
  manifest: ThemePackageManifest;
  stylesCss?: string;
  assets?: Record<string, Buffer>;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('theme.json', JSON.stringify(input.manifest, null, 2));
  const styleName = input.manifest.stylesFile || 'styles.css';
  if (input.stylesCss && input.stylesCss.trim().length > 0) {
    zip.file(styleName, input.stylesCss);
  }
  if (input.assets) {
    for (const [assetPath, buf] of Object.entries(input.assets)) {
      const safe = normalizeSafeRelativeAssetPath(assetPath);
      if (safe && safe !== 'theme.json' && safe !== styleName) {
        zip.file(safe, buf);
      }
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
