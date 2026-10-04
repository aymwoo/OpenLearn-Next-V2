import type { ServerContext } from '../context.js';
import { requireAuth } from '../middleware/auth.js';
import { injectLmsSdk, setCoursewareDocumentCsp } from './shared.js';
import { sendSafeError } from '../utils/error-handler.js';
import { resourceService } from '../services/resource-service.js';
import { kernelContainer } from '../../packages/core/kernel/index.js';

export function registerResourcesRoutes(ctx: ServerContext) {
  const { app } = ctx;

  app.get('/api/resources', requireAuth(), (_req, res) => {
    try {
      const resources = resourceService.listResources();
      res.json(resources);
    } catch (e: any) {
      sendSafeError(res, e);
    }
  });

  app.get('/api/resources/:id', requireAuth(), (req, res) => {
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

  app.get('/api/resources/:id/*', requireAuth(), (req, res) => {
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

