import semver from 'semver';
import { isBlockedExternalFontUrl } from '../security/font-sanitizer.js';

export const DEFAULT_PLATFORM_VERSION = '0.7.15';

export const BUILTIN_THEME_IDS = ['light', 'dark', 'eyecare', 'chalkboard'] as const;
export type BuiltinThemeIdLiteral = (typeof BUILTIN_THEME_IDS)[number];

export type ThemeColorMode = 'light' | 'dark' | 'auto';
export type ThemeDensity = 'compact' | 'comfortable' | 'spacious';
export type ThemeBorderRadius = 'sharp' | 'rounded' | 'pill';
export type ThemeCardStyle = 'flat' | 'bordered' | 'elevated' | 'glass';

export type LoginArrangement = 'centered' | 'split-left' | 'split-right' | 'top-banner';
export type LoginRegionId = 'brand' | 'auth-form' | 'seed-hint';

export type TeacherNavPosition = 'left' | 'right' | 'top';
export type TeacherRegionId = 'nav' | 'workspace';

export type StudentHeaderPosition = 'top' | 'bottom';
export type StudentRegionId = 'status-banner' | 'main-content' | 'quick-tools';

export type AdminNavStyle = 'tabs' | 'sidebar-left' | 'sidebar-right';
export type AdminSectionId = 'overview' | 'users' | 'site-settings' | 'themes' | 'diagnostics';

export interface ThemeFontFaceSpec {
  family: string;
  src: string;
  weight?: string;
  style?: string;
}

export interface ThemeTypographySpec {
  fontSans?: string;
  fontDisplay?: string;
  fontMono?: string;
  baseScale?: number;
  fontFaces?: ThemeFontFaceSpec[];
}

export interface ThemeAppearanceSpec {
  borderRadius?: ThemeBorderRadius;
  cardStyle?: ThemeCardStyle;
  density?: ThemeDensity;
  accentPattern?: 'none' | 'dots' | 'grid' | 'gradient';
  backgroundImage?: string;
}

export interface ThemeLayoutsSpec {
  login?: {
    arrangement?: LoginArrangement;
    order?: LoginRegionId[];
    cardPosition?: 'start' | 'center' | 'end';
  };
  teacher?: {
    navPosition?: TeacherNavPosition;
    contentMaxWidth?: 'full' | 'wide' | 'focused';
  };
  student?: {
    headerPosition?: StudentHeaderPosition;
    order?: StudentRegionId[];
    cardColumns?: 1 | 2 | 3;
  };
  admin?: {
    navStyle?: AdminNavStyle;
    sectionOrder?: AdminSectionId[];
  };
}

export interface ResolvedThemeLayouts {
  login: {
    arrangement: LoginArrangement;
    order: LoginRegionId[];
    cardPosition: 'start' | 'center' | 'end';
  };
  teacher: {
    navPosition: TeacherNavPosition;
    contentMaxWidth: 'full' | 'wide' | 'focused';
  };
  student: {
    headerPosition: StudentHeaderPosition;
    order: StudentRegionId[];
    cardColumns: 1 | 2 | 3;
  };
  admin: {
    navStyle: AdminNavStyle;
    sectionOrder: AdminSectionId[];
  };
}

export interface ThemeModeSpec {
  tokens: Record<string, string>;
}

export interface ThemeCompatibilitySpec {
  minPlatformVersion?: string;
  maxPlatformVersion?: string;
}

export interface ThemeSettingsCapabilities {
  accentColor?: boolean;
  borderRadius?: boolean;
  density?: boolean;
  fontScale?: boolean;
  mode?: boolean;
}

export interface ThemePackageManifest {
  schemaVersion?: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  defaultMode?: 'light' | 'dark' | 'auto';
  compatibility?: ThemeCompatibilitySpec;
  tokens?: Record<string, string>;
  modes?: {
    light?: ThemeModeSpec;
    dark?: ThemeModeSpec;
  };
  typography?: ThemeTypographySpec;
  appearance?: ThemeAppearanceSpec;
  layouts?: ThemeLayoutsSpec;
  stylesFile?: string;
  previewImage?: string;
  changelog?: string;
  settingsCapabilities?: ThemeSettingsCapabilities;
}

