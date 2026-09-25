import type { NetworkHealthState, NetworkMode, OfflineJournalEvent } from '../types';

export type NetworkChangeCallback = (state: NetworkHealthState) => void;
export type SyncFlushCallback = (events: OfflineJournalEvent[]) => Promise<boolean>;

export class EdgeLanDetector {
  private static instance: EdgeLanDetector | null = null;
  private mode: NetworkMode = 'CLOUD_ONLINE';
  private isInternetReachable: boolean = true;
  private isLocalServerReachable: boolean = true;
  private latencyMs: number = 5;
  private lastPingTimestamp: number = Date.now();
  private offlineEvents: OfflineJournalEvent[] = [];
  private listeners: Set<NetworkChangeCallback> = new Set();
  private pingIntervalTimer: any = null;
  private syncFlushHandler: SyncFlushCallback | null = null;

  private constructor() {
    this.initBrowserListeners();
  }

  public static getInstance(): EdgeLanDetector {
    if (!EdgeLanDetector.instance) {
      EdgeLanDetector.instance = new EdgeLanDetector();
    }
    return EdgeLanDetector.instance;
  }

  private initBrowserListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleBrowserOnlineStatus(true));
      window.addEventListener('offline', () => this.handleBrowserOnlineStatus(false));
    }
  }

  public startHeartbeat(intervalMs: number = 10000): void {
    if (this.pingIntervalTimer) return;
    this.pingIntervalTimer = setInterval(() => {
      this.checkConnectivity();
    }, intervalMs);
  }

  public stopHeartbeat(): void {
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
      this.pingIntervalTimer = null;
    }
  }

  public async checkConnectivity(): Promise<NetworkHealthState> {
    const start = Date.now();
    try {
      // 1. 尝试 ping 本地服务健康接口
      const localRes = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
      }).catch(() => null);

      this.isLocalServerReachable = !!(localRes && localRes.ok);
      this.latencyMs = Date.now() - start;

      // 2. 检查外网连通性 (浏览器 navigator.onLine 作为基准，或结合公共静态探针)
      const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

      if (!this.isLocalServerReachable && !browserOnline) {
        this.mode = 'OFFLINE_DISCONNECTED';
        this.isInternetReachable = false;
      } else if (this.isLocalServerReachable && !browserOnline) {
        this.mode = 'EDGE_LAN_ONLY';
        this.isInternetReachable = false;
      } else {
        const previousMode = this.mode;
        this.mode = 'CLOUD_ONLINE';
        this.isInternetReachable = true;

        // 如果从 EDGE_LAN_ONLY 恢复到 CLOUD_ONLINE，触发离线缓存同步
        if (previousMode === 'EDGE_LAN_ONLY' && this.offlineEvents.length > 0) {
          this.flushOfflineJournal();
        }
      }
    } catch {
      this.isLocalServerReachable = false;
      this.mode = 'OFFLINE_DISCONNECTED';
    }

    this.lastPingTimestamp = Date.now();
    const state = this.getState();
    this.notifyListeners(state);
    return state;
  }

  public async setSimulatedState(internetReachable: boolean, localReachable: boolean): Promise<void> {
    const previousMode = this.mode;
    this.isInternetReachable = internetReachable;
    this.isLocalServerReachable = localReachable;

    if (!localReachable && !internetReachable) {
      this.mode = 'OFFLINE_DISCONNECTED';
    } else if (localReachable && !internetReachable) {
      this.mode = 'EDGE_LAN_ONLY';
    } else {
      this.mode = 'CLOUD_ONLINE';
      if (previousMode === 'EDGE_LAN_ONLY' && this.offlineEvents.length > 0) {
        await this.flushOfflineJournal();
      }
    }

    this.lastPingTimestamp = Date.now();
    this.notifyListeners(this.getState());
  }

  public recordOfflineEvent(eventType: string, payload: any): OfflineJournalEvent {
    const event: OfflineJournalEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      eventType,
      payload,
      timestamp: Date.now(),
      synced: false,
    };
    this.offlineEvents.push(event);
    this.notifyListeners(this.getState());
    return event;
  }

  public async flushOfflineJournal(): Promise<boolean> {
    if (this.offlineEvents.length === 0) return true;
    if (this.syncFlushHandler) {
      const success = await this.syncFlushHandler([...this.offlineEvents]);
      if (success) {
        this.offlineEvents = [];
        this.notifyListeners(this.getState());
        return true;
      }
    } else {
      // 默认清理
      this.offlineEvents = [];
      this.notifyListeners(this.getState());
      return true;
    }
    return false;
  }

  public setSyncFlushHandler(handler: SyncFlushCallback): void {
    this.syncFlushHandler = handler;
  }

  private handleBrowserOnlineStatus(online: boolean): void {
    if (!online) {
      // 浏览器离线时，检查是否仍可连接本地局域网服务
      this.isInternetReachable = false;
      if (this.isLocalServerReachable) {
        this.mode = 'EDGE_LAN_ONLY';
      } else {
        this.mode = 'OFFLINE_DISCONNECTED';
      }
    } else {
      this.isInternetReachable = true;
      this.mode = 'CLOUD_ONLINE';
      this.flushOfflineJournal();
    }
    this.notifyListeners(this.getState());
  }

  public getState(): NetworkHealthState {
    return {
      mode: this.mode,
      isInternetReachable: this.isInternetReachable,
      isLocalServerReachable: this.isLocalServerReachable,
      latencyMs: this.latencyMs,
      lastPingTimestamp: this.lastPingTimestamp,
      bufferedOfflineEventsCount: this.offlineEvents.length,
    };
  }

  public subscribe(callback: NetworkChangeCallback): () => void {
    this.listeners.add(callback);
    callback(this.getState());
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(state: NetworkHealthState): void {
    this.listeners.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.error('Error in network state listener:', err);
      }
    });
  }
}

export const edgeLanDetector = EdgeLanDetector.getInstance();
