import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PALETTE_ITEMS, PALETTE_ITEM_MAP } from '../paletteConfig';

describe('paletteConfig - html-applet consolidation', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('html-applet should have coursewareUuid and not have redundant resourceId', () => {
    const htmlApplet = PALETTE_ITEMS.find((item) => item.type === 'html-applet');
    expect(htmlApplet).toBeDefined();

    const keys = htmlApplet!.editFields.map((f) => f.key);
    expect(keys).toContain('title');
    expect(keys).toContain('coursewareUuid');
    expect(keys).toContain('code');
    // Ensure redundant resourceId is removed
    expect(keys).not.toContain('resourceId');
  });

  it('html-applet coursewareUuid field loads options from /api/courseware', async () => {
    const htmlApplet = PALETTE_ITEM_MAP['html-applet'];
    expect(htmlApplet).toBeDefined();

    const cwField = htmlApplet.editFields.find((f) => f.key === 'coursewareUuid');
    expect(cwField).toBeDefined();
    expect(cwField?.kind).toBe('select');
    expect(cwField?.loadOptions).toBeDefined();

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { uuid: 'cw-101', name: 'Physics Simulator' },
        { uuid: 'cw-102', name: 'Chemistry Lab' },
      ],
    });

    const options = await cwField!.loadOptions!();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/courseware');
    expect(options).toEqual([
      { value: 'cw-101', label: 'Physics Simulator' },
      { value: 'cw-102', label: 'Chemistry Lab' },
    ]);
  });

  it('html-applet coursewareUuid field returns empty array on fetch failure', async () => {
    const htmlApplet = PALETTE_ITEM_MAP['html-applet'];
    const cwField = htmlApplet.editFields.find((f) => f.key === 'coursewareUuid');

    (globalThis.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const options = await cwField!.loadOptions!();
    expect(options).toEqual([]);
  });
});
