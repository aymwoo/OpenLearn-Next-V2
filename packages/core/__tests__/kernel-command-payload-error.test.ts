/**
 * 参数校验失败的错误契约。
 *
 * 背景（Issue IKWCBU）：interceptor 在 inputSchema 校验失败时抛的是裸 Error，
 * 没有 status/code —— 于是 `/api/commands`、`sandbox-command` 一律按 500 上报，
 * 生产环境消息还会被 `sendSafeError` 脱敏成 `Internal server error`。
 * 插件前端因此无法把「参数写错了」与「服务端崩了」区分开。
 *
 * 修复：校验失败携带 400 + `COMMAND_PAYLOAD_INVALID`。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kernel } from '../kernel/index.js';
import { createPluginsDir, cleanupPluginsDir } from '../plugin-host/__tests__/helpers/plugins-dir.js';

describe('command payload validation error contract', () => {
  let kernel: Kernel;
  let pluginsDir: string;

  beforeAll(async () => {
    pluginsDir = createPluginsDir('kernel-payload-error');
    kernel = new Kernel({ pluginsDir });
    await kernel.ready;
  });

  afterAll(() => {
    cleanupPluginsDir(pluginsDir);
  });

  it('inputSchema 校验失败 → 400 + COMMAND_PAYLOAD_INVALID（不再落到 500）', async () => {
    kernel.actionRegistry.register({
      id: 'test.payload_contract',
      commandType: 'test.payload_contract',
      description: 'payload contract test',
      inputSchema: {
        type: 'OBJECT',
        properties: { count: { type: 'NUMBER' } },
        required: ['count'],
      },
      capabilityRequired: 'test:write',
    });
    kernel.commandBus.registerHandler('test.payload_contract', {
      execute: async () => 'should-not-run',
    });

    const cmd = kernel.commandBus.createCommand('test.payload_contract', { count: 'not-a-number' }, 'user:u1:teacher');

    await expect(kernel.commandBus.execute(cmd)).rejects.toMatchObject({
      status: 400,
      code: 'COMMAND_PAYLOAD_INVALID',
      message: expect.stringContaining('[PayloadValidationError]'),
    });
  });
});
