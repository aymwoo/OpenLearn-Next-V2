import type React from 'react';

/**
 * Returns true when a keydown event is an Enter key press outside an active
 * IME composition, guarding both `nativeEvent.isComposing` and Safari's `keyCode === 229`.
 */
export function isPlainEnterSubmit(e: React.KeyboardEvent): boolean {
  if (e.key !== 'Enter') return false;
  const nativeEvent = e.nativeEvent as KeyboardEvent | undefined;
  return !nativeEvent?.isComposing && e.keyCode !== 229 && nativeEvent?.keyCode !== 229;
}
