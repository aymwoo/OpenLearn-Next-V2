export interface CommunityPlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloadUrl: string;
  icon: string | null;
  homepage: string | null;
  repository: string | null;
  giteeRepoUrl?: string | null;
  license: string | null;
  tags: string[];
  capabilities: string[];
  minPlatformVersion: string | null;
  publishedAt: string | null;
  packageSize?: number | null;
  downloads: number | null;
  stars: number | null;
  starred?: boolean;
  verified: boolean;
  integrity?: string | null;
  signature?: string | null;
  featured: boolean;
  installedVersion: string | null;
  hasUpdate: boolean;
}

export function formatCount(value: number | null | undefined, lang: string): string | null {
  if (value === null || value === undefined) return null;
  if (value >= 10000) return lang === 'zh' ? `${(value / 10000).toFixed(1)} 万` : `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return lang === 'zh' ? `${value}` : `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatPackageSize(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(2)} MB`;
}

export function formatReleaseDate(
  iso: string | null | undefined,
  lang: string,
): { short: string; full: string } | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
  const short =
    lang === 'zh'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const full = date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  return { short, full };
}

export function resolveGiteeStarUrl(plugin: Pick<CommunityPlugin, 'repository' | 'giteeRepoUrl'>): string | null {
  const raw = plugin.giteeRepoUrl ?? plugin.repository;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = new URL(raw.trim());
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.hostname.toLowerCase() !== 'gitee.com'
    ) {
      return null;
    }
    const segs = parsed.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return null;
    const owner = segs[0];
    const repo = segs[1].replace(/\.git$/i, '');
    return `https://gitee.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  } catch {
    return null;
  }
}
