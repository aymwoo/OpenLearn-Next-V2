/**
 * Worker 存活探活（P0 · L-1）。
 *
 * ## 治的是什么
 *
 * 一个写 `while(true)` 的插件会**永久占住一个 Worker 槽位**（上限 32），
 * 打满即全平台 DoS。三个前提此前都成立：
 *   · `resourceLimits` 只管堆，不管 CPU；
 *   · 崩溃看门狗监听 `exit` 事件，而死循环**不产生 exit**；
 *   · 崩溃看门狗有 3 次退避上限，但前提是「崩溃发生过」—— 卡死不算崩溃。
 *
 * ⇒ 缺的不是「杀不掉」（`terminate()` 3/3 轮 2–3ms 杀得掉），
 * 而是「没有人去杀」。本模块补的就是这个「人」。
 *
 * ## 判据为什么是「ping 有无响应」而不是「多久没说话」
 *
 * 最直觉的设计是「N 秒内没收到任何消息就判定卡死」。**那个设计会误杀健康但空闲的插件**
 * —— 一个等着下一节课开始的插件，本来就可以几十分钟不发任何消息。
 *
 * 区别不在「有没有主动说话」，而在**「事件循环还能不能响应」**：
 * 空闲 worker 的事件循环是通的，收到 ping 会立刻回；卡死的 worker 收到什么都不会处理。
 *
 * 实测（Linux / Node 24）：
 *   健康但空闲（从不发消息）：ping → pong **0ms**
 *   同步死循环 while(true)   ：ping → **完全无响应**（等满 1500ms 预算）
 *
 * 所以判据是「ping 有无响应」。空闲插件不受影响 —— 这是本设计与「静默计时器」的本质区别。
 *
 * ## 另两条被实测否决的判据（留档，避免后来者重走）
 *
 * **① worker 自报 `process.cpuUsage()`** —— 自旋的 worker **发不出心跳**：
 * 事件循环被 `while(true)` 堵住，`setInterval` 停摆、`postMessage` 永不执行。
 * 而同步死循环正是要治的形态，故自报方案对该威胁完全无效。
 *
 * **② `/proc/self/task/<tid>/stat` 按线程采样** —— `worker.threadId` 是
 * **Node 内部 id（2、3、4…）**，而 `/proc` 用 **OS tid（70 万级）**，
 * 两者无映射关系，精确到线程不可行。
 * （进程级 `process.cpuUsage()` 区分度确实很强 —— 实测死循环 81.9% / 空闲 0.1%，
 *   但它是**进程级**的，含宿主自身开销，无法归因到具体 pluginId。）
 *
 * ## 与既有机制的关系
 *
 * 检出后调用注入的 `onHung` 回调 → 宿主 `terminateWorker()` →
 * 既有 `exit` 处理器 → `scheduleWatchdogRestart()`（指数退避 + 熔断）**自动生效**。
 * 本模块不另建崩溃通道。
 */

/** 一次探活判定结果 */
export interface LivenessVerdict {
  /** pluginId */
  pluginId: string;
  /** 无响应时长（ms） */
  hungForMs: number;
  /** 阈值（ms） */
  thresholdMs: number;
}

/** 宿主侧需要提供的能力（注入以便单测） */
export interface LivenessHost {
  /** 列出当前处于 running 状态的 pluginId */
  listRunningPluginIds(): string[];
  /** 向指定 worker 发 ping（seq 必须原样出现在其 pong 里） */
  sendPing(pluginId: string, seq: number): void;
  /** 终止 worker —— 宿主应转 terminateWorker()，从而接上既有崩溃链路 */
  terminate(pluginId: string, reason: string): void;
  /** 当前时间，注入以便测试可控 */
  now?(): number;
}

