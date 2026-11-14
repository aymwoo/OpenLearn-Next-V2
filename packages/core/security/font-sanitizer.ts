/**
 * External webfont CSP & offline-LAN sanitizer.
 *
 * Host CSP enforces `style-src 'self' 'unsafe-inline'` and `font-src 'self' data:`
 * without third-party wildcards. Embedded HTML courseware or runtime components
 * referencing Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`) trigger
 * CSP violations or fail in offline/LAN classrooms. This module detects and strips
 * those external font references and provides a local system font fallback.
 */

const BLOCKED_FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export const LOCAL_SANS_FALLBACK_STACK =
  "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif";

export const LOCAL_FONT_FALLBACK_STYLE = `<style data-openlearn-local-font-fallback="1">:where(html, body) { font-family: ${LOCAL_SANS_FALLBACK_STACK}; }</style>`;

export function isBlockedExternalFontUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsed = new URL(normalized, 'https://local.invalid');
    if (parsed.hostname === 'local.invalid') return false;
    const host = parsed.hostname.toLowerCase();
    for (const blocked of BLOCKED_FONT_HOSTS) {
      if (host === blocked || host.endsWith(`.${blocked}`)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export interface FontSanitizeResult {
  html: string;
  strippedCount: number;
}

export function sanitizeExternalFontsInHtml(inputHtml: string): FontSanitizeResult {
  if (!inputHtml || typeof inputHtml !== 'string') {
    return { html: inputHtml || '', strippedCount: 0 };
  }

  let strippedCount = 0;

  // 1. Strip <link ... href="https://fonts.googleapis.com/..."> or fonts.gstatic.com (including preconnect)
  let html = inputHtml.replace(/<link\b[^>]*>/gi, (tag) => {
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '') : '';
    if (isBlockedExternalFontUrl(href)) {
      strippedCount += 1;
      return '<!-- Removed external font link (CSP/offline fallback active) -->';
    }
    return tag;
  });

  // 2. Strip CSS @import url("https://fonts.googleapis.com/...") / @import "https://fonts.googleapis.com/..."
  html = html.replace(
    /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)|(?:"([^"]*)"|'([^']*)'))[^;\n]*(?:;|$)/gi,
    (stmt, u1, u2, u3, u4, u5) => {
      const target = u1 ?? u2 ?? u3 ?? u4 ?? u5 ?? '';
      if (isBlockedExternalFontUrl(target)) {
        strippedCount += 1;
        return '/* Removed external font import (CSP/offline fallback active) */';
      }
      return stmt;
    },
  );

  // 3. Ensure system font fallback is available when external font links were removed
  if (strippedCount > 0 && !html.includes('data-openlearn-local-font-fallback')) {
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${LOCAL_FONT_FALLBACK_STYLE}</head>`);
    } else if (/<head\b[^>]*>/i.test(html)) {
      html = html.replace(/<head\b[^>]*>/i, (m) => `${m}${LOCAL_FONT_FALLBACK_STYLE}`);
    } else {
      html = `${LOCAL_FONT_FALLBACK_STYLE}${html}`;
    }
  }

  return { html, strippedCount };
}