export interface ThemeAppearanceOverrides {
  primaryColor?: string;
  borderRadius?: ThemeBorderRadius;
  density?: ThemeDensity;
  fontScale?: number;
}

export interface ValidatedThemeBundle {
  manifest: ThemePackageManifest;
  modes: {
    light: Record<string, string>;
    dark: Record<string, string>;
  };
  typography: ThemeTypographySpec;
  appearance: ThemeAppearanceSpec;
  layouts: ResolvedThemeLayouts;
  scopedCss: string;
  assetPaths: string[];
}

export interface UnifiedPluginThemePayload {
  theme: string;
  colorScheme: 'light' | 'dark';
  tokens: Record<string, string>;
  appearance: {
    borderRadius: ThemeBorderRadius;
    cardStyle: ThemeCardStyle;
    density: ThemeDensity;
    fontScale: number;
  };
  fonts: {
    sans: string;
    display: string;
    mono: string;
  };
}

export const DEFAULT_LAYOUTS: ResolvedThemeLayouts = {
  login: {
    arrangement: 'centered',
    order: ['brand', 'auth-form', 'seed-hint'],
    cardPosition: 'center',
  },
  teacher: {
    navPosition: 'left',
    contentMaxWidth: 'full',
  },
  student: {
    headerPosition: 'top',
    order: ['status-banner', 'main-content', 'quick-tools'],
    cardColumns: 2,
  },
  admin: {
    navStyle: 'tabs',
    sectionOrder: ['overview', 'users', 'site-settings', 'themes', 'diagnostics'],
  },
};

export const REQUIRED_LOGIN_REGIONS: readonly LoginRegionId[] = ['brand', 'auth-form', 'seed-hint'];
export const REQUIRED_STUDENT_REGIONS: readonly StudentRegionId[] = ['status-banner', 'main-content', 'quick-tools'];
export const REQUIRED_ADMIN_SECTIONS: readonly AdminSectionId[] = [
  'overview',
  'users',
  'site-settings',
  'themes',
  'diagnostics',
];

