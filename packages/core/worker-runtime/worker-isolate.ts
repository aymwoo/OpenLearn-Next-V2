/**
 * 隔离原语抽象（P1 · 阶段 1）。
 *
 * ## 为什么需要这个接口
 *
 * `WorkerRegistry` 原先直接摸 `instance.worker`（`node:worker_threads.Worker`）：
 *
 * ```ts
 * this.workerByThreadId.set(instance.worker.threadId, pluginId);  // ← threadId 是专有 API
 * instance.worker.on('error', …);
 * instance.worker.on('exit', …);
 * await instance.worker.terminate();
 * ```
 *
 * 这让「注册表」与「worker_threads」**焊死**了 —— 即使 `IWorkerTransport` 已经
 * 把**消息通道**抽象掉了（Node / Browser 两个实现都在），**生命周期**仍是专有的。
 * 于是「P1 用子进程替代 worker_thread」这件事，在注册表这一层根本接不进来：
 * 子进程没有 `threadId`，它有 `pid` 和 `ChildProcess` 的退出事件。
 *
 * 本接口把**生命周期**也抽象掉，与 `IWorkerTransport`（消息通道）合起来构成
 * 一个隔离原语的完整契约。这是 P1 阶段 1 的**纯重构**，不改任何运行行为。
 *
 * ## 为什么不把生命周期合进 IWorkerTransport
 *
 * `IWorkerTransport` 是 `types.ts` 里对外暴露的契约（插件 SDK 侧可见）。
 * 生命周期事件（exit / error）与消息通道是两件事：浏览器 Web Worker 没有
 * `onExit(code)` 这种退出码语义，合进去会污染跨运行时接口。
 * 故另立本接口，只在宿主侧使用。
 *
 * ## `threadId` 的去向
 *
 * 原先的 `workerByThreadId` Map 标注「用于崩溃检测」，但**只写不读** ——
 * 全仓只有 `set` 与 `delete`，没有任何读取点。崩溃检测实际由
 * `onExit` 回调完成（T-05-13），该 Map 不承担任何职责。
 *
 * 它是「注册表依赖 `threadId`」的唯一来源，所以本阶段**删除**它：
 * 保留一个只写不读、且强制耦合专有 API 的 Map 没有理由。
 * 删除前已用 grep 确认零读取点（见 `worker-manager.test.ts` 的回归用例）。
 */

/** 隔离原语的最小生命周期契约（宿主侧内部使用，不进 SDK） */
export interface IWorkerIsolate {
  /**
   * 隔离原语的稳定标识（仅用于日志与诊断，**不可**作为 Map 键使用 ——
   * worker 终止后 threadId 会变成 -1）。
   */
  readonly isolateId: string;

  /**
   * 注册退出回调。回调参数为退出码；进程被杀（信号终止）时 Node 给 `null`。
   *
   * 注意语义：worker_threads 的 exit 事件只在**已注册**后才派发一次，
   * 而 ChildProcess 的 `exit` 同样只触发一次 —— 两个实现都保证「至多一次」。
   */
  onExit(handler: (code: number | null) => void): void;

  /** 注册错误回调（创建失败、未捕获异常等） */
  onError(handler: (err: Error) => void): void;

  /**
   * 强制终止。
   *
   * 实测（Node 24）：对**同步死循环**的 worker_threads，`terminate()` 依然在
   * 2–3ms 内生效（worker 有独立 isolate，V8 销毁 isolate 不需要 JS 栈配合）。
   * 这一条与「worker_threads 是协作式的」那个常见误解无关 —— 见 L-1 提案 §3.2。
   */
  terminate(): Promise<unknown>;
}