/** 配置默认值 —— 均可经环境变量覆盖 */
export const LIVENESS_DEFAULTS = {
  /** 探活间隔：每这么久给每个 running worker 发一次 ping */
  intervalMs: 30_000,
  /**
   * 宽限：在发出 ping 之后，还允许这么久仍无响应而不判定卡死。
   * 必须显著大于「ping → pong」的正常往返（本机实测为 0ms 量级），
   * 否则在 GC 停顿或宿主机繁忙时会误杀健康 worker。
   */
  graceMs: 15_000,
} as const;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export interface LivenessOptions {
  intervalMs?: number;
  graceMs?: number;
  /** 关掉探活（不启定时器）。可用 `OPENLEARN_WORKER_LIVENESS=off` 置真。 */
  disabled?: boolean;
}

/**
 * Worker 存活探活器。
 *
 * 生命周期与宿主一致：`start()` 起一个 `unref()` 的定时器，
 * `stop()` / `stopTracking()` 负责清理 —— 定时器句柄必须记录，
 * 否则停用/卸载插件后定时器仍在跑，正是审计 C-6 那类「僵尸」问题的同源坑。
 */
export class WorkerLivenessMonitor {
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  /** pluginId → 最近一次收到**任意**入站消息的时刻 */
  private lastSeen = new Map<string, number>();
  /**
   * pluginId → 已发出但尚未收到 pong 的 ping（seq + 发出时刻）。
   *
   * 存发出时刻是必需的：初版只存 seq，下一轮看到「有未决 ping」就直接假定
   * pong 已到并刷新 `lastSeen` —— 于是**卡死的 worker 永远不会被判定**
   * （每轮都走这条分支，阈值形同虚设）。判据必须是「ping 发出后过了多久」。
   */
  private pendingPing = new Map<string, { seq: number; sentAt: number }>();
  /** 已判定卡死并已通知宿主的 pluginId，避免重复 terminate */
  private reportedHung = new Set<string>();

  private readonly host: LivenessHost;
  readonly intervalMs: number;
  readonly graceMs: number;
  readonly disabled: boolean;
  private readonly now: () => number;

  constructor(host: LivenessHost, opts: LivenessOptions = {}) {
    this.host = host;
    this.disabled = opts.disabled ?? process.env.OPENLEARN_WORKER_LIVENESS === 'off';
    this.intervalMs = opts.intervalMs ?? envInt('OPENLEARN_WORKER_LIVENESS_INTERVAL_MS', LIVENESS_DEFAULTS.intervalMs);
    this.graceMs = opts.graceMs ?? envInt('OPENLEARN_WORKER_LIVENESS_GRACE_MS', LIVENESS_DEFAULTS.graceMs);
    this.now = host.now ?? (() => Date.now());
  }

  /** 判定阈值：ping 发出后，超过 interval + grace 仍无响应即视为卡死 */
  get thresholdMs(): number {
    return this.intervalMs + this.graceMs;
  }

  start(): void {
    if (this.disabled || this.timer) return;
    // unref：探活不该让宿主进程保持存活（它只是运维辅助，不是业务必需）
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastSeen.clear();
    this.pendingPing.clear();
    this.reportedHung.clear();
  }

  /**
   * 开始跟踪某个 worker。
   *
   * 刻意**在激活成功后才调用**（而非 worker 一创建就调用）：
   * 激活阶段已有 `ACTIVATE_TIMEOUT_MS` 与 `activate-progress` 滑动续期在管，
   * 两套超时并行会对「正在慢慢迁移数据」的插件产生误杀。
   */
  startTracking(pluginId: string): void {
    if (this.disabled) return;
    this.lastSeen.set(pluginId, this.now());
    this.pendingPing.delete(pluginId);
    this.reportedHung.delete(pluginId);
  }

  /** 停止跟踪并清掉该插件的全部状态（停用 / 卸载 / terminate 时必须调用） */
  stopTracking(pluginId: string): void {
    this.lastSeen.delete(pluginId);
    this.pendingPing.delete(pluginId);
    this.reportedHung.delete(pluginId);
  }