const THEME_ID_REGEX = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const ALLOWED_TOKEN_KEY_REGEX = /^--[a-z0-9][a-z0-9-]{1,63}$/;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const DANGEROUS_CSS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /@import\b/i, reason: '禁止在主题样式中使用 @import 加载外部样式表' },
  { pattern: /@charset\b/i, reason: '禁止在主题样式中使用 @charset' },
  { pattern: /<\s*script/i, reason: '禁止包含 <script> 脚本标签' },
  { pattern: /javascript\s*:/i, reason: '禁止使用 javascript: 协议' },
  { pattern: /vbscript\s*:/i, reason: '禁止使用 vbscript: 协议' },
  { pattern: /expression\s*\(/i, reason: '禁止使用不安全的 CSS expression()' },
  { pattern: /-moz-binding\s*:/i, reason: '禁止使用 -moz-binding 扩展属性' },
  { pattern: /behavior\s*:/i, reason: '禁止使用 IE behavior 属性' },
  {
    pattern: /(?:https?|ftp|ws|wss):\/\//i,
    reason: '禁止主题加载任何外部 HTTP/HTTPS 资源，所有图片和字体需随 ZIP 提供',
  },
  { pattern: /url\(\s*['"]?\s*\/\//i, reason: '禁止使用协议相对 URL (//) 加载外部资源' },
  { pattern: /data\s*:\s*(?:text\/html|application\/javascript|text\/javascript)/i, reason: '禁止使用可执行 Data URI' },
];

export class ThemeValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ThemeValidationError';
    this.code = code;
  }
}

export function isBuiltinThemeId(id: string): id is BuiltinThemeIdLiteral {
  return (BUILTIN_THEME_IDS as readonly string[]).includes(id);
}

/** Deduplicate and preserve every mandatory region so layouts can rearrange without hiding critical actions. */
function mergeRequiredOrder<T extends string>(provided: readonly T[] | undefined, required: readonly T[]): T[] {
  const allowedSet = new Set<string>(required);
  const out: T[] = [];
  if (Array.isArray(provided)) {
    for (const item of provided) {
      if (allowedSet.has(item) && !out.includes(item)) {
        out.push(item);
      }
    }
  }
  for (const req of required) {
    if (!out.includes(req)) {
      out.push(req);
    }
  }
  return out;
}

export function resolveSafeLayouts(raw?: ThemeLayoutsSpec | null): ResolvedThemeLayouts {
  if (!raw || typeof raw !== 'object') {
    return {
      login: { ...DEFAULT_LAYOUTS.login, order: [...DEFAULT_LAYOUTS.login.order] },
      teacher: { ...DEFAULT_LAYOUTS.teacher },
      student: { ...DEFAULT_LAYOUTS.student, order: [...DEFAULT_LAYOUTS.student.order] },
      admin: { ...DEFAULT_LAYOUTS.admin, sectionOrder: [...DEFAULT_LAYOUTS.admin.sectionOrder] },
    };
  }

  const loginArrangement: LoginArrangement =
    raw.login?.arrangement && ['centered', 'split-left', 'split-right', 'top-banner'].includes(raw.login.arrangement)
      ? raw.login.arrangement
      : 'centered';
  const loginCardPos =
    raw.login?.cardPosition && ['start', 'center', 'end'].includes(raw.login.cardPosition)
      ? raw.login.cardPosition
      : 'center';

  const teacherNavPos: TeacherNavPosition =
    raw.teacher?.navPosition && ['left', 'right', 'top'].includes(raw.teacher.navPosition)
      ? raw.teacher.navPosition
      : 'left';
  const teacherMaxWidth =
    raw.teacher?.contentMaxWidth && ['full', 'wide', 'focused'].includes(raw.teacher.contentMaxWidth)
      ? raw.teacher.contentMaxWidth
      : 'full';

  const studentHeaderPos: StudentHeaderPosition =
    raw.student?.headerPosition && ['top', 'bottom'].includes(raw.student.headerPosition)
      ? raw.student.headerPosition
      : 'top';
  const studentCols =
    raw.student?.cardColumns === 1 || raw.student?.cardColumns === 2 || raw.student?.cardColumns === 3
      ? raw.student.cardColumns
      : 2;

  const adminNavStyle: AdminNavStyle =
    raw.admin?.navStyle && ['tabs', 'sidebar-left', 'sidebar-right'].includes(raw.admin.navStyle)
      ? raw.admin.navStyle
      : 'tabs';

  return {
    login: {
      arrangement: loginArrangement,
      order: mergeRequiredOrder(raw.login?.order, REQUIRED_LOGIN_REGIONS),
      cardPosition: loginCardPos,
    },
    teacher: {
      navPosition: teacherNavPos,
      contentMaxWidth: teacherMaxWidth,
    },
    student: {
      headerPosition: studentHeaderPos,
      order: mergeRequiredOrder(raw.student?.order, REQUIRED_STUDENT_REGIONS),
      cardColumns: studentCols,
    },
    admin: {
      navStyle: adminNavStyle,
      sectionOrder: mergeRequiredOrder(raw.admin?.sectionOrder, REQUIRED_ADMIN_SECTIONS),
    },
  };
}

export function normalizeSafeRelativeAssetPath(rawPath: string): string | null {
  if (typeof rawPath !== 'string') return null;
  const trimmed = rawPath.trim().replace(/^\.\//, '');
  if (!trimmed || trimmed.includes('\0') || trimmed.includes('\\') || trimmed.startsWith('/')) return null;
  if (/^[a-zA-Z]:/.test(trimmed)) return null;
  if (/^(?:https?|ftp|javascript|data|vbscript|blob):/i.test(trimmed)) return null;
  const segments = trimmed.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) return null;
  return segments.join('/');
}

export function sanitizeCssTokenValue(key: string, value: string, knownAssets?: Set<string>): string {
  if (!ALLOWED_TOKEN_KEY_REGEX.test(key)) {
    throw new ThemeValidationError('INVALID_TOKEN_NAME', `无效的 CSS 变量名 "${key}"（仅允许 --kebab-case 格式）`);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new ThemeValidationError('INVALID_TOKEN_VALUE', `主题变量 "${key}" 的值不能为空`);
  }
  if (value.length > 512) {
    throw new ThemeValidationError('INVALID_TOKEN_VALUE', `主题变量 "${key}" 的值过长`);
  }
  if (/[{};<>]/.test(value)) {
    throw new ThemeValidationError('UNSAFE_CSS_TOKEN', `主题变量 "${key}" 包含非法字符`);
  }
  for (const rule of DANGEROUS_CSS_PATTERNS) {
    if (rule.pattern.test(value)) {
      throw new ThemeValidationError('UNSAFE_CSS', `${rule.reason}（变量 ${key}）`);
    }
  }
  // Validate any url(...) token points to a packaged asset
  const urlMatches = [...value.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)];
  for (const m of urlMatches) {
    const ref = m[1]?.trim() || '';
    if (ref.startsWith('data:image/') || ref.startsWith('data:font/')) {
      continue;
    }
    const safeRel = normalizeSafeRelativeAssetPath(ref);
    if (!safeRel) {
      throw new ThemeValidationError('UNSAFE_ASSET_URL', `变量 "${key}" 引用了非法资源路径 "${ref}"`);
    }
    if (knownAssets && !knownAssets.has(safeRel)) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `变量 "${key}" 引用的资源 "${safeRel}" 不在主题包中`);
    }
  }
  return value.trim();
}

