import React, { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { Puzzle } from 'lucide-react';

export interface PluginIconRendererProps {
  /**
   * 图标声明：
   * 1. Lucide 图标名 (例如 'BookOpen', 'Award', 'GraduationCap')
   * 2. Emoji 字符 (例如 '📚', '🧪', '⚡')
   * 3. 图片 URL 或 Data URI (http://, https://, data:image/, /assets/...)
   * 4. React 图标组件 (如直接传入 BookOpen 组件)
   */
  icon?: string | React.ComponentType<{ size?: number; className?: string }> | null;
  /** 图标尺寸（像素），默认 18 */
  size?: number;
  /** 附加样式类名 */
  className?: string;
  /** 兜底图标组件，默认 Puzzle */
  fallback?: React.ComponentType<{ size?: number; className?: string }>;
  alt?: string;
}

/**
 * 判断是否为 URL / 图片路径
 */
function isImageUrl(val: string): boolean {
  return (
    val.startsWith('http://') ||
    val.startsWith('https://') ||
    val.startsWith('data:image/') ||
    val.startsWith('/') ||
    val.startsWith('./') ||
    /\.(svg|png|jpe?g|webp|gif|ico)(\?.*)?$/i.test(val)
  );
}

/**
 * 判断是否为 Emoji 字符（长度极短且非英文字母路径）
 */
function isEmojiString(val: string): boolean {
  if (!val || val.length > 8) return false;
  // 排除常规标识符命名
  if (/^[a-zA-Z0-9_-]+$/.test(val)) return false;
  return true;
}

/**
 * 规范化 Lucide 图标名称查找（支持 kebab-case 或 camelCase 自动转 PascalCase）
 */
function resolveLucideIcon(iconName: string): React.ComponentType<{ size?: number; className?: string }> | null {
  if (!iconName) return null;
  const icons = LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>;

  // 1. 直接匹配
  if (icons[iconName]) return icons[iconName];

  // 2. kebab-case 或小驼峰转 PascalCase (e.g. 'book-open' -> 'BookOpen', 'bookOpen' -> 'BookOpen')
  const pascalName = iconName
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  if (icons[pascalName]) return icons[pascalName];

  return null;
}

/**
 * 统一多源插件图标渲染器
 */
export function PluginIconRenderer({
  icon,
  size = 18,
  className = 'shrink-0',
  fallback: Fallback = Puzzle,
  alt = '',
}: PluginIconRendererProps) {
  const [imgError, setImgError] = useState(false);

  // 1. 未提供图标，直接回落
  if (!icon) {
    return <Fallback size={size} className={className} />;
  }

  // 2. 传入的是 React 组件函数
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in (icon as any))) {
    const Component = icon as React.ComponentType<{ size?: number; className?: string }>;
    return <Component size={size} className={className} />;
  }

  // 3. 传入的是字符串
  if (typeof icon === 'string') {
    const trimmed = icon.trim();
    if (!trimmed) {
      return <Fallback size={size} className={className} />;
    }

    // 3a. 图片 URL / Data URI
    if (isImageUrl(trimmed)) {
      if (imgError) {
        return <Fallback size={size} className={className} />;
      }
      return (
        <img
          src={trimmed}
          alt={alt}
          style={{ width: `${size}px`, height: `${size}px` }}
          className={`object-contain rounded-xs ${className}`}
          onError={() => setImgError(true)}
          loading="lazy"
        />
      );
    }

    // 3b. Emoji 或单个符号图标
    if (isEmojiString(trimmed)) {
      return (
        <span
          className={`inline-flex items-center justify-center font-normal leading-none select-none ${className}`}
          style={{ fontSize: `${Math.round(size * 0.95)}px`, width: `${size}px`, height: `${size}px` }}
          aria-hidden={!alt}
          title={alt}
        >
          {trimmed}
        </span>
      );
    }

    // 3c. Lucide 图标名称
    const LucideComponent = resolveLucideIcon(trimmed);
    if (LucideComponent) {
      return <LucideComponent size={size} className={className} />;
    }
  }

  // 4. 解析失败兜底
  return <Fallback size={size} className={className} />;
}
