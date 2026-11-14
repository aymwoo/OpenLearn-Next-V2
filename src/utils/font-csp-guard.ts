import { isBlockedExternalFontUrl, LOCAL_SANS_FALLBACK_STACK } from '../../packages/core/security/font-sanitizer.js';

const GUARD_INSTALLED_KEY = Symbol.for('openlearn.externalFontCspGuardInstalled');
const FALLBACK_STYLE_ID = 'openlearn-local-font-fallback';

function ensureLocalFontFallbackStyle(doc: Document): void {
  if (!doc.head || doc.getElementById(FALLBACK_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = FALLBACK_STYLE_ID;
  style.textContent = `:where(html, body) { font-family: ${LOCAL_SANS_FALLBACK_STACK}; }`;
  HTMLHeadElement.prototype.appendChild.call(doc.head, style);
}

function getLinkHrefIfBlocked(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as { tagName?: string; getAttribute?: (k: string) => string | null; href?: string };
  if (typeof el.tagName !== 'string' || el.tagName.toUpperCase() !== 'LINK') return null;
  const attrHref = typeof el.getAttribute === 'function' ? el.getAttribute('href') : null;
  const href = attrHref || el.href || '';
  return isBlockedExternalFontUrl(href) ? href : null;
}

function neutralizeExternalFontLink(node: HTMLLinkElement): void {
  const href = node.getAttribute('href') || node.href;
  if (href) {
    node.setAttribute('data-openlearn-blocked-external-font', href);
    node.removeAttribute('href');
  }
  node.rel = 'openlearn-blocked-font';
  node.disabled = true;
  if (node.ownerDocument) {
    ensureLocalFontFallbackStyle(node.ownerDocument);
  }
}

/**
 * Prevent third-party viewers (e.g. pptx-react-viewer / ooxml-ui) or plugins from
 * injecting external Google Fonts `<link>` tags into `<head>`, which violate host CSP
 * (`style-src 'self' 'unsafe-inline'`) and fail in offline/LAN classrooms.
 */
export function installExternalFontCspGuard(targetDocument: Document = document): () => void {
  if (typeof targetDocument === 'undefined' || typeof HTMLHeadElement === 'undefined') {
    return () => {};
  }

  const headProto = HTMLHeadElement.prototype as HTMLHeadElement & {
    [GUARD_INSTALLED_KEY]?: boolean;
  };
  if (headProto[GUARD_INSTALLED_KEY]) {
    return () => {};
  }

  // Remove any pre-existing external font links before interception takes over
  if (targetDocument.head) {
    for (const link of Array.from(targetDocument.head.querySelectorAll('link'))) {
      if (getLinkHrefIfBlocked(link)) {
        neutralizeExternalFontLink(link);
        link.remove();
      }
    }
  }

  const origAppendChild = headProto.appendChild;
  const origInsertBefore = headProto.insertBefore;
  const origAppend = typeof headProto.append === 'function' ? headProto.append : null;
  const linkProto = typeof HTMLLinkElement !== 'undefined' ? HTMLLinkElement.prototype : null;
  const origSetAttribute = linkProto ? linkProto.setAttribute : null;

  if (linkProto && origSetAttribute) {
    linkProto.setAttribute = function (name: string, value: string): void {
      if (name.toLowerCase() === 'href' && isBlockedExternalFontUrl(value)) {
        origSetAttribute.call(this, 'data-openlearn-blocked-external-font', value);
        this.removeAttribute('href');
        this.rel = 'openlearn-blocked-font';
        this.disabled = true;
        if (this.ownerDocument) {
          ensureLocalFontFallbackStyle(this.ownerDocument);
        }
        return;
      }
      origSetAttribute.call(this, name, value);
    };
  }

  headProto.appendChild = function <T extends Node>(node: T): T {
    if (getLinkHrefIfBlocked(node)) {
      neutralizeExternalFontLink(node as unknown as HTMLLinkElement);
      return node;
    }
    return origAppendChild.call(this, node) as T;
  };

  headProto.insertBefore = function <T extends Node>(node: T, child: Node | null): T {
    if (getLinkHrefIfBlocked(node)) {
      neutralizeExternalFontLink(node as unknown as HTMLLinkElement);
      return node;
    }
    return origInsertBefore.call(this, node, child) as T;
  };

  if (origAppend) {
    headProto.append = function (...nodes: Array<Node | string>): void {
      const filtered: Array<Node | string> = [];
      for (const item of nodes) {
        if (getLinkHrefIfBlocked(item)) {
          neutralizeExternalFontLink(item as unknown as HTMLLinkElement);
        } else {
          filtered.push(item);
        }
      }
      if (filtered.length > 0) {
        origAppend.apply(this, filtered);
      }
    };
  }

  headProto[GUARD_INSTALLED_KEY] = true;

  return () => {
    headProto.appendChild = origAppendChild;
    headProto.insertBefore = origInsertBefore;
    if (origAppend) {
      headProto.append = origAppend;
    }
    if (linkProto && origSetAttribute) {
      linkProto.setAttribute = origSetAttribute;
    }
    delete headProto[GUARD_INSTALLED_KEY];
  };
}
