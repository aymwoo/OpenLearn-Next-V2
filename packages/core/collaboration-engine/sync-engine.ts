/**
 * OpenLearn Teaching Collaboration Engine - Synchronization Engine & Offline Queue
 * Multi-layered synchronization (Object, Selection, Viewport, Pointer, Stage, Lesson) with offline recovery.
 */

import { SyncMessage, SyncType } from './types.js';

export type SyncHandler<T = unknown> = (msg: SyncMessage<T>) => void | Promise<void>;

export class SynchronizationEngine {
  private handlers = new Map<SyncType, Set<SyncHandler<any>>>();
  private offlineQueue: SyncMessage[] = [];
  private isConnected = true;

  public subscribeSync<T = unknown>(type: SyncType, handler: SyncHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    const set = this.handlers.get(type)!;
    set.add(handler);

    return () => {
      set.delete(handler);
    };
  }

  public async broadcastSync<T = unknown>(type: SyncType, payload: T, senderId: string): Promise<SyncMessage<T>> {
    const message: SyncMessage<T> = Object.freeze({
      id: `sync_${globalThis.crypto.randomUUID()}`,
      type,
      payload,
      senderId,
      timestamp: Date.now(),
    });

    if (!this.isConnected) {
      this.offlineQueue.push(message as SyncMessage);
      return message;
    }

    await this.dispatchMessage(message);
    return message;
  }

  public setConnected(connected: boolean): void {
    this.isConnected = connected;
    if (connected && this.offlineQueue.length > 0) {
      this.flushOfflineQueue();
    }
  }

  public getOfflineQueueCount(): number {
    return this.offlineQueue.length;
  }

  private async flushOfflineQueue(): Promise<void> {
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];
    for (const msg of queue) {
      await this.dispatchMessage(msg);
    }
  }

  private async dispatchMessage<T>(msg: SyncMessage<T>): Promise<void> {
    const handlers = this.handlers.get(msg.type);
    if (!handlers || handlers.size === 0) return;

    for (const handler of handlers) {
      try {
        await handler(msg);
      } catch (err: unknown) {
        console.error(`[SynchronizationEngine] Error handling sync message ${msg.type}:`, err);
      }
    }
  }
}
