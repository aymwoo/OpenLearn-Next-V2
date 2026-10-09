import { v7 as uuidv7 } from 'uuid';
import { Kernel } from '../kernel/index.js';

export type ProcessHandler = (
  processId: string,
  payload: any,
  state: any,
  log: (msg: string) => void,
  updateState: (newState: any) => void,
) => Promise<void>;

export class ProcessManager {
  private activeTasks: Map<string, NodeJS.Timeout> = new Map();
  private handlers = new Map<string, ProcessHandler>();
  /** 进程归属：processId → pluginId（B-5）。内存副本，权威来源是 processes.plugin_id 列。 */
  private processOwners = new Map<string, string>();

  /**
   * 当前调用方的 pluginId。
   *
   * 用「同步注入」而非逐次传参，是因为 spawn / registerInterval 的签名
   * 已由 IProcessService 接口固定，不能加参数；而 spawn 里还要求 owner 写进
   * 事件广播前的 DB 行，同步字段是最小改动。
   * 必须在插件激活**之前**调用（见 setPluginOwner）。
   */
  private currentOwner: string | undefined;

  constructor(private kernel: Kernel) {}

  /**
   * 声明某个 pluginId 对 processManager 的所有权。
   *
   * 必须在插件激活**之前**调用 —— 否则该插件 spawn 的任务会归属到上一个声明者。
   * 与 ServiceHost / ResourceTracker 的注入时点一致。
   */
  public setPluginOwner(pluginId: string): void {
    this.currentOwner = pluginId;
  }

  /** 查询进程归属；查不到返回 undefined（非插件进程、存量行或已清理）。 */
  public getProcessOwner(processId: string): string | undefined {
    const cached = this.processOwners.get(processId);
    if (cached) return cached;
    try {
      const row = this.kernel.db.prepare('SELECT plugin_id FROM processes WHERE id = ?').get(processId) as
        { plugin_id?: string } | undefined;
      return row?.plugin_id ?? undefined;
    } catch {
      return undefined;
    }
  }

  public registerHandler(taskType: string, handler: ProcessHandler) {
    this.handlers.set(taskType, handler);
  }

  public unregisterHandler(taskType: string) {
    this.handlers.delete(taskType);
  }

  public restore() {
    const runnings = this.kernel.db.prepare('SELECT * FROM processes WHERE status = ?').all('running') as any[];
    for (const p of runnings) {
      if (p.task_type) {
        this.resume(p.id, p.task_type, p.payload ? JSON.parse(p.payload) : {}, p.state ? JSON.parse(p.state) : null);
      }
    }
  }

  public spawn(name: string, taskType: string, payload: any, ownerHint?: string): string {
    const processId = uuidv7();

    // ownerHint 优先于 currentOwner（B-5）：currentOwner 是全局单值，只对
    // 「激活期内 spawn」正确；per-plugin 包装层传的 ownerHint 才代表真实调用方。
    const owner = ownerHint ?? this.currentOwner ?? null;

    this.kernel.db
      .prepare(
        'INSERT INTO processes (id, name, status, task_type, payload, state, logs, created_at, updated_at, plugin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(processId, name, 'running', taskType, JSON.stringify(payload), null, '', Date.now(), Date.now(), owner);

    if (owner) this.processOwners.set(processId, owner);

    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.spawned',
      source: 'kernel.process_manager',
      payload: { processId, name },
      timestamp: Date.now(),
    });

    this.resume(processId, taskType, payload, null);
    return processId;
  }

  private resume(processId: string, taskType: string, payload: any, initialState: any) {
    const handler = this.handlers.get(taskType);
    if (!handler) {
      this.failProcess(processId, `No handler found for task_type: ${taskType}`);
      return;
    }

    let currentState = initialState;
    const logger = (msg: string) => {
      const p = this.kernel.db.prepare('SELECT logs FROM processes WHERE id = ?').get(processId) as any;
      if (p) {
        const newLogs = (p.logs || '') + msg + '\n';
        this.kernel.db
          .prepare('UPDATE processes SET logs = ?, updated_at = ? WHERE id = ?')
          .run(newLogs, Date.now(), processId);
      }
    };

    const updateState = (newState: any) => {
      currentState = newState;
      this.kernel.db
        .prepare('UPDATE processes SET state = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(newState), Date.now(), processId);
    };

    Promise.resolve().then(async () => {
      try {
        await handler(processId, payload, currentState, logger, updateState);
        const p = this.kernel.db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
        if (p && p.status !== 'killed') {
          this.kernel.db
            .prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?')
            .run('completed', Date.now(), processId);
          this.kernel.eventBus.publish({
            id: uuidv7(),
            type: 'process.completed',
            source: 'kernel.process_manager',
            payload: { processId },
            timestamp: Date.now(),
          });
        }
      } catch (err: any) {
        logger(`ERROR: ${err.message}`);
        this.failProcess(processId, err.message);
      }
    });
  }

  private failProcess(processId: string, errorMsg: string) {
    this.kernel.db
      .prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?')
      .run('failed', Date.now(), processId);
    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.failed',
      source: 'kernel.process_manager',
      payload: { processId, error: errorMsg },
      timestamp: Date.now(),
    });
  }

  public registerInterval(
    name: string,
    intervalMs: number,
    tickFn: (log: (msg: string) => void) => void,
    ownerHint?: string,
  ): string {
    const processId = uuidv7();

    // 同 spawn：ownerHint 优先（B-5）
    const owner = ownerHint ?? this.currentOwner ?? null;

    this.kernel.db
      .prepare(
        'INSERT INTO processes (id, name, status, task_type, logs, created_at, updated_at, plugin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(processId, name, 'running', 'interval', '', Date.now(), Date.now(), owner);

    if (owner) this.processOwners.set(processId, owner);

    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.spawned',
      source: 'kernel.process_manager',
      payload: { processId, name },
      timestamp: Date.now(),
    });

    const logger = (msg: string) => {
      const p = this.kernel.db.prepare('SELECT logs FROM processes WHERE id = ?').get(processId) as any;
      if (p) {
        const newLogs = (p.logs || '') + msg + '\n';
        this.kernel.db
          .prepare('UPDATE processes SET logs = ?, updated_at = ? WHERE id = ?')
          .run(newLogs, Date.now(), processId);
      }
    };

    const timer = setInterval(() => {
      try {
        tickFn(logger);
      } catch (err: any) {
        logger(`ERROR: ${err.message}`);
      }
    }, intervalMs);

    this.activeTasks.set(processId, timer);
    return processId;
  }

  public kill(processId: string) {
    const timer = this.activeTasks.get(processId);
    if (timer) {
      clearInterval(timer);
      this.activeTasks.delete(processId);
    }
    this.processOwners.delete(processId);

    this.kernel.db
      .prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?')
      .run('killed', Date.now(), processId);

    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.killed',
      source: 'kernel.process_manager',
      payload: { processId },
      timestamp: Date.now(),
    });
  }
}