  /**
   * 收到 worker 的任意入站消息时调用 —— **任何**消息都算存活证据。
   *
   * 不只认 pong：RPC 响应、事件、日志、HTTP 流分片都说明事件循环在转。
   * 只认 pong 会在高频通信的插件上误判（pong 可能排在队列后面）。
   */
  noteActivity(pluginId: string): void {
    if (this.disabled) return;
    this.lastSeen.set(pluginId, this.now());
  }

  /** 收到 pong 时调用 —— 用于清理未决 ping */
  notePong(pluginId: string, seq: number): void {
    if (this.disabled) return;
    const pending = this.pendingPing.get(pluginId);
    if (pending && pending.seq === seq) this.pendingPing.delete(pluginId);
    this.noteActivity(pluginId);
  }

  /**
   * 一轮检查：按间隔发 ping，并判定「ping 发出后超过宽限仍无响应」为卡死。
   *
   * 状态机（每 tick 对每个 running worker 走一遍）：
   *   ① 未跟踪        → 建立跟踪起点，本轮不判
   *   ② 有未决 ping   → 距发出已 >= graceMs 则判卡死；否则继续等
   *   ③ 无未决 ping   → 距上次活动 >= intervalMs 则发 ping，否则什么都不做
   *
   * 判定延迟上界：worker 在收到 pong 后立即卡死 ⇒ intervalMs + graceMs（默认 45s）。
   *
   * ⚠️ 初版这里写成「看到未决 ping 就假定 pong 已到」—— 那会让卡死 worker
   * 每轮都刷新 `lastSeen` 而永远不被告警，阈值形同虚设。已改为按发出时刻判定。
   */
  tick(): LivenessVerdict[] {
    if (this.disabled) return [];
    const t = this.now();
    const verdicts: LivenessVerdict[] = [];

    for (const pluginId of this.host.listRunningPluginIds()) {
      // ① 首次见到（激活刚完成）：只记起点，本轮不判
      if (!this.lastSeen.has(pluginId)) {
        this.startTracking(pluginId);
        continue;
      }

      // ② 有未决 ping：按「发出多久了」判定，而不是假定它已回
      const pending = this.pendingPing.get(pluginId);
      if (pending) {
        const waited = t - pending.sentAt;
        if (waited >= this.graceMs) {
          this.pendingPing.delete(pluginId);
          if (!this.reportedHung.has(pluginId)) {
            this.reportedHung.add(pluginId);
            const verdict: LivenessVerdict = { pluginId, hungForMs: waited, thresholdMs: this.graceMs };
            verdicts.push(verdict);
            // 由本模块直接终止，而不是只把判定返回给调用方。
            //
            // 理由：L-1 的缺口正是「杀不掉吗？不是。没有人去杀。」——
            // 若把动作留给调用方，就可能出现「检测逻辑接上了、终止动作忘了接」
            // 这种最难发现的接线错误，而它表现为「一切正常，就是 CPU 一直被吃」。
            // verdict 仍然返回，仅作可观测性（测试与日志用）。
            try {
              this.host.terminate(pluginId, `liveness: ${waited}ms 未响应 ping（阈值 ${this.graceMs}ms）`);
            } catch (err) {
              // 终止失败不应让探活循环本身崩掉 —— 下一轮还会再报。
              // reportedHung 已置位，故必须一并放开，否则一次失败就永久失去对该插件的监控。
              // 同时记日志：静默放弃监控是最坏的失败形态（看起来一切正常）。
              console.error(`[WorkerLiveness] 终止卡死 worker "${pluginId}" 失败，监控将继续：`, err);
              this.reportedHung.delete(pluginId);
            }
          }
        }
        continue;
      }

      // ③ 无未决 ping：距上次活动够久就探一次
      const idleFor = t - (this.lastSeen.get(pluginId) ?? t);
      if (idleFor < this.intervalMs) continue;

      const seq = ++this.seq;
      this.pendingPing.set(pluginId, { seq, sentAt: t });
      try {
        this.host.sendPing(pluginId, seq);
      } catch {
        // 发不出去（transport 已 dispose 等）不构成卡死证据，下轮重试
        this.pendingPing.delete(pluginId);
      }
    }
    return verdicts;
  }
}
