import { describe, it, expect } from 'vitest';
import { routePrepDrop } from '../prepDropRouter';
import { WHITEBOARD_MODE_PACK_ID } from '../whiteboardPack';
import { XUEAN_MODE_PACK_ID } from '../xueanPack';

describe('routePrepDrop', () => {
  it('白板 / 缺省 type → whiteboard-element + page_meta 路径', () => {
    expect(routePrepDrop({ segmentType: 'whiteboard', segmentId: 's1' })).toEqual({
      kind: 'whiteboard-element',
      packId: WHITEBOARD_MODE_PACK_ID,
      segmentType: 'whiteboard',
      segmentId: 's1',
    });
    expect(routePrepDrop({ segmentType: null }).kind).toBe('whiteboard-element');
    expect(routePrepDrop({ segmentType: 'lecture' }).packId).toBe(WHITEBOARD_MODE_PACK_ID);
  });

  it('学案前缀 → xuean-activity 存储路径', () => {
    expect(routePrepDrop({ segmentType: 'xuean', segmentId: 's2' })).toMatchObject({
      kind: 'xuean-activity',
      packId: XUEAN_MODE_PACK_ID,
      segmentType: 'xuean',
      segmentId: 's2',
    });
    expect(routePrepDrop({ segmentType: 'xuean:study' }).kind).toBe('xuean-activity');
    expect(routePrepDrop({ segmentType: 'xuean:drill' }).packId).toBe(XUEAN_MODE_PACK_ID);
  });
});
