import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginHttpRouter } from '../plugin-host/http-router.js';
import { PluginHost } from '../plugin-host/index.js';
import { pluginApiGatewayMiddleware } from '../../../server/routes/plugin-api-gateway.js';
import { kernelContainer } from '../kernel/index.js';
import type { Request, Response } from 'express';
import { Kernel } from '../kernel/index.js';
import type { PluginApiRequest, PluginStreamResponse } from '../plugin-host/types.js';
import { createMockStreamResponse } from '../../plugin-test-kit/index.js';

import fs from 'fs';
import path from 'path';

describe('Plugin HTTP SSE Streaming & Safety Defense Tests (V5.3)', () => {
  let kernel: Kernel;
  let pluginHost: PluginHost;

  const cleanupTestDirs = () => {
    try {
      const pluginsDir = path.join(process.cwd(), 'plugins');
      if (fs.existsSync(pluginsDir)) {
        const entries = fs.readdirSync(pluginsDir);
        for (const e of entries) {
          if (e.startsWith('uuid-worker-stream-')) {
            fs.rmSync(path.join(pluginsDir, e), { recursive: true, force: true });
          }
        }
      }
    } catch {}
  };

  beforeEach(async () => {
    kernel = kernelContainer;
    await kernel.ready;
    pluginHost = kernel.pluginHost;

    try {
      kernel.db.prepare("DELETE FROM plugins WHERE id LIKE 'uuid-worker-stream-%'").run();
      kernel.db.prepare("DROP TABLE IF EXISTS plugin_ext_worker_stream_abort_abort_log").run();
    } catch {}
    cleanupTestDirs();
  });

  afterEach(async () => {
    try {
      const plugins = pluginHost.listPlugins();
      for (const p of plugins) {
        if (p.state === 'active' && !p.id.startsWith('@openlearn/')) {
          try {
            await pluginHost.deactivatePlugin(p.id);
          } catch {}
        }
      }
      await kernel.workerManager?.shutdownAll?.();
    } catch {}
    cleanupTestDirs();
  });

  function createMockExpressRes() {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      writtenData: [] as string[],
      ended: false,
      body: null,
      closedListeners: [] as Array<() => void>,
      writeHead(status: number, headers?: Record<string, string>) {
        this.statusCode = status;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            this.headers[k.toLowerCase()] = v;
          }
        }
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name: string) {
        return this.headers[name.toLowerCase()];
      },
      flushHeaders() {},
      write(chunk: any) {
        this.writtenData.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      },
      end(chunk?: any) {
        if (chunk) this.write(chunk);
        this.ended = true;
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.body = data;
        return this;
      },
      on(event: string, cb: () => void) {
        if (event === 'close') {
          this.closedListeners.push(cb);
        }
        return this;
      },
      simulateClose() {
        this.ended = true;
        for (const cb of this.closedListeners) {
          cb();
        }
      },
    };
    return res;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PluginHttpRouter Unit Tests
  // ──────────────────────────────────────────────────────────────────────────

  describe('PluginHttpRouter stream capabilities', () => {
    it('registers dual GET/POST stream route when method is omitted', async () => {
      const router = new PluginHttpRouter();
      let streamCalled = 0;

      router.stream('/ai/completion', async (req, stream) => {
        streamCalled++;
        stream.write({ delta: 'Hello world' });
        stream.end();
      });

      expect(router.isStream('GET', '/ai/completion')).toBe(true);
      expect(router.isStream('POST', '/ai/completion')).toBe(true);
      expect(router.isStream('DELETE', '/ai/completion')).toBe(false);

      const mock = createMockStreamResponse();
      const dummyReq: PluginApiRequest = {
        method: 'POST',
        path: '/ai/completion',
        params: {},
        query: {},
        headers: {},
        body: {},
        ip: '127.0.0.1',
        actor: { actorId: 'user_1', role: 'teacher' },
      };

      await router.handleStream(dummyReq, mock.stream);

      expect(streamCalled).toBe(1);
      expect(mock.isEnded()).toBe(true);
      expect(mock.getChunks()).toHaveLength(1);
      expect(mock.getChunks()[0].data).toEqual({ delta: 'Hello world' });
    });

    it('registers explicit verb stream route', async () => {
      const router = new PluginHttpRouter();

      router.stream('POST', '/ai/chat', async (req, stream) => {
        stream.write('chunk 1', 'token', '1');
        stream.write('chunk 2', 'token', '2');
        stream.end();
      });

      expect(router.isStream('POST', '/ai/chat')).toBe(true);
      expect(router.isStream('GET', '/ai/chat')).toBe(false);

      const mock = createMockStreamResponse();
      await router.handleStream(
        {
          method: 'POST',
          path: '/ai/chat',
          params: {},
          query: {},
          headers: {},
          body: {},
          ip: '127.0.0.1',
          actor: { actorId: 'act_1', role: 'teacher' },
        },
        mock.stream,
      );

      expect(mock.isEnded()).toBe(true);
      expect(mock.getChunks()).toHaveLength(2);
      expect(mock.getChunks()[0]).toEqual({ data: 'chunk 1', event: 'token', id: '1' });
      expect(mock.getChunks()[1]).toEqual({ data: 'chunk 2', event: 'token', id: '2' });
    });

    it('rejects regular handle() call on a streaming route with 400 Bad Request', async () => {
      const router = new PluginHttpRouter();
      router.stream('POST', '/ai/stream-only', async () => {});

      const res = await router.handle({
        method: 'POST',
        path: '/ai/stream-only',
        params: {},
        query: {},
        headers: {},
        body: {},
        ip: '127.0.0.1',
        actor: { actorId: 'act_1', role: 'student' },
      });

      expect(res.status).toBe(400);
      expect((res.body as any).error).toContain('is a streaming route');
    });

    it('captures errors inside stream handler and triggers stream.error()', async () => {
      const router = new PluginHttpRouter();
      router.stream('/ai/broken', async () => {
        throw new Error('LLM service unavailable');
      });

      const mock = createMockStreamResponse();
      await router.handleStream(
        {
          method: 'GET',
          path: '/ai/broken',
          params: {},
          query: {},
          headers: {},
          body: {},
          ip: '127.0.0.1',
          actor: { actorId: 'act_1', role: 'teacher' },
        },
        mock.stream,
      );

      expect(mock.isEnded()).toBe(true);
      expect(mock.getErrors()).toHaveLength(1);
      expect((mock.getErrors()[0] as Error).message).toBe('LLM service unavailable');
    });

    it('marks isStream: true in getRegisteredRoutes()', () => {
      const router = new PluginHttpRouter();
      router.get('/normal/items', async () => ({ ok: true }));
      router.stream('POST', '/stream/events', async () => {});

      const routes = router.getRegisteredRoutes();
      const normal = routes.find((r) => r.pattern === '/normal/items');
      const stream = routes.find((r) => r.pattern === '/stream/events');

      expect(normal?.isStream).toBe(false);
      expect(stream?.isStream).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Inline Plugin Streaming Tests
  // ──────────────────────────────────────────────────────────────────────────

  describe('Inline Plugin HTTP Streaming', () => {
    it('streams SSE chunks through PluginHost dispatchHttpStream', async () => {
      const inlinePlugin = {
        manifest: {
          id: 'ext-inline-stream-ai',
          name: 'Inline Stream AI',
          version: '1.0.0',
          main: 'index.js',
          engines: { openlearn: '>=0.2.5' },
        },
        activate: async (ctx: any) => {
          ctx.http.stream('POST', '/chat', async (req: any, stream: PluginStreamResponse) => {
            stream.write({ text: 'Hello' });
            stream.write({ text: ' World' });
            stream.end();
          });
        },
      };

      pluginHost.registerPreloadedPlugin('ext-inline-stream-ai', inlinePlugin);
      await pluginHost.activatePlugin('ext-inline-stream-ai');

      expect(pluginHost.isStreamRoute('ext-inline-stream-ai', 'POST', '/chat')).toBe(true);

      const mock = createMockStreamResponse();
      await pluginHost.dispatchHttpStream(
        'ext-inline-stream-ai',
        {
          method: 'POST',
          path: '/chat',
          params: {},
          query: {},
          headers: {},
          body: { prompt: 'hi' },
          ip: '127.0.0.1',
          actor: { actorId: 'user_t', role: 'teacher' },
        },
        mock.stream,
      );

      expect(mock.isEnded()).toBe(true);
      expect(mock.getChunks()).toHaveLength(2);
      expect(mock.getChunks()[0].data).toEqual({ text: 'Hello' });
      expect(mock.getChunks()[1].data).toEqual({ text: ' World' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Worker Thread Plugin Streaming RPC Tests
  // ──────────────────────────────────────────────────────────────────────────

  describe('Worker Thread Plugin Streaming RPC (跨线程流式 RPC)', () => {
    it('supports streaming from worker thread back to host mockStream', async () => {
      const pluginId = 'uuid-worker-stream-1';
      const manifestId = 'ext-worker-streaming-bot';

      const manifest = {
        id: manifestId,
        name: 'Worker Streaming Bot',
        version: '1.0.0',
        main: 'index.js',
        engines: { openlearn: '>=0.2.5' },
      };

      const workerCode = `
        export default {
          activate: async (ctx) => {
            ctx.http.stream('POST', '/stream-reply', async (req, stream) => {
              stream.write({ word: 'Step 1' }, 'progress');
              stream.write({ word: 'Step 2' }, 'progress');
              stream.write({ done: true }, 'complete');
              stream.end();
            });
          }
        };
      `;

      kernel.db
        .prepare(`
          INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          pluginId,
          manifest.name,
          JSON.stringify(manifest),
          workerCode,
          null,
          'installed',
          Date.now(),
          'esm',
          'worker',
        );

      await pluginHost.activatePlugin(pluginId, { mode: 'worker' });

      // 验证宿主是否收到 Worker 上报的流式路由元数据
      expect(pluginHost.isStreamRoute(pluginId, 'POST', '/stream-reply')).toBe(true);

      const mock = createMockStreamResponse();
      await pluginHost.dispatchHttpStream(
        pluginId,
        {
          method: 'POST',
          path: '/stream-reply',
          params: {},
          query: {},
          headers: {},
          body: {},
          ip: '127.0.0.1',
          actor: { actorId: 'usr_t', role: 'teacher' },
        },
        mock.stream,
      );

      // 等待 Worker 消息往返到达主线程
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mock.isEnded()).toBe(true);
      expect(mock.getChunks()).toHaveLength(3);
      expect(mock.getChunks()[0]).toEqual({ data: { word: 'Step 1' }, event: 'progress', id: undefined });
      expect(mock.getChunks()[1]).toEqual({ data: { word: 'Step 2' }, event: 'progress', id: undefined });
      expect(mock.getChunks()[2]).toEqual({ data: { done: true }, event: 'complete', id: undefined });
    });

    it('propagates client abort to worker stream.onClose (T-STR-04)', async () => {
      const pluginId = 'uuid-worker-stream-abort';
      const manifestId = 'ext-worker-stream-abort';

      const manifest = {
        id: manifestId,
        name: 'Worker Stream Abort Bot',
        version: '1.0.0',
        main: 'index.js',
        engines: { openlearn: '>=0.2.5' },
        capabilities: ['@openlearn/core:IDatabase'],
        capabilitiesProposed: ['storage:write', '@openlearn/core:IDatabase'],
      };

      const workerCode = `
        export default {
          activate: async (ctx) => {
            ctx.http.stream('POST', '/long-stream', async (req, stream) => {
              stream.onClose(async () => {
                // 收到中止信号时记录到 DB 以供测试断言
                try {
                  await ctx.db.ensureTable('abort_log', 'status TEXT');
                  var rawDb = await ctx.resolve('@openlearn/core:IDatabase');
                  await rawDb.prepare('INSERT INTO ' + ctx.db.table('abort_log') + ' (status) VALUES (?)').run('aborted_successfully');
                } catch(e) {
                  console.error('Worker abort onClose error:', e);
                }
              });

              // 模拟长循环
              for (let i = 0; i < 50; i++) {
                if (stream.isClosed) break;
                stream.write({ count: i });
                await new Promise((r) => setTimeout(r, 100));
              }
            });
          }
        };
      `;

      kernel.db
        .prepare(`
          INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          pluginId,
          manifest.name,
          JSON.stringify(manifest),
          workerCode,
          null,
          'installed',
          Date.now(),
          'esm',
          'worker',
        );

      await pluginHost.activatePlugin(pluginId, { mode: 'worker' });

      const mock = createMockStreamResponse();
      // 启动流
      pluginHost.dispatchHttpStream(
        pluginId,
        {
          method: 'POST',
          path: '/long-stream',
          params: {},
          query: {},
          headers: {},
          body: {},
          ip: '127.0.0.1',
          actor: { actorId: 'usr_t', role: 'teacher' },
        },
        mock.stream,
      );

      // 等待首个 chunk 发出
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(mock.getChunks().length).toBeGreaterThanOrEqual(1);

      // 模拟客户端主动切断连接
      mock.simulateClose();

      // 等待反向中止消息到达 Worker 并写入数据库
      await new Promise((resolve) => setTimeout(resolve, 400));

      const logRow = kernel.db.prepare("SELECT status FROM plugin_ext_worker_stream_abort_abort_log LIMIT 1").get() as any;
      expect(logRow?.status).toBe('aborted_successfully');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. PluginApiGateway Middleware SSE Integration & Threat Mitigations
  // ──────────────────────────────────────────────────────────────────────────

  describe('PluginApiGateway SSE Middleware & Security Defense', () => {
    it('sets standard SSE headers and formats data lines correctly', async () => {
      const inlinePlugin = {
        manifest: {
          id: 'ext-gateway-sse-test',
          name: 'Gateway SSE Test',
          version: '1.0.0',
          main: 'index.js',
          engines: { openlearn: '>=0.2.5' },
          api: {
            routes: [
              { method: 'POST', path: '/events', auth: false, streaming: true },
            ],
          },
        },
        activate: async (ctx: any) => {
          ctx.http.stream('POST', '/events', async (req: any, stream: PluginStreamResponse) => {
            stream.write('line1\nline2', 'multi', 'id-100');
            stream.end();
          });
        },
      };

      pluginHost.registerPreloadedPlugin('ext-gateway-sse-test', inlinePlugin);
      await pluginHost.activatePlugin('ext-gateway-sse-test');

      const req: any = {
        method: 'POST',
        params: { pluginId: 'ext-gateway-sse-test', 0: 'events' },
        originalUrl: '/api/plugins/ext-gateway-sse-test/events',
        headers: {
          accept: 'text/event-stream',
        },
        body: {},
        ip: '192.168.1.50',
      };

      const res = createMockExpressRes();
      let nextCalled = false;
      const next = () => {
        nextCalled = true;
      };

      await pluginApiGatewayMiddleware(req, res, next);

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['connection']).toBe('keep-alive');

      expect(res.writtenData).toHaveLength(1);
      const output = res.writtenData[0];
      expect(output).toContain('id: id-100\n');
      expect(output).toContain('event: multi\n');
      expect(output).toContain('data: line1\ndata: line2\n\n');
      expect(res.ended).toBe(true);
    });

    it('enforces concurrent connection limits per IP (T-STR-01: max 5 streams)', async () => {
      const inlinePlugin = {
        manifest: {
          id: 'ext-flood-test',
          name: 'Flood Test',
          version: '1.0.0',
          main: 'index.js',
          engines: { openlearn: '>=0.2.5' },
          api: {
            routes: [
              { method: 'GET', path: '/hang', auth: false, streaming: true },
            ],
          },
        },
        activate: async (ctx: any) => {
          ctx.http.stream('GET', '/hang', async (_req: any, _stream: PluginStreamResponse) => {
            // 故意挂起流，不 end()
          });
        },
      };

      pluginHost.registerPreloadedPlugin('ext-flood-test', inlinePlugin);
      await pluginHost.activatePlugin('ext-flood-test');

      const testIp = '10.0.0.99';
      const openResponses = [];

      // 建立 5 个并发悬挂连接
      for (let i = 0; i < 5; i++) {
        const req: any = {
          method: 'GET',
          params: { pluginId: 'ext-flood-test', 0: 'hang' },
          originalUrl: '/api/plugins/ext-flood-test/hang',
          headers: {},
          query: {},
          ip: testIp,
        };
        const res = createMockExpressRes();
        await pluginApiGatewayMiddleware(req, res, () => {});
        expect(res.statusCode).toBe(200);
        openResponses.push(res);
      }

      // 第 6 个连接应当被 429 拦截 (T-STR-01)
      const req6: any = {
        method: 'GET',
        params: { pluginId: 'ext-flood-test', 0: 'hang' },
        originalUrl: '/api/plugins/ext-flood-test/hang',
        headers: {},
        query: {},
        ip: testIp,
      };
      const res6 = createMockExpressRes();
      await pluginApiGatewayMiddleware(req6, res6, () => {});

      expect(res6.statusCode).toBe(429);
      expect(res6.body?.error).toContain('Too many concurrent stream connections for this IP');

      // 释放一个连接，模拟客户端关闭
      openResponses[0].simulateClose();

      // 此时重新尝试第 7 个连接应能够成功建立
      const req7: any = {
        method: 'GET',
        params: { pluginId: 'ext-flood-test', 0: 'hang' },
        originalUrl: '/api/plugins/ext-flood-test/hang',
        headers: {},
        query: {},
        ip: testIp,
      };
      const res7 = createMockExpressRes();
      await pluginApiGatewayMiddleware(req7, res7, () => {});
      expect(res7.statusCode).toBe(200);

      // 全部清理
      for (const r of openResponses) {
        r.simulateClose();
      }
      res7.simulateClose();
    });

    it('handles stream error event properly (T-STR-02)', async () => {
      const inlinePlugin = {
        manifest: {
          id: 'ext-stream-err-test',
          name: 'Stream Error Test',
          version: '1.0.0',
          main: 'index.js',
          engines: { openlearn: '>=0.2.5' },
          api: {
            routes: [
              { method: 'GET', path: '/fail', auth: false, streaming: true },
            ],
          },
        },
        activate: async (ctx: any) => {
          ctx.http.stream('GET', '/fail', async (_req: any, stream: PluginStreamResponse) => {
            stream.error(new Error('Downstream LLM quota exceeded'));
          });
        },
      };

      pluginHost.registerPreloadedPlugin('ext-stream-err-test', inlinePlugin);
      await pluginHost.activatePlugin('ext-stream-err-test');

      const req: any = {
        method: 'GET',
        params: { pluginId: 'ext-stream-err-test', 0: 'fail' },
        originalUrl: '/api/plugins/ext-stream-err-test/fail',
        headers: {},
        query: {},
        ip: '10.0.0.101',
      };
      const res = createMockExpressRes();
      await pluginApiGatewayMiddleware(req, res, () => {});

      expect(res.writtenData).toHaveLength(1);
      expect(res.writtenData[0]).toContain('event: error\n');
      expect(res.writtenData[0]).toContain('Downstream LLM quota exceeded');
      expect(res.ended).toBe(true);
    });

    it('rejects oversized chunks exceeding 64KB in Worker stream (T-STR-03)', async () => {
      const pluginId = 'uuid-worker-stream-oversized';
      const manifestId = 'ext-worker-stream-oversized';

      const manifest = {
        id: manifestId,
        name: 'Worker Stream Oversized Bot',
        version: '1.0.0',
        main: 'index.js',
        engines: { openlearn: '>=0.2.5' },
      };

      const workerCode = `
        export default {
          activate: async (ctx) => {
            ctx.http.stream('POST', '/huge-chunk', async (req, stream) => {
              try {
                // 生成超过 64KB 的超大字符串
                const huge = 'X'.repeat(70000);
                stream.write(huge);
              } catch(err) {
                // 预期 Worker 内部直接抛出 Chunk size exceeds 64KB limit
                stream.error(err);
              }
            });
          }
        };
      `;

      kernel.db
        .prepare(`
          INSERT INTO plugins (id, name, manifest, source_code, file_path, status, created_at, loader_version, execution_mode)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          pluginId,
          manifest.name,
          JSON.stringify(manifest),
          workerCode,
          null,
          'installed',
          Date.now(),
          'esm',
          'worker',
        );

      await pluginHost.activatePlugin(pluginId, { mode: 'worker' });

      const mock = createMockStreamResponse();
      await pluginHost.dispatchHttpStream(
        pluginId,
        {
          method: 'POST',
          path: '/huge-chunk',
          params: {},
          query: {},
          headers: {},
          body: {},
          ip: '127.0.0.1',
          actor: { actorId: 'usr_t', role: 'teacher' },
        },
        mock.stream,
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mock.isEnded()).toBe(true);
      expect(mock.getErrors()).toHaveLength(1);
      expect((mock.getErrors()[0] as Error).message).toContain('Chunk size');
    });
  });
});
