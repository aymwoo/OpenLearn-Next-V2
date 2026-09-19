import { create } from 'zustand';

export const FONT_SCALE_STORAGE_KEY = 'openlearn_font_scale';

export const FONT_SCALE_MIN = 85;
export const FONT_SCALE_MAX = 140;
export const FONT_SCALE_STEP = 5;
export const FONT_SCALE_DEFAULT = 100;

export interface FontScalePreset {
  scale: number;
  labelZh: string;
  labelEn: string;
}

export const FONT_SCALE_PRESETS: FontScalePreset[] = [
  { scale: 90, labelZh: '紧凑 (90%)', labelEn: 'Compact (90%)' },
  { scale: 100, labelZh: '标准 (100%)', labelEn: 'Standard (100%)' },
  { scale: 110, labelZh: '中大 (110%)', labelEn: 'Medium (110%)' },
  { scale: 120, labelZh: '大号 (120%)', labelEn: 'Large (120%)' },
  { scale: 130, labelZh: '特大 (130%)', labelEn: 'Extra Large (130%)' },
];

export interface FontSizeState {
  scale: number;
  minScale: number;
  maxScale: number;
  step: number;
  setScale: (scale: number) => void;
  increaseScale: () => void;
  decreaseScale: () => void;
  resetScale: () => void;
  initFontSize: () => void;
}

/**
 * 将字体缩放比例安全挂载到 DOM 根节点 documentElement 上
 */
export function applyFontScaleToDOM(scale: number): void {
  if (typeof document === 'undefined') return;
  const clampedScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(scale)));

  // 1. 设置根 html 的 font-size 百分比（驱动所有 Tailwind rem 单位等比缩放）
  document.documentElement.style.fontSize = `${clampedScale}%`;
  // 2. 提供 CSS 自定义属性方便特定组件做乘数运算
  document.documentElement.style.setProperty('--app-font-scale', (clampedScale / 100).toFixed(2));
  // 3. 挂载 data 属性便于 CSS 规则与诊断检查
  document.documentElement.setAttribute('data-font-scale', String(clampedScale));
}

function notifyIframes(scale: number) {
  if (typeof window === 'undefined') return;
  try {
    setTimeout(async () => {
      try {
        const { broadcastFontScaleToIframes } = await import('../services/lms-bridge');
        broadcastFontScaleToIframes(scale);
      } catch {}
    }, 0);
  } catch {}
}

export const useFontSizeStore = create<FontSizeState>((set, get) => ({
  scale: FONT_SCALE_DEFAULT,
  minScale: FONT_SCALE_MIN,
  maxScale: FONT_SCALE_MAX,
  step: FONT_SCALE_STEP,

  initFontSize: () => {
    if (typeof window === 'undefined') return;

    // 1. 从 localStorage 恢复已保存的缩放比例
    let initialScale = FONT_SCALE_DEFAULT;
    try {
      const saved = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
      if (saved) {
        const parsed = Number(saved);
        if (!isNaN(parsed) && parsed >= FONT_SCALE_MIN && parsed <= FONT_SCALE_MAX) {
          initialScale = parsed;
        }
      }
    } catch {}

    // 2. 应用至 DOM
    applyFontScaleToDOM(initialScale);
    set({ scale: initialScale });
    notifyIframes(initialScale);

    // 3. 监听多标签页同步事件
    try {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === FONT_SCALE_STORAGE_KEY && e.newValue) {
          const newScale = Number(e.newValue);
          if (!isNaN(newScale) && newScale >= FONT_SCALE_MIN && newScale <= FONT_SCALE_MAX) {
            applyFontScaleToDOM(newScale);
            set({ scale: newScale });
            notifyIframes(newScale);
          }
        }
      });
    } catch {}
  },

  setScale: (rawScale: number) => {
    const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(rawScale)));
    applyFontScaleToDOM(clamped);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(clamped));
      } catch {}
    }
    set({ scale: clamped });
    notifyIframes(clamped);
  },

  increaseScale: () => {
    const current = get().scale;
    const next = Math.min(FONT_SCALE_MAX, current + FONT_SCALE_STEP);
    get().setScale(next);
  },

  decreaseScale: () => {
    const current = get().scale;
    const next = Math.max(FONT_SCALE_MIN, current - FONT_SCALE_STEP);
    get().setScale(next);
  },

  resetScale: () => {
    get().setScale(FONT_SCALE_DEFAULT);
  },
}));