export function validateAndSanitizeThemeCss(
  rawCss: string,
  knownAssets?: Set<string>,
  rewriteAssetUrl?: (assetPath: string) => string,
): string {
  if (typeof rawCss !== 'string') return '';
  if (rawCss.length > 256 * 1024) {
    throw new ThemeValidationError('CSS_TOO_LARGE', 'styles.css 体积超出 256KB 上限');
  }
  for (const rule of DANGEROUS_CSS_PATTERNS) {
    if (rule.pattern.test(rawCss)) {
      throw new ThemeValidationError('UNSAFE_CSS', rule.reason);
    }
  }
  // Reject position:fixed overlays targeting full viewport clicks/pointer-events hijack if suspicious? Allow styling cleanly while disallowing unknown protocols.
  let output = rawCss;
  output = output.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_full, _quote, rawRef: string) => {
    const trimmedRef = rawRef.trim();
    if (/^data:(?:image|font)\//i.test(trimmedRef) || trimmedRef.startsWith('#')) {
      return `url('${trimmedRef}')`;
    }
    const normalized = normalizeSafeRelativeAssetPath(trimmedRef);
    if (!normalized) {
      throw new ThemeValidationError('UNSAFE_ASSET_URL', `样式中引用了非法资源路径 "${trimmedRef}"`);
    }
    if (knownAssets && !knownAssets.has(normalized)) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `样式中引用的资源 "${normalized}" 未随主题 ZIP 提供`);
    }
    const finalUrl = rewriteAssetUrl ? rewriteAssetUrl(normalized) : normalized;
    return `url('${finalUrl}')`;
  });
  return output;
}

export function checkPlatformCompatibility(
  compatibility?: ThemeCompatibilitySpec,
  platformVersion: string = DEFAULT_PLATFORM_VERSION,
): { compatible: boolean; reason?: string } {
  const current = semver.coerce(platformVersion)?.version || DEFAULT_PLATFORM_VERSION;
  if (!compatibility) return { compatible: true };

  if (compatibility.minPlatformVersion) {
    const min = semver.valid(compatibility.minPlatformVersion);
    if (!min) {
      return {
        compatible: false,
        reason: `无效的 minPlatformVersion "${compatibility.minPlatformVersion}"（需要 X.Y.Z 语义版本号）`,
      };
    }
    if (semver.lt(current, min)) {
      return {
        compatible: false,
        reason: `当前平台版本 (${current}) 低于主题最低要求版本 (${min})`,
      };
    }
  }

  if (compatibility.maxPlatformVersion) {
    const max = semver.valid(compatibility.maxPlatformVersion);
    if (!max) {
      return {
        compatible: false,
        reason: `无效的 maxPlatformVersion "${compatibility.maxPlatformVersion}"（需要 X.Y.Z 语义版本号）`,
      };
    }
    if (semver.gt(current, max)) {
      return {
        compatible: false,
        reason: `当前平台版本 (${current}) 高于主题声明兼容上限 (${max})`,
      };
    }
  }

  return { compatible: true };
}

