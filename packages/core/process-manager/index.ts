import { v7 as uuidv7 } from 'uuid';
import { db } from '../db/index.js';
import { Kernel } from '../kernel/index.js';

export type ProcessHandler = (
  processId: string, 
  payload: any, 
  state: any,
  log: (msg: string) => void, 
  updateState: (newState: any) => void
) => Promise<void>;

export class ProcessManager {
  private activeTasks: Map<string, NodeJS.Timeout> = new Map();
  private handlers = new Map<string, ProcessHandler>();

  constructor(private kernel: Kernel) {}

  public registerHandler(taskType: string, handler: ProcessHandler) {
    this.handlers.set(taskType, handler);
  }

  public unregisterHandler(taskType: string) {
    this.handlers.delete(taskType);
  }

  public restore() {
    const runnings = db.prepare('SELECT * FROM processes WHERE status = ?').all('running') as any[];
    for (const p of runnings) {
      if (p.task_type) {
        this.resume(p.id, p.task_type, p.payload ? JSON.parse(p.payload) : {}, p.state ? JSON.parse(p.state) : null);
      }
    }
  }

  public spawn(name: string, taskType: string, payload: any): string {
    const processId = uuidv7();
    
    db.prepare('INSERT INTO processes (id, name, status, task_type, payload, state, logs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(processId, name, 'running', taskType, JSON.stringify(payload), null, '', Date.now(), Date.now());

    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.spawned',
      source: 'kernel.process_manager',
      payload: { processId, name },
      timestamp: Date.now()
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
      const p = db.prepare('SELECT logs FROM processes WHERE id = ?').get(processId) as any;
      if (p) {
        const newLogs = (p.logs || '') + msg + '\n';
        db.prepare('UPDATE processes SET logs = ?, updated_at = ? WHERE id = ?').run(newLogs, Date.now(), processId);
      }
    };

    const updateState = (newState: any) => {
      currentState = newState;
      db.prepare('UPDATE processes SET state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(newState), Date.now(), processId);
    };

    Promise.resolve().then(async () => {
      try {
        await handler(processId, payload, currentState, logger, updateState);
        const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
        if (p && p.status !== 'killed') {
          db.prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?').run('completed', Date.now(), processId);
          this.kernel.eventBus.publish({
            id: uuidv7(),
            type: 'process.completed',
            source: 'kernel.process_manager',
            payload: { processId },
            timestamp: Date.now()
          });
        }
      } catch (err: any) {
        logger(`ERROR: ${err.message}`);
        this.failProcess(processId, err.message);
      }
    });
  }

  private failProcess(processId: string, errorMsg: string) {
    db.prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?').run('failed', Date.now(), processId);
    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.failed',
      source: 'kernel.process_manager',
      payload: { processId, error: errorMsg },
      timestamp: Date.now()
    });
  }

  public registerInterval(name: string, intervalMs: number, tickFn: (log: (msg: string) => void) => void): string {
    const processId = uuidv7();
    
    db.prepare('INSERT INTO processes (id, name, status, task_type, logs, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(processId, name, 'running', 'interval', '', Date.now(), Date.now());

    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.spawned',
      source: 'kernel.process_manager',
      payload: { processId, name },
      timestamp: Date.now()
    });

    const logger = (msg: string) => {
      const p = db.prepare('SELECT logs FROM processes WHERE id = ?').get(processId) as any;
      if (p) {
        const newLogs = (p.logs || '') + msg + '\n';
        db.prepare('UPDATE processes SET logs = ?, updated_at = ? WHERE id = ?').run(newLogs, Date.now(), processId);
      }
    };

    const timer = setInterval(() => {
      try {
        tickFn(logger);
      } catch(err: any) {
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
    
    db.prepare('UPDATE processes SET status = ?, updated_at = ? WHERE id = ?').run('killed', Date.now(), processId);
    
    this.kernel.eventBus.publish({
      id: uuidv7(),
      type: 'process.killed',
      source: 'kernel.process_manager',
      payload: { processId },
      timestamp: Date.now()
    });
  }
}
