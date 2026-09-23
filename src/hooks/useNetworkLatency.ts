import { useCallback, useEffect, useState } from 'react';

/**
 * 网络质量探测 —— 供课堂启动门户的顶部遥测岛展示「12ms 流畅」这类指标。
 *
 * 实现取舍：用 HTTP 往返时延（GET /api/ping）而不是 Socket.IO 的 engine.io ping。
 * 原因是门户页可能尚未加入课堂、甚至尚未建立 socket，而 HTTP 探测在任何状态下
 * 都可用；对「网络是否流畅」这一呈现目标，两者差异可忽略。
 *
 * 该 hook 采用模块级单例探测：无论多少个组件订阅都只跑一个定时器，
 * 避免门户与授课视图同时挂载时重复轮询。
 */

export type NetworkQuality = 'smooth' | 'fair' | 'poor' | 'offline';

export interface NetworkLatencyState {
  /** 最近一次成功的往返时延（ms）；从未成功时为 null */
  latencyMs: number | null;
  quality: NetworkQuality;
  isOnline: boolean;
  measuredAt: number | null;
}

const PING_PATH = '/api/ping';
const DEFAULT_INTERVAL_MS = 15_000;

let state: NetworkLatencyState = { latencyMs: null, quality: 'smooth', isOnline: true, measuredAt: null };
const listeners = new Set<(s: NetworkLatencyState) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function classify(latencyMs: number): NetworkQuality {
  if (latencyMs < 80) return 'smooth';
  if (latencyMs < 250) return 'fair';
  return 'poor';
}

function emit(): void {
  for (const listener of listeners) listener(state);
}

async function probe(): Promise<void> {
  if (inFlight || typeof fetch !== 'function') return;
  inFlight = true;
  const startedAt = performance.now();
  try {
    const res = await fetch(`${PING_PATH}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    state = { latencyMs, isOnline: true, quality: classify(latencyMs), measuredAt: Date.now() };
  } catch {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    // 探测失败时保留上次时延用于展示，但把质量降级，避免误导教师
    state = {
      latencyMs: state.latencyMs,
      isOnline,
      quality: isOnline ? 'poor' : 'offline',
      measuredAt: state.measuredAt,
    };
  } finally {
    inFlight = false;
    emit();
  }
}

function handleConnectivityChange(): void {
  void probe();
}

function subscribe(listener: (s: NetworkLatencyState) => void): () => void {
  listeners.add(listener);
  listener(state);

  if (listeners.size === 1) {
    void probe();
    timer = setInterval(() => void probe(), DEFAULT_INTERVAL_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleConnectivityChange);
      window.addEventListener('offline', handleConnectivityChange);
    }
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleConnectivityChange);
        window.removeEventListener('offline', handleConnectivityChange);
      }
    }
  };
}

/** 供测试重置模块级状态，避免用例之间互相污染。 */
export function __resetNetworkLatency(): void {
  state = { latencyMs: null, quality: 'smooth', isOnline: true, measuredAt: null };
  listeners.clear();
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  inFlight = false;
}

export function useNetworkLatency(enabled = true): NetworkLatencyState & { refresh: () => void } {
  const [snapshot, setSnapshot] = useState<NetworkLatencyState>(state);

  useEffect(() => {
    if (!enabled) return;
    return subscribe(setSnapshot);
  }, [enabled]);

  const refresh = useCallback(() => {
    void probe();
  }, []);

  return { ...snapshot, refresh };
}
