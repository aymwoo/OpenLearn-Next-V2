import crypto from 'node:crypto';
import path from 'node:path';
import type { FileAssetContext, FileLayoutTokenResolver } from '../../../packages/core/di/interfaces.js';
import type { FileLayoutScheme, FileStorageConfig } from './types.js';

export const BUILTIN_LAYOUT_SCHEMES: Record<Exclude<FileLayoutScheme, 'custom'>, string> = {
  flat: '{safeName}',
  'by-date': '{yyyy}/{MM}/{dd}/{purpose}/{safeName}',
  'by-course': '{courseId}/{lessonId}/{purpose}/{safeName}',
  'by-author': '{authorId}/{yyyy}/{MM}/{safeName}',
};

export const BUILTIN_LAYOUT_TOKENS = new Set<string>([
  'yyyy',
  'MM',
  'dd',
  'hh',
  'mm',
  'ss',
  'purpose',
  'authorId',
  'courseId',
  'lessonId',
  'assignmentId',
  'safeName',
  'ext',
  'extNoDot',
  'hash8',
  'uuid',
  'id',
]);

const UNIQUENESS_TOKENS = new Set<string>(['safeName', 'hash8', 'uuid', 'id']);

export class LayoutValidationError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_STORAGE_LAYOUT';
}

function replaceControlCharsAndSymbols(raw: string, pattern: RegExp): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      out += '-';
    } else {
      out += raw[i];
    }
  }
  return out.replace(pattern, '-');
}

/**
 * Sanitize a single directory segment for storage keys.
 * Strips path separators, traversal markers, control characters, and reserved symbols.
 */
export function sanitizeSegment(value: string | null | undefined, fallback = 'unspecified'): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const cleaned = replaceControlCharsAndSymbols(raw, /[<>:"/\\|?*]/g)
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

/**
 * Sanitize an original filename into `<safeStem>-<uniqueTag><ext>`, preserving valid extensions
 * and cleanly keeping safe CJK/Unicode stems (falling back to `file` when nothing printable remains).
 */
export function sanitizeFilenameKeepExt(originalName: string, uniqueTag?: string): string {
  const base = path.posix.basename(String(originalName || 'file').replace(/\\/g, '/'));
  const rawExt = path.posix.extname(base).toLowerCase();
  const ext = /^\.[a-z0-9]{1,16}$/.test(rawExt) ? rawExt : '';
  const rawStem = ext ? base.slice(0, base.length - ext.length) : base;

  const cleanedStem = replaceControlCharsAndSymbols(rawStem, /[^A-Za-z0-9\u4e00-\u9fff._-]/g)
    .replace(/^\.+/, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

  const stem = !cleanedStem || cleanedStem === '.' || cleanedStem === '..' ? 'file' : cleanedStem;
  const suffix = sanitizeSegment(
    uniqueTag || crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(4).toString('hex'),
  );
  return `${stem}-${suffix}${ext}`;
}

export function extractTemplateTokens(template: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    const close = template.indexOf('}', i);
    if (close !== -1 && (open === -1 || close < open)) {
      throw new LayoutValidationError('Layout template contains an unmatched "}" brace');
    }
    if (open === -1) break;
    const end = template.indexOf('}', open + 1);
    if (end === -1) {
      throw new LayoutValidationError('Layout template contains an unclosed "{" brace');
    }
    const tokenName = template.slice(open + 1, end);
    if (!tokenName || tokenName.includes('{')) {
      throw new LayoutValidationError('Layout template contains malformed "{token}" placeholder');
    }
    tokens.push(tokenName);
    i = end + 1;
  }
  return tokens;
}

export function validateLayoutTemplate(
  template: string,
  extraTokens?: Iterable<string>,
): { valid: true; tokens: string[] } {
  if (typeof template !== 'string' || !template.trim()) {
    throw new LayoutValidationError('Layout template must be a non-empty string');
  }
  const trimmed = template.trim();
  if (trimmed.length > 240) {
    throw new LayoutValidationError('Layout template exceeds 240 characters');
  }
  if (trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes('\0') || trimmed.includes('//')) {
    throw new LayoutValidationError('Layout template must be a normalized relative POSIX path');
  }
  if (/^[A-Za-z]:/.test(trimmed)) {
    throw new LayoutValidationError('Layout template must not include a Windows drive prefix');
  }

  const allowed = new Set(BUILTIN_LAYOUT_TOKENS);
  if (extraTokens) {
    for (const t of extraTokens) allowed.add(t);
  }

  const tokens = extractTemplateTokens(trimmed);
  for (const token of tokens) {
    if (!allowed.has(token)) {
      throw new LayoutValidationError(`Unknown layout token "{${token}}"`);
    }
  }

  if (!tokens.some((t) => UNIQUENESS_TOKENS.has(t))) {
    throw new LayoutValidationError(
      'Layout template must include at least one uniqueness token ({safeName}, {hash8}, {uuid}, or {id})',
    );
  }

  // Strip placeholders and ensure static path literal portions cannot introduce traversal or invalid chars.
  const withoutTokens = trimmed.replace(/\{[^}]+\}/g, 'x');
  if (withoutTokens.split('/').some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new LayoutValidationError('Layout template contains invalid "." or ".." or empty path segment');
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(withoutTokens)) {
    throw new LayoutValidationError('Layout template contains unsupported characters');
  }

  return { valid: true, tokens };
}

export function resolveLayoutTemplate(config: Pick<FileStorageConfig, 'layout'>): string {
  const scheme = config.layout.scheme;
  if (scheme === 'custom') {
    return (config.layout.template ?? '').trim() || BUILTIN_LAYOUT_SCHEMES['by-date'];
  }
  return BUILTIN_LAYOUT_SCHEMES[scheme] ?? BUILTIN_LAYOUT_SCHEMES['by-date'];
}

export function assertValidStorageKey(key: string): string {
  if (typeof key !== 'string' || !key) {
    throw new LayoutValidationError('Storage key must be a non-empty string');
  }
  if (key.length > 512) {
    throw new LayoutValidationError('Storage key exceeds 512 characters');
  }
  if (key.startsWith('/') || key.includes('\\') || key.includes('\0') || key.includes('//')) {
    throw new LayoutValidationError(`Invalid storage key format: ${key}`);
  }
  const segments = key.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new LayoutValidationError(`Illegal path segment in storage key: ${key}`);
    }
  }
  return key;
}

