import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WhiteboardEventSlot } from '../events/WhiteboardEventSlot';

describe('WhiteboardEventSlot', () => {
  let slot: WhiteboardEventSlot;

  beforeEach(() => {
    slot = new WhiteboardEventSlot({ capacity: 5, persist: false });
  });

  it('ingests events with id and timestamp', () => {
    const e = slot.ingest({
      source: 'manual',
      type: 'test.event',
      payload: { foo: 1 },
      lessonId: 'L1',
    });
    expect(e.id).toMatch(/^[0-9a-f-]+$/);
    expect(typeof e.timestamp).toBe('number');
    expect(e.type).toBe('test.event');
    expect(e.payload.foo).toBe(1);
    expect(e.lessonId).toBe('L1');
  });

  it('emit shorthand', () => {
    const e = slot.emit('quiz.answered', { answer: 'A' }, { lessonId: 'L2' });
    expect(e.type).toBe('quiz.answered');
    expect(e.payload.answer).toBe('A');
    expect(e.lessonId).toBe('L2');
    expect(e.source).toBe('manual');
  });

  it('ring buffer respects capacity (drops oldest)', () => {
    for (let i = 0; i < 8; i++) {
      slot.ingest({ source: 'manual', type: 't', payload: { i } });
    }
    expect(slot.size()).toBe(5);
    // 未指定 filter -> 全部返回
    const all = slot.query();
    expect(all.length).toBe(5);
    // 最新应该在前 (i=7)，最老的应该是 i=3（保留最后 5 条）
    expect(all[0].payload.i).toBe(7);
    expect(all[4].payload.i).toBe(3);
  });

  it('subscribe fires handler synchronously on ingest', () => {
    const handler = vi.fn();
    const unsub = slot.subscribe({ types: ['courseware.submitted'] }, handler);
    slot.emit('courseware.submitted', { score: 90 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].payload.score).toBe(90);
    unsub();
    slot.emit('courseware.submitted', { score: 50 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscribe with no type filter catches all', () => {
    const handler = vi.fn();
    slot.subscribe({}, handler);
    slot.emit('a', {});
    slot.emit('b', {});
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('replay option replays recent N matching events', async () => {
    slot.emit('courseware.submitted', { score: 10 });
    slot.emit('courseware.submitted', { score: 20 });
    slot.emit('courseware.submitted', { score: 30 });
    const handler = vi.fn();
    slot.subscribe({ types: ['courseware.submitted'] }, handler, { replay: 2 });
    // queueMicrotask 异步重放
    await new Promise((r) => queueMicrotask(r));
    // replay 是同步执行的，在 queueMicrotask 里；需要等待一个 tick
    await new Promise((r) => setTimeout(r, 0));
    expect(handler).toHaveBeenCalledTimes(2);
    // 最新在前（query 返回 unshift 顺序）
    expect(handler.mock.calls[0][0].payload.score).toBe(30);
    expect(handler.mock.calls[1][0].payload.score).toBe(20);
  });

  it('replay on empty queue is no-op', async () => {
    const handler = vi.fn();
    slot.subscribe({ types: ['x'] }, handler, { replay: 5 });
    await new Promise((r) => queueMicrotask(r));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('filter by source', () => {
    const handler = vi.fn();
    slot.subscribe({ sources: ['iframe.bridge'] }, handler);
    slot.emit('a', {}, { source: 'iframe.bridge' });
    slot.emit('b', {}, { source: 'manual' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filter by lessonId / elementId / coursewareUuid', () => {
    const handler = vi.fn();
    slot.subscribe(
      { lessonId: 'L1', elementId: 'el1', coursewareUuid: 'cw-1' },
      handler,
    );
    slot.emit('a', {}, { lessonId: 'L1', elementId: 'el1', coursewareUuid: 'cw-1' });
    slot.emit('a', {}, { lessonId: 'L1', elementId: 'el1', coursewareUuid: 'cw-2' });
    slot.emit('a', {}, { lessonId: 'L2', elementId: 'el1', coursewareUuid: 'cw-1' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filter by custom predicate', () => {
    const handler = vi.fn();
    slot.subscribe({ predicate: (e) => (e.payload.score as number) >= 60 }, handler);
    slot.emit('courseware.submitted', { score: 30 });
    slot.emit('courseware.submitted', { score: 80 });
    slot.emit('courseware.submitted', { score: 90 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('query with limit returns at most N events', () => {
    for (let i = 0; i < 10; i++) slot.emit('t', { i });
    const r = slot.query({}, { limit: 3 });
    expect(r.length).toBe(3);
  });

  it('query with since filters by timestamp', async () => {
    slot.emit('a', { v: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const t = Date.now();
    slot.emit('a', { v: 2 });
    slot.emit('a', { v: 3 });
    const r = slot.query({}, { since: t });
    // since 是 > ，所以 t 时刻前的事件应被排除
    expect(r.every((e) => e.payload.v !== 1)).toBe(true);
    expect(r.length).toBe(2);
  });

  it('stats counts by type and source', () => {
    slot.emit('a', {});
    slot.emit('a', {});
    slot.emit('b', {}, { source: 'iframe.bridge' });
    const s = slot.stats();
    expect(s.total).toBe(3);
    expect(s.byType.a).toBe(2);
    expect(s.byType.b).toBe(1);
    expect(s.bySource['iframe.bridge']).toBe(1);
  });

  it('clear empties buffer but not subscriptions', () => {
    const handler = vi.fn();
    slot.subscribe({}, handler);
    slot.emit('a', {});
    slot.clear();
    expect(slot.size()).toBe(0);
    slot.emit('b', {});
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('handler error does not stop dispatch', () => {
    const handler2 = vi.fn();
    slot.subscribe(
      {},
      () => {
        throw new Error('boom');
      },
    );
    slot.subscribe({}, handler2);
    slot.emit('a', {});
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes from byType index', () => {
    const handler = vi.fn();
    const unsub = slot.subscribe({ types: ['x'] }, handler);
    slot.emit('x', {});
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    slot.emit('x', {});
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
