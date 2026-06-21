import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IProcessServiceToken,
  IDatabaseToken,
} from '../core/di/interfaces.js';
import type { PluginContext } from '../core/plugin-host/types.js';

export const ProcessPlugin = {
  manifest: {
    id: '@openlearn/plugin-process',
    name: '后台进程管理插件',
    version: '1.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IProcessService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['process:read', 'process:write'],
  },
  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const processManager = ctx.services.processManager;
    const db = await ctx.resolve(IDatabaseToken);

    // REGISTER TASK HANDLERS
    await processManager.registerHandler('simulated_task', async (processId, payload, state, log, updateState) => {
      log(`Process resumed/started: ${payload.name}`);
      const totalSteps = payload.duration;
      const startStep = state?.step || 0;

      for (let i = startStep; i < totalSteps; i++) {
        // Check if killed
        const p = db.prepare('SELECT status FROM processes WHERE id = ?').get(processId) as any;
        if (p && p.status === 'killed') {
          log(`Process was killed.`);
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
        updateState({ step: i + 1 });
        log(`Progress: step ${i+1}/${totalSteps} completed.`);
      }
      log(`Process ${payload.name} completed successfully.`);
    });

    // RESTORE EXISTING TASKS
    await processManager.restore();

    // 1. PROCESS SPAWN
    const spawnCmdType = 'process.spawn';
    await actionRegistry.register({
      id: 'core-process-spawn',
      commandType: spawnCmdType,
      description: '启动一个长时间运行的后台模拟进程，需要提供名称和时长（秒）',
      capabilityRequired: 'process:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '进程名称/标题' },
          duration: { type: 'NUMBER', description: '模拟运行时长（秒）' }
        },
        required: ['name', 'duration']
      }
    });

    await commandBus.registerHandler(spawnCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const processId = await processManager.spawn(
          payload.name,
          'simulated_task',
          { name: payload.name, duration: payload.duration }
        );
        return { processId };
      }
    });

    // 2. PROCESS KILL
    const killCmdType = 'process.kill';
    await actionRegistry.register({
      id: 'core-process-kill',
      commandType: killCmdType,
      description: '通过 ID 终止/结束正在运行的进程',
      capabilityRequired: 'process:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          processId: { type: 'STRING', description: '要终止的进程 ID' }
        },
        required: ['processId']
      }
    });

    await commandBus.registerHandler(killCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        await processManager.kill(payload.processId);
        return { success: true };
      }
    });

    // 3. PROCESS LIST
    const listCmdType = 'process.list';
    await actionRegistry.register({
      id: 'core-process-list',
      commandType: listCmdType,
      description: '列出所有正在运行或已完成的进程',
      capabilityRequired: 'process:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {}
      }
    });

    await commandBus.registerHandler(listCmdType, {
      async execute() {
        const nodes = db.prepare('SELECT id, name, status, created_at, updated_at FROM processes ORDER BY created_at DESC').all();
        return { processes: nodes };
      }
    });

    // 4. PROCESS LOGS
    const logCmdType = 'process.logs';
    await actionRegistry.register({
      id: 'core-process-logs',
      commandType: logCmdType,
      description: '查看指定进程的日志',
      capabilityRequired: 'process:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          processId: { type: 'STRING', description: '进程 ID' }
        },
        required: ['processId']
      }
    });

    await commandBus.registerHandler(logCmdType, {
      async execute(command) {
        const payload = command.payload as any;
        const process = db.prepare('SELECT logs FROM processes WHERE id = ?').get(payload.processId) as any;
        if (!process) throw new Error('Process not found');
        return { logs: process.logs };
      }
    });
  },
  deactivate: async () => {
    // Handlers automatically disposed by ResourceTracker
  }
};

/** @deprecated Deprecated in Phase 8. Built-in plugins are auto-loaded by the Kernel using PluginHost. */
export function bootstrapProcessPlugins() {
  // Deprecated. Left as no-op to support server.ts during Wave 1 transition.
}
