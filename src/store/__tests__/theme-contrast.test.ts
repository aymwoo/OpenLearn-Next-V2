/**
 * 对比度回归（Issue #77）
 *
 * 1) 语义色令牌：直接解析 `src/index.css` 里各主题的 CSS 变量，断言
 *    `--text-main` / `--text-muted` / `--text-subtle` 在 `--bg-surface` 与
 *    `--bg-surface-secondary` 上均达到 WCAG AA（普通文本 4.5:1）。
 *    解析真实 CSS 而非复制常量，CSS 改了令牌这里就会跟着变。
 *
 * 2) 令牌与 themeStore 一致：`BUILTIN_THEME_TOKENS` 会通过 `theme.changed`
 *    事件下发给课件 iframe，必须与 index.css 的 muted/subtle 保持一致。
 *
 * 3) 课中授课页面组件的填充按钮：禁止「白字 + -300/-400/-500 亮色底」。
 *    这是 issue #77 的原始缺陷类别（如 `bg-amber-500 text-white` 仅 2.15:1）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_THEME_TOKENS } from '../themeStore';

// ── WCAG 对比度工具 ──────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── 解析 src/index.css 的主题变量 ────────────────────────────────────────

const CSS_PATH = path.resolve(process.cwd(), 'src/index.css');
const css = fs.readFileSync(CSS_PATH, 'utf-8');

/** 从 CSS 里提取 `[data-theme='x'] { --k: v; }`（`:root` 视为 light） */
function parseThemeTokens(source: string): Record<string, Record<string, string>> {
  const themes: Record<string, Record<string, string>> = {};
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(source)) !== null) {
    const selector = block[1];
    const body = block[2];
    const themeMatch = selector.match(/\[data-theme='([a-z]+)'\]/);
    const name = themeMatch ? themeMatch[1] : /:root/.test(selector) ? 'light' : null;
    if (!name) continue;
    const vars = themes[name] ?? {};
    for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[decl[1]] = decl[2].trim();
    }
    themes[name] = vars;
  }
  return themes;
}

const THEME_TOKENS = parseThemeTokens(css);
const THEME_NAMES = ['light', 'dark', 'eyecare', 'chalkboard'] as const;
const TEXT_TOKENS = ['--text-main', '--text-muted', '--text-subtle'] as const;
const SURFACE_TOKENS = ['--bg-surface', '--bg-surface-secondary'] as const;
const AA_NORMAL_TEXT = 4.5;

describe('主题令牌对比度（WCAG AA）', () => {
  it('四套主题的 text-main / text-muted / text-subtle 都解析得到', () => {
    for (const theme of THEME_NAMES) {
      expect(THEME_TOKENS[theme], `缺少主题 ${theme}`).toBeDefined();
      for (const token of [...TEXT_TOKENS, ...SURFACE_TOKENS]) {
        expect(THEME_TOKENS[theme][token], `${theme} 缺少 ${token}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    }
  });

  it.each(THEME_NAMES)('%s 主题：所有语义文本色在 surface / surface-secondary 上 ≥ 4.5:1', (theme) => {
    const vars = THEME_TOKENS[theme];
    for (const textToken of TEXT_TOKENS) {
      for (const surfaceToken of SURFACE_TOKENS) {
        const ratio = contrastRatio(vars[textToken], vars[surfaceToken]);
        expect(
          ratio,
          `${theme}: ${textToken}(${vars[textToken]}) on ${surfaceToken}(${vars[surfaceToken]}) = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    }
  });

  it('themeStore 下发给 iframe 的 muted / subtle 令牌与 index.css 一致（防止双源漂移）', () => {
    for (const theme of THEME_NAMES) {
      const cssTokens = THEME_TOKENS[theme];
      const storeTokens = BUILTIN_THEME_TOKENS[theme];
      expect(storeTokens, `BUILTIN_THEME_TOKENS 缺少 ${theme}`).toBeDefined();
      for (const token of ['--text-muted', '--text-subtle', '--primary-solid', '--primary-ink'] as const) {
        expect(storeTokens[token]?.toLowerCase(), `${theme} ${token} 与 index.css 不一致`).toBe(
          cssTokens[token].toLowerCase(),
        );
      }
    }
  });

  it.each(THEME_NAMES)('%s 主题：填充型主色上的白字 ≥ 4.5:1', (theme) => {
    for (const token of ['--primary-solid', '--color-primary'] as const) {
      const solid = THEME_TOKENS[theme][token];
      expect(solid, `${theme} 缺少 ${token}`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      const ratio = contrastRatio('#ffffff', solid);
      expect(ratio, `${theme}: 白字 on ${token}(${solid}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_NORMAL_TEXT,
      );
    }
  });

  it.each(THEME_NAMES)('%s 主题：文本型主色压在主题底上 ≥ 4.5:1', (theme) => {
    const vars = THEME_TOKENS[theme];
    const ink = vars['--primary-ink'];
    expect(ink, `${theme} 缺少 --primary-ink`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    for (const surfaceToken of SURFACE_TOKENS) {
      const ratio = contrastRatio(ink, vars[surfaceToken]);
      expect(
        ratio,
        `${theme}: --primary-ink(${ink}) on ${surfaceToken}(${vars[surfaceToken]}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });
});

// ── 课中授课页面：填充按钮不得「白字 + 亮色底」 ────────────────────────────

/**
 * 这些浅色底配白字都低于 4.5:1（amber-500 仅 2.15:1、emerald-500 2.54:1、
 * blue-500 3.68:1、rose-500 3.67:1…）。合规的填充色是 -600/-700/-800，
 * 见各文件里已改为 `bg-amber-700` / `bg-rose-600` / `bg-emerald-700` 的用法。
 */
const LIGHT_ACCENT_BG = new RegExp(
  String.raw`bg-(?:amber|rose|emerald|green|blue|teal|orange|red|yellow|sky|lime|cyan|violet|fuchsia|indigo|purple|pink)-(?:300|400|500)(?![\/\w-])`,
);

const LIVE_CLASS_FILES = [
  'src/components/LiveClassroomView.tsx',
  'src/features/student/StudentInteractiveOverlay.tsx',
  'src/features/classroom/ClassroomInteractiveCockpit.tsx',
  'src/features/classroom/ClassroomCountdownWidget.tsx',
  'src/features/classroom/ClassroomLeaderboardModal.tsx',
  'src/features/classroom/ClassroomBriefingView.tsx',
  'src/features/classroom/PacingDashboardModal.tsx',
  'src/features/classroom/stage-display/StageDisplayPanel.tsx',
  'src/features/classroom/stage-display/StageRealDataCards.tsx',
];

describe('课中授课页面：填充按钮对比度', () => {
  it.each(LIVE_CLASS_FILES)('%s 不存在「text-white + 亮色底」', (relPath) => {
    const filePath = path.resolve(process.cwd(), relPath);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const offenders: string[] = [];
    lines.forEach((line, idx) => {
      if (!line.includes('text-white')) return;
      const match = line.match(LIGHT_ACCENT_BG);
      if (match) offenders.push(`${relPath}:${idx + 1} → ${match[0]}`);
    });
    expect(offenders, `白字压亮色底（<4.5:1）：\n${offenders.join('\n')}`).toEqual([]);
  });
});