export function validateThemeManifest(
  raw: unknown,
  options: { platformVersion?: string; knownAssets?: Set<string> } = {},
): ThemePackageManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ThemeValidationError('INVALID_MANIFEST', 'theme.json 必须是合法的 JSON 对象');
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!THEME_ID_REGEX.test(id)) {
    throw new ThemeValidationError(
      'INVALID_THEME_ID',
      'theme.json 中的 id 必须是 2-63 位小写字母、数字、点或连字符（如 campus-atelier）',
    );
  }
  if (isBuiltinThemeId(id)) {
    throw new ThemeValidationError('RESERVED_THEME_ID', `主题 ID "${id}" 为系统保留内置主题，不能被覆盖`);
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name || name.length > 80) {
    throw new ThemeValidationError('INVALID_THEME_NAME', 'theme.json 中的 name 不能为空且不超过 80 个字符');
  }

  const version = typeof obj.version === 'string' ? obj.version.trim() : '';
  if (!semver.valid(version)) {
    throw new ThemeValidationError('INVALID_THEME_VERSION', `theme.json 中的 version "${version}" 不是合法语义版本号`);
  }

  const compatibility = obj.compatibility as ThemeCompatibilitySpec | undefined;
  const compatResult = checkPlatformCompatibility(compatibility, options.platformVersion);
  if (!compatResult.compatible) {
    throw new ThemeValidationError('INCOMPATIBLE_PLATFORM', compatResult.reason || '主题与当前平台版本不兼容');
  }

  const topTokens = obj.tokens as Record<string, string> | undefined;
  const modes = obj.modes as ThemePackageManifest['modes'] | undefined;
  const hasLightTokens = Boolean(modes?.light?.tokens && Object.keys(modes.light.tokens).length > 0);
  const hasDarkTokens = Boolean(modes?.dark?.tokens && Object.keys(modes.dark.tokens).length > 0);
  const hasTopTokens = Boolean(topTokens && Object.keys(topTokens).length > 0);
  if (!hasLightTokens && !hasDarkTokens && !hasTopTokens) {
    throw new ThemeValidationError('MISSING_TOKENS', 'theme.json 至少需要提供 tokens 或 modes.light/dark 配色令牌');
  }

  const sanitizeTokenMap = (map?: Record<string, unknown>): Record<string, string> => {
    const clean: Record<string, string> = {};
    if (!map || typeof map !== 'object') return clean;
    for (const [k, v] of Object.entries(map)) {
      clean[k] = sanitizeCssTokenValue(k, String(v ?? ''), options.knownAssets);
    }
    return clean;
  };

  const sanitizedTopTokens = topTokens ? sanitizeTokenMap(topTokens) : undefined;
  const sanitizedModes: ThemePackageManifest['modes'] = {};
  if (modes?.light?.tokens) {
    sanitizedModes.light = { tokens: sanitizeTokenMap(modes.light.tokens) };
  }
  if (modes?.dark?.tokens) {
    sanitizedModes.dark = { tokens: sanitizeTokenMap(modes.dark.tokens) };
  }

  // Validate typography fontFaces
  const rawTypo = obj.typography as ThemeTypographySpec | undefined;
  let cleanTypo: ThemeTypographySpec | undefined;
  if (rawTypo) {
    if (typeof rawTypo !== 'object') {
      throw new ThemeValidationError('INVALID_TYPOGRAPHY', 'typography 必须是对象');
    }
    cleanTypo = {
      fontSans: rawTypo.fontSans ? String(rawTypo.fontSans).slice(0, 200) : undefined,
      fontDisplay: rawTypo.fontDisplay ? String(rawTypo.fontDisplay).slice(0, 200) : undefined,
      fontMono: rawTypo.fontMono ? String(rawTypo.fontMono).slice(0, 200) : undefined,
      baseScale:
        typeof rawTypo.baseScale === 'number' && rawTypo.baseScale >= 0.85 && rawTypo.baseScale <= 1.25
          ? rawTypo.baseScale
          : undefined,
      fontFaces: [],
    };
    for (const ff of rawTypo.fontFaces || []) {
      if (!ff || typeof ff.family !== 'string' || typeof ff.src !== 'string') {
        throw new ThemeValidationError('INVALID_FONT_FACE', 'fontFaces 条目缺少 family 或 src');
      }
      const rel = normalizeSafeRelativeAssetPath(ff.src);
      if (!rel) {
        throw new ThemeValidationError(
          'UNSAFE_FONT_SRC',
          `字体文件 "${ff.src}" 必须是主题包内的安全相对路径，禁止外部 URL`,
        );
      }
      if (options.knownAssets && !options.knownAssets.has(rel)) {
        throw new ThemeValidationError('MISSING_THEME_ASSET', `声明的字体文件 "${rel}" 未在主题包中找到`);
      }
      cleanTypo.fontFaces!.push({
        family: ff.family.replace(/["';{}<>]/g, '').trim(),
        src: rel,
        weight: ff.weight ? String(ff.weight).replace(/[;{}<>]/g, '') : undefined,
        style: ff.style ? String(ff.style).replace(/[;{}<>]/g, '') : undefined,
      });
    }
  }

  // Validate previewImage and stylesFile
  let stylesFile: string | undefined;
  if (typeof obj.stylesFile === 'string' && obj.stylesFile.trim()) {
    const rel = normalizeSafeRelativeAssetPath(obj.stylesFile);
    if (!rel || !rel.endsWith('.css')) {
      throw new ThemeValidationError('INVALID_STYLES_FILE', 'stylesFile 必须是包内的合法 .css 相对路径');
    }
    if (options.knownAssets && !options.knownAssets.has(rel)) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `声明的样式文件 "${rel}" 未在主题包中找到`);
    }
    stylesFile = rel;
  }

  let previewImage: string | undefined;
  if (typeof obj.previewImage === 'string' && obj.previewImage.trim()) {
    const rel = normalizeSafeRelativeAssetPath(obj.previewImage);
    if (!rel) {
      throw new ThemeValidationError('INVALID_PREVIEW_IMAGE', 'previewImage 必须是包内相对路径，禁止外部 URL');
    }
    if (options.knownAssets && !options.knownAssets.has(rel)) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `预览图 "${rel}" 未在主题包中找到`);
    }
    previewImage = rel;
  }

  // Validate layouts
  const rawLayouts = obj.layouts as ThemeLayoutsSpec | undefined;
  if (rawLayouts?.login?.order) {
    for (const r of rawLayouts.login.order) {
      if (!REQUIRED_LOGIN_REGIONS.includes(r)) {
        throw new ThemeValidationError('INVALID_LAYOUT_REGION', `登录页布局包含未知区域 "${String(r)}"`);
      }
    }
    if (!rawLayouts.login.order.includes('auth-form')) {
      throw new ThemeValidationError('MISSING_REQUIRED_REGION', '登录页布局必须保留 auth-form 登录操作区');
    }
  }
  if (rawLayouts?.student?.order) {
    for (const r of rawLayouts.student.order) {
      if (!REQUIRED_STUDENT_REGIONS.includes(r)) {
        throw new ThemeValidationError('INVALID_LAYOUT_REGION', `学生页布局包含未知区域 "${String(r)}"`);
      }
    }
    if (!rawLayouts.student.order.includes('main-content')) {
      throw new ThemeValidationError('MISSING_REQUIRED_REGION', '学生页布局必须保留 main-content 主学习区域');
    }
  }
  if (rawLayouts?.admin?.sectionOrder) {
    for (const r of rawLayouts.admin.sectionOrder) {
      if (!REQUIRED_ADMIN_SECTIONS.includes(r)) {
        throw new ThemeValidationError('INVALID_LAYOUT_REGION', `管理页布局包含未知分区 "${String(r)}"`);
      }
    }
    for (const mustHave of ['users', 'site-settings', 'themes'] as const) {
      if (!rawLayouts.admin.sectionOrder.includes(mustHave)) {
        throw new ThemeValidationError('MISSING_REQUIRED_REGION', `管理页布局必须保留关键分区 "${mustHave}"`);
      }
    }
  }

  // Validate appearance.backgroundImage if present
  const rawApp = obj.appearance as ThemeAppearanceSpec | undefined;
  if (rawApp?.backgroundImage) {
    const rel = normalizeSafeRelativeAssetPath(rawApp.backgroundImage);
    if (!rel) {
      throw new ThemeValidationError('UNSAFE_ASSET_URL', 'appearance.backgroundImage 必须是主题包内的相对资源路径');
    }
    if (options.knownAssets && !options.knownAssets.has(rel)) {
      throw new ThemeValidationError('MISSING_THEME_ASSET', `背景资源 "${rel}" 未在主题包中找到`);
    }
  }

  return {
    schemaVersion: 1,
    id,
    name,
    version: semver.valid(version)!,
    description: typeof obj.description === 'string' ? obj.description.slice(0, 500) : '',
    author: typeof obj.author === 'string' ? obj.author.slice(0, 100) : '',
    defaultMode:
      obj.defaultMode === 'dark' || obj.defaultMode === 'light' || obj.defaultMode === 'auto'
        ? obj.defaultMode
        : 'light',
    compatibility,
    tokens: sanitizedTopTokens,
    modes: sanitizedModes,
    typography: cleanTypo,
    appearance: rawApp
      ? {
          borderRadius:
            rawApp.borderRadius && ['sharp', 'rounded', 'pill'].includes(rawApp.borderRadius)
              ? rawApp.borderRadius
              : 'rounded',
          cardStyle:
            rawApp.cardStyle && ['flat', 'bordered', 'elevated', 'glass'].includes(rawApp.cardStyle)
              ? rawApp.cardStyle
              : 'bordered',
          density:
            rawApp.density && ['compact', 'comfortable', 'spacious'].includes(rawApp.density)
              ? rawApp.density
              : 'comfortable',
          accentPattern:
            rawApp.accentPattern && ['none', 'dots', 'grid', 'gradient'].includes(rawApp.accentPattern)
              ? rawApp.accentPattern
              : 'none',
          backgroundImage: rawApp.backgroundImage
            ? normalizeSafeRelativeAssetPath(rawApp.backgroundImage) || undefined
            : undefined,
        }
      : undefined,
    layouts: rawLayouts,
    stylesFile,
    previewImage,
    changelog: typeof obj.changelog === 'string' ? obj.changelog.slice(0, 1000) : undefined,
    settingsCapabilities: (obj.settingsCapabilities as ThemeSettingsCapabilities | undefined) ?? {
      accentColor: true,
      borderRadius: true,
      density: true,
      fontScale: true,
      mode: true,
    },
  };
}

