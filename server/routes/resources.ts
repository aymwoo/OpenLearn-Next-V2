import type { ServerContext } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { requireScopedAuth } from '../middleware/data-scope.js';
import { injectLmsSdk, setCoursewareDocumentCsp } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { resourceService } from '../services/resource-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export function registerResourcesRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/resources', requireScopedAuth('authenticated'), (_req, res) => {
    try {
      const resources = resourceService.listResources();
      res.json(resources);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/resources/:id', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const resource = resourceService.getResource(req.params.id);
      if (!resource) return res.status(404).send('Resource not found');

      resourceService.prepareCoursewareCache(resource);
      const resolved = resourceService.resolveResourceContent(resource);

      res.setHeader('Content-Type', resolved.contentType);
      setCoursewareDocumentCsp(res);

      let html = String(resolved.content || '');
      const baseTag = `<base href="/api/resources/${req.params.id}/">`;
      if (html.toLowerCase().includes('<head>')) {
        html = html.replace(/<head>/i, `<head>${baseTag}`);
      } else if (html.toLowerCase().includes('<html>')) {
        html = html.replace(/<html>/i, `<html><head>${baseTag}</head>`);
      } else {
        html = baseTag + html;
      }

      html = injectLmsSdk(html, req, { id: resource.id, name: resource.name, uuid: resource.id });
      return res.send(html);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/resources/:id/*', requireScopedAuth('authenticated'), (req, res) => {
    try {
      const resource = resourceService.getResource(req.params.id);
      if (!resource) return res.status(404).send('Resource not found');

      const subpath = req.params[0] || '';
      const resolved = resourceService.resolveResourceContent(resource, subpath);

      res.setHeader('Content-Type', resolved.contentType);

      if (resolved.isBinary) {
        return res.send(resolved.content);
      }

      let content = String(resolved.content || '');
      if (resolved.contentType.startsWith('text/html')) {
        setCoursewareDocumentCsp(res);
        if (!subpath || subpath === '' || subpath === 'index.html') {
          const baseTag = `<base href="/api/resources/${req.params.id}/">`;
          if (content.toLowerCase().includes('<head>')) {
            content = content.replace(/<head>/i, `<head>${baseTag}`);
          } else if (content.toLowerCase().includes('<html>')) {
            content = content.replace(/<html>/i, `<html><head>${baseTag}</head>`);
          } else {
            content = baseTag + content;
          }
        }
        content = injectLmsSdk(content, req, { id: resource.id, name: resource.name, uuid: resource.id });
      }
      return res.send(content);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.post('/api/resources', requireAuth('teacher', 'administrator'), async (req, res) => {
    try {
      const result = await resourceService.createResource(req.body);
      res.json(result);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.delete('/api/resources/:id', requireAuth('teacher', 'administrator'), (req, res) => {
    try {
      const deleted = resourceService.deleteResource(req.params.id);
      res.json({ success: deleted });
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  // ── Resource action descriptors（default-deny 的声明式授权点）───────────────
  //
  // kernel 的 commandBus interceptor 是 default-deny：命令类型若没有 action
  // descriptor，派发时直接 403 COMMAND_NOT_REGISTERED
  // （packages/core/kernel/index.ts L372-400）。因此只注册 handler 而不注册
  // descriptor，等价于把命令对插件/AI 永久封死 —— 下面 4 条与 RESOURCE_HANDLERS
  // 严格一一对应，缺一条就有一条命令不可用。
  //
  // capability 选 `management:*` 而非新造 `resource:*` 前缀：
  // CapabilityGuard 的角色回退只认既有词汇表
  // （packages/core/capability/guard/capability-guard.ts L84-97），teacher 持有
  // `management:*`、agent-system-0 显式持有 `management:read` / `management:write`。
  // 另造 `resource:read` 会让教师与 AI 助教**双双被拒**（两者都没有该前缀）。
  //
  // `resource.list` / `resource.get` 归读能力，`resource.create` / `resource.delete`
  // 归写能力；`resource.delete` 会同时删 system_resources 行与 storage/courseware
  // 磁盘缓存且不可回滚，按仓库既有惯例（core-lesson-delete / core-user-delete）
  // 标 isHighRisk —— 非管理员 actor 调用会进 pending_commands 等人工审批。
  // 变量名与 classroom.ts 保持一致（`actionRegistry`）：`scripts/plugin-command-audit.mjs`
  // 按字面量 `actionRegistry.register(` 扫描描述符，换别名会让 4 条 descriptor 对它隐形。
  const actionRegistry = kernelContainer.actionRegistry;
  const resourceIdProp = { id: { type: 'STRING', description: '资源 ID（res_ 前缀）' } };

  try {
    actionRegistry.register({
      id: 'core-resource-list',
      commandType: 'resource.list',
      description: '列出全部系统公共教学资源（按创建时间倒序，不含正文）',
      capabilityRequired: 'management:read',
      // 无参命令沿用仓库既有写法（同 courseware.list / courseware.list_score_configs）：
      // schema 声明为 OBJECT，payload 必须是对象 —— 调用方传 `{}`，不要省略 payload，
      // 否则 validateJsonSchema 会以 "Expected object, got undefined" 拒绝。
      inputSchema: { type: 'OBJECT', properties: {} },
    });
  } catch {
    /* already registered */
  }

  try {
    actionRegistry.register({
      id: 'core-resource-get',
      commandType: 'resource.get',
      description: '按 ID 读取单个教学资源的完整记录（含 content 正文）',
      capabilityRequired: 'management:read',
      inputSchema: {
        type: 'OBJECT',
        properties: { ...resourceIdProp },
        required: ['id'],
      },
    });
  } catch {
    /* already registered */
  }

  try {
    actionRegistry.register({
      id: 'core-resource-create',
      commandType: 'resource.create',
      description:
        '创建教学资源。type=html 时 content 为完整 HTML 文本；type=folder 时 content 为 ' +
        '[{path, content}] 文件数组的 JSON 字符串。HTML 中若含成绩展示但缺提交埋点，平台会自动派生「[自动提交版]」。',
      capabilityRequired: 'management:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: '资源名称；type=html 时建议以 .html 结尾' },
          type: { type: 'STRING', description: "资源类型：'html' 或 'folder'" },
          content: {
            type: 'STRING',
            description: 'html 为 HTML 文本；folder 为 [{path, content}] 的 JSON 字符串',
          },
        },
        required: ['name', 'type', 'content'],
      },
    });
  } catch {
    /* already registered */
  }

  try {
    actionRegistry.register({
      id: 'core-resource-delete',
      commandType: 'resource.delete',
      description: '按 ID 删除教学资源（含 system_resources 行与磁盘缓存）。此为高风险操作。',
      capabilityRequired: 'management:write',
      isHighRisk: true,
      inputSchema: {
        type: 'OBJECT',
        properties: { ...resourceIdProp },
        required: ['id'],
      },
    });
  } catch {
    /* already registered */
  }

  // ── Resource command bus handlers (plugin accessible) ─────────────────
  const RESOURCE_HANDLERS = {
    'resource.list': {
      execute: async () => {
        const rows = resourceService.listResources();
        return { resources: rows };
      },
    },
    'resource.get': {
      execute: async (cmd: any) => {
        const row = resourceService.getResource(cmd.payload?.id);
        if (!row) return { error: 'not_found' };
        return { resource: row };
      },
    },
    'resource.create': {
      execute: async (cmd: any) => {
        const { name, type, content } = cmd.payload || {};
        if (!name || !type || content === undefined) {
          return { error: 'invalid_params', message: 'name, type, content required' };
        }
        const result = await resourceService.createResource({ name, type, content });
        return result;
      },
    },
    'resource.delete': {
      execute: async (cmd: any) => {
        if (!cmd.payload?.id) return { error: 'invalid_params', message: 'id required' };
        const success = resourceService.deleteResource(cmd.payload.id);
        return { success };
      },
    },
  };

  for (const [type, handler] of Object.entries(RESOURCE_HANDLERS)) {
    try {
      kernelContainer.commandBus.registerHandler(type, handler);
    } catch {
      /* already registered */
    }
  }
}
