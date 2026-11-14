import React from 'react';
import { useThemeStore } from '../store/themeStore';
import { isBuiltinThemeId } from '../../packages/core/themes/theme-spec';

interface ThemeFailsafeRecoveryButtonProps {
  lang?: 'zh' | 'en';
}

/**
 * 独立内联样式兜底恢复组件（Issue #484）。
 * 完全不依赖 Tailwind 工具类或主题 CSS 变量，确保即使第三方主题样式损坏/错位，
 * 用户仍可在登录页、教师端、学生端与管理端一键退出预览或恢复为内置安全默认主题。
 */
export default function ThemeFailsafeRecoveryButton({ lang = 'zh' }: ThemeFailsafeRecoveryButtonProps) {
  const theme = useThemeStore((s) => s.theme);
  const activeBundle = useThemeStore((s) => s.activeBundle);
  const previewState = useThemeStore((s) => s.previewState);
  const appearanceOverrides = useThemeStore((s) => s.appearanceOverrides);
  const fallbackNotice = useThemeStore((s) => s.fallbackNotice);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const resetToSafeDefault = useThemeStore((s) => s.resetToSafeDefault);
  const clearFallbackNotice = useThemeStore((s) => s.clearFallbackNotice);

  const isThirdPartyOrCustom =
    Boolean(activeBundle) ||
    !isBuiltinThemeId(theme) ||
    Boolean(previewState) ||
    Object.keys(appearanceOverrides || {}).length > 0;

  if (!isThirdPartyOrCustom && !fallbackNotice) {
    return null;
  }

  return (
    <div
      data-testid="theme-failsafe-overlay"
      role="region"
      aria-label={lang === 'zh' ? '主题安全恢复栏' : 'Theme Failsafe Recovery'}
      style={{
        position: 'fixed',
        left: '14px',
        bottom: '14px',
        zIndex: 2147483000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxWidth: '340px',
        pointerEvents: 'auto',
        visibility: 'visible',
        opacity: 1,
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {fallbackNotice && (
        <div
          role="status"
          data-testid="theme-fallback-notice"
          style={{
            backgroundColor: '#fef3c7',
            color: '#78350f',
            border: '1px solid #f59e0b',
            borderRadius: '10px',
            padding: '8px 12px',
            fontSize: '12px',
            lineHeight: 1.45,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.22)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span>{fallbackNotice}</span>
          <button
            type="button"
            onClick={clearFallbackNotice}
            aria-label={lang === 'zh' ? '关闭提示' : 'Dismiss notice'}
            style={{
              backgroundColor: 'transparent',
              color: '#78350f',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 700,
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {isThirdPartyOrCustom && (
        <div
          style={{
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            border: '1px solid #475569',
            borderRadius: '10px',
            padding: '6px 10px',
            fontSize: '12px',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          {previewState && (
            <>
              <span style={{ color: '#fde68a', fontWeight: 600 }}>
                {lang === 'zh'
                  ? `预览中: ${previewState.bundle?.manifest.name || previewState.themeId}`
                  : `Previewing: ${previewState.bundle?.manifest.name || previewState.themeId}`}
              </span>
              <button
                type="button"
                data-testid="theme-cancel-preview"
                onClick={cancelPreview}
                style={{
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #64748b',
                  borderRadius: '6px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {lang === 'zh' ? '退出预览' : 'Exit Preview'}
              </button>
            </>
          )}
          <button
            type="button"
            data-testid="theme-failsafe-recovery"
            onClick={() => void resetToSafeDefault()}
            style={{
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: '1px solid #f87171',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {lang === 'zh' ? '一键恢复默认主题' : 'Reset to Safe Default Theme'}
          </button>
        </div>
      )}
    </div>
  );
}