export function sanitizeHexColor(hex: string | undefined): string | null {
  if (!hex || typeof hex !== 'string') return null;
  const trimmed = hex.trim();
  return HEX_COLOR_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Generates CSS rules containing `:root[data-theme="..."]` tokens, appearance tokens,
 * typography @font-face declarations, and sanitized custom stylesheet.
 */
export function buildRuntimeThemeCss(
  bundle: ValidatedThemeBundle,
  activeMode: 'light' | 'dark',
  overrides: ThemeAppearanceOverrides = {},
  assetUrlResolver?: (relPath: string) => string,
): { cssText: string; effectiveTokens: Record<string, string>; effectiveMode: 'light' | 'dark' } {
  const modeTokens =
    activeMode === 'dark'
      ? { ...bundle.modes.light, ...bundle.modes.dark }
      : { ...bundle.modes.dark, ...bundle.modes.light };

  const primaryOverride = sanitizeHexColor(overrides.primaryColor);
  const borderRadius = overrides.borderRadius || bundle.appearance.borderRadius || 'rounded';
  const density = overrides.density || bundle.appearance.density || 'comfortable';
  const fontScale =
    typeof overrides.fontScale === 'number' && overrides.fontScale >= 0.85 && overrides.fontScale <= 1.25
      ? overrides.fontScale
      : bundle.typography.baseScale || 1;

  const radiusCardMap: Record<ThemeBorderRadius, string> = {
    sharp: '0.25rem',
    rounded: '0.875rem',
    pill: '1.5rem',
  };
  const radiusControlMap: Record<ThemeBorderRadius, string> = {
    sharp: '0.2rem',
    rounded: '0.625rem',
    pill: '9999px',
  };
  const densityGapMap: Record<ThemeDensity, string> = {
    compact: '0.75rem',
    comfortable: '1.25rem',
    spacious: '1.75rem',
  };
  const shadowCardMap: Record<ThemeCardStyle, string> = {
    flat: 'none',
    bordered: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
    elevated: '0 10px 28px -6px rgb(15 23 42 / 0.14)',
    glass: '0 8px 32px 0 rgb(15 23 42 / 0.12)',
  };

  const effectiveTokens: Record<string, string> = {
    ...modeTokens,
    '--ol-radius-card': radiusCardMap[borderRadius],
    '--ol-radius-control': radiusControlMap[borderRadius],
    '--ol-density-gap': densityGapMap[density],
    '--ol-shadow-card': shadowCardMap[bundle.appearance.cardStyle || 'bordered'],
    '--ol-font-scale': String(fontScale),
  };

  if (bundle.typography.fontSans) {
    effectiveTokens['--ol-font-sans'] = bundle.typography.fontSans;
    effectiveTokens['--font-sans'] = bundle.typography.fontSans;
  }
  if (bundle.typography.fontDisplay) {
    effectiveTokens['--ol-font-display'] = bundle.typography.fontDisplay;
  }
  if (bundle.typography.fontMono) {
    effectiveTokens['--ol-font-mono'] = bundle.typography.fontMono;
  }
  if (primaryOverride) {
    effectiveTokens['--color-primary'] = primaryOverride;
    effectiveTokens['--primary-solid'] = primaryOverride;
    effectiveTokens['--primary-ink'] = primaryOverride;
  }

  const fontFaceBlocks: string[] = [];
  for (const ff of bundle.typography.fontFaces || []) {
    if (isBlockedExternalFontUrl(ff.src)) continue;
    const resolvedSrc = assetUrlResolver ? assetUrlResolver(ff.src) : ff.src;
    if (isBlockedExternalFontUrl(resolvedSrc)) continue;
    const ext = ff.src.split('.').pop()?.toLowerCase();
    const format = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
    fontFaceBlocks.push(
      `@font-face {\n  font-family: "${ff.family}";\n  src: url("${resolvedSrc}") format("${format}");\n  font-weight: ${ff.weight || '100 900'};\n  font-style: ${ff.style || 'normal'};\n  font-display: swap;\n}`,
    );
  }

  const tokenDeclarations = Object.entries(effectiveTokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  const layoutRules = `
[data-theme="${bundle.manifest.id}"] {
${tokenDeclarations}
  font-family: var(--ol-font-sans, var(--font-sans));
}
[data-theme="${bundle.manifest.id}"] [data-theme-surface="card"] {
  border-radius: var(--ol-radius-card);
  box-shadow: var(--ol-shadow-card);
}
[data-theme="${bundle.manifest.id}"] [data-theme-control] {
  border-radius: var(--ol-radius-control);
}
`;

  let rewrittenScopedCss = bundle.scopedCss || '';
  if (assetUrlResolver && rewrittenScopedCss) {
    rewrittenScopedCss = rewrittenScopedCss.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, _q, ref: string) => {
      if (ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('/api/themes/')) {
        return `url('${ref}')`;
      }
      const norm = normalizeSafeRelativeAssetPath(ref);
      return norm ? `url('${assetUrlResolver(norm)}')` : `url('${ref}')`;
    });
  }

  const bgUrl =
    bundle.appearance.backgroundImage && assetUrlResolver
      ? `\n[data-theme="${bundle.manifest.id}"] [data-theme-bg-canvas] { background-image: url('${assetUrlResolver(bundle.appearance.backgroundImage)}'); background-size: cover; background-position: center; }\n`
      : '';

  return {
    cssText: [...fontFaceBlocks, layoutRules, bgUrl, rewrittenScopedCss].filter(Boolean).join('\n'),
    effectiveTokens,
    effectiveMode: activeMode,
  };
}
