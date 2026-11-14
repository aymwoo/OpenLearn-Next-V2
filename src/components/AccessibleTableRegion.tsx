import React from 'react';

export interface AccessibleTableRegionProps {
  /** ID of the table's `<caption>` element providing its accessible name. */
  labelledBy?: string;
  /** Fallback accessible label when an external `<caption>` id is not used. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Keyboard-focusable horizontal scroll region for semantic data `<table>`s.
 */
export function AccessibleTableRegion({ labelledBy, label, className = '', children }: AccessibleTableRegionProps) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={labelledBy}
      aria-label={!labelledBy ? label : undefined}
      className={`table-scroll-region ${className}`.trim()}
    >
      {children}
    </div>
  );
}