export interface RenderStorageKeyInput {
  config: Pick<FileStorageConfig, 'layout'>;
  context: FileAssetContext;
  originalName: string;
  assetId: string;
  sha256: string;
  now?: Date;
  customResolvers?: ReadonlyMap<string, { resolver: FileLayoutTokenResolver }>;
}

export function renderStorageKey(input: RenderStorageKeyInput): string {
  const customTokenNames = input.customResolvers ? input.customResolvers.keys() : undefined;
  const template = resolveLayoutTemplate(input.config);
  validateLayoutTemplate(template, customTokenNames);

  const now = input.now ?? new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const baseName = path.posix.basename(String(input.originalName || 'file').replace(/\\/g, '/'));
  const rawExt = path.posix.extname(baseName).toLowerCase();
  const ext = /^\.[a-z0-9]{1,16}$/.test(rawExt) ? rawExt : '';
  const extNoDot = ext ? ext.slice(1) : 'bin';
  const shortTag =
    sanitizeSegment(input.assetId.replace(/[^a-zA-Z0-9]/g, '').slice(-8), '') || crypto.randomBytes(4).toString('hex');

  const values: Record<string, string> = {
    yyyy: String(now.getUTCFullYear()),
    MM: pad2(now.getUTCMonth() + 1),
    dd: pad2(now.getUTCDate()),
    hh: pad2(now.getUTCHours()),
    mm: pad2(now.getUTCMinutes()),
    ss: pad2(now.getUTCSeconds()),
    purpose: sanitizeSegment(input.context.purpose, 'attachment'),
    authorId: sanitizeSegment(input.context.authorId, 'anonymous'),
    courseId: sanitizeSegment(input.context.courseId, 'unassigned-course'),
    lessonId: sanitizeSegment(input.context.lessonId, 'unassigned-lesson'),
    assignmentId: sanitizeSegment(input.context.assignmentId, 'unassigned-assignment'),
    safeName: sanitizeFilenameKeepExt(input.originalName, shortTag),
    ext,
    extNoDot,
    hash8: sanitizeSegment(input.sha256.slice(0, 8), shortTag),
    uuid: sanitizeSegment(input.assetId, shortTag),
    id: sanitizeSegment(input.assetId, shortTag),
  };

  if (input.customResolvers) {
    for (const [tokenName, entry] of input.customResolvers.entries()) {
      if (!(tokenName in values)) {
        const resolved = entry.resolver({ ...input.context, originalName: input.originalName });
        values[tokenName] = sanitizeSegment(resolved, 'unspecified');
      }
    }
  }

  const rendered = template.replace(/\{([^}]+)\}/g, (_full, tokenName: string) => {
    return values[tokenName] ?? 'unspecified';
  });

  return assertValidStorageKey(rendered);
}
