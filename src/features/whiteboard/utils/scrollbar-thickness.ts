/**
 * 测量当前环境下「经典滚动条」的占位厚度。
 *
 * 叠加滚动条（macOS overlay 等）通常为 0 —— 出现滚动条时 client 盒不变。
 * 经典滚动条（常见于 Linux / Windows）会挤占 padding box，必须在画布尺寸
 * 计算里预先扣除，否则会把滚动条显隐反馈进 ResizeObserver。
 */
export function measureScrollbarThickness(doc: Document = document): number {
  if (typeof doc === 'undefined' || !doc.body) return 0;
  const probe = doc.createElement('div');
  probe.style.cssText =
    'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none';
  doc.body.appendChild(probe);
  const thickness = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return Number.isFinite(thickness) && thickness > 0 ? thickness : 0;
}

/**
 * 读取元素的 padding box（border box 减去边框）。
 * 该尺寸不随经典滚动条显隐变化，适合作为画布布局的稳定基准。
 */
export function measurePaddingBox(el: HTMLElement): { width: number; height: number } {
  const cs = getComputedStyle(el);
  const borderX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
  const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
  return {
    width: Math.max(0, el.offsetWidth - borderX),
    height: Math.max(0, el.offsetHeight - borderY),
  };
}
