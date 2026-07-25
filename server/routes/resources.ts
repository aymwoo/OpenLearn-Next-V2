import express from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import { kernelContainer } from '../../packages/core/kernel/index.js';
import { ISemesterGradeServiceToken } from '../../packages/core/di/interfaces.js';
import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { filterXSS } from 'xss';
import { hasDataSubmission, hasScoreDisplay, injectScoreSubmissionUsingAI } from '../../packages/plugins/ai-submit-injector.js';
import { verifyPassword, hashPassword as bcryptHashPassword } from '../../packages/core/db/index.js';
import { encryptApiKey, decryptApiKey, maskApiKey, detectPromptInjection } from '../utils/crypto.js';
import { getCookieToken, getValidSession, checkIsTeacherOrAdmin, getActorId } from '../middleware/auth.js';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { ServerBootstrapAdapter } from '../../packages/core/bootstrap/index.js';
import {
  ActivityRegistry,
  registerOfficialActivities,
  createActivityContext,
  IActivityRegistryToken,
} from '../../packages/activity-ecosystem/index.js';
import type { ServerContext, AgentChatAttachment, AgentChatRequest, AgentToolExecution, StoredAIProvider } from '../context.js';
import { injectLmsSdk } from './shared.js';

export function registerResourcesRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/resources', (req, res) => {
    try {
      const resources = kernelContainer.db.prepare('SELECT id, name, type, created_at FROM system_resources ORDER BY created_at DESC').all();
      res.json(resources);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/resources/:id', (req, res) => {
    try {
      const resource = kernelContainer.db.prepare('SELECT * FROM system_resources WHERE id = ?').get(req.params.id) as any;
      if (!resource) return res.status(404).send('Resource not found');

      if (resource.type === 'html') {
        // Dynamic registration into courseware
        const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(resource.id);
        if (!existingCw) {
          kernelContainer.db.prepare(
            'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(resource.id, resource.id, resource.name, 'html', 'index.html', resource.created_at || Date.now());
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        let html = resource.content || '';
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
      }

      // It's a folder, content is a JSON list of files: Array<{ path: string, content: string }>
      let files: any[] = [];
      try {
        files = JSON.parse(resource.content || '[]');
      } catch (err) {
        return res.status(500).send('Failed to parse folder content');
      }

      // Find index file
      const indexFile = files.find(f => {
        const p = f.path.toLowerCase();
        return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
      }) || files.find(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) || files[0];

      if (!indexFile) {
        return res.status(404).send('No index.html or entrypoint found in resource folder');
      }

      // Dynamic registration into courseware
      const existingCw = kernelContainer.db.prepare('SELECT id FROM courseware WHERE id = ?').get(resource.id);
      if (!existingCw) {
        kernelContainer.db.prepare(
          'INSERT INTO courseware (id, uuid, name, type, entry, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(resource.id, resource.id, resource.name, 'folder', indexFile.path, resource.created_at || Date.now());
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      let html = indexFile.content || '';
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
      res.status(500).send(e.message);
    }
  });

  app.get('/api/resources/:id/*', (req, res) => {
    try {
      const resource = kernelContainer.db.prepare('SELECT * FROM system_resources WHERE id = ?').get(req.params.id) as any;
      if (!resource) return res.status(404).send('Resource not found');

      let subpath = req.params[0] || '';
      // Remove leading slash if any
      if (subpath.startsWith('/')) {
        subpath = subpath.substring(1);
      }

      if (resource.type === 'html') {
        if (subpath && subpath !== 'index.html') {
          return res.status(404).send('Not found for single page HTML resource');
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        let html = resource.content || '';
        html = injectLmsSdk(html, req, { id: resource.id, name: resource.name, uuid: resource.id });
        return res.send(html);
      }

      // It's a folder, content is a JSON list of files: Array<{ path: string, content: string }>
      let files: any[] = [];
      try {
        files = JSON.parse(resource.content || '[]');
      } catch (err) {
        return res.status(500).send('Failed to parse folder content');
      }

      // If no subpath is specified, serve index.html or first html file
      if (!subpath || subpath === '') {
        const indexFile = files.find(f => {
          const p = f.path.toLowerCase();
          return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
        }) || files.find(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) || files[0];

        if (!indexFile) {
          return res.status(404).send('No index.html or entrypoint found in resource folder');
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        let html = indexFile.content || '';
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
      }

      // Search for the requested subpath file
      const normSubpath = subpath.toLowerCase().replace(/\\/g, '/');
      const fileObj = files.find(f => {
        const p = f.path.toLowerCase().replace(/\\/g, '/');
        return p === normSubpath || p.endsWith('/' + normSubpath);
      });

      if (!fileObj) {
        return res.status(404).send(`File not found: ${subpath}`);
      }

      // Determine Content-Type
      const filename = fileObj.path.split('/').pop() || '';
      let contentType = 'text/plain; charset=utf-8';
      if (filename.endsWith('.html') || filename.endsWith('.htm')) {
        contentType = 'text/html; charset=utf-8';
      } else if (filename.endsWith('.css')) {
        contentType = 'text/css; charset=utf-8';
      } else if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
        contentType = 'application/javascript; charset=utf-8';
      } else if (filename.endsWith('.json')) {
        contentType = 'application/json; charset=utf-8';
      } else if (filename.endsWith('.svg')) {
        contentType = 'image/svg+xml; charset=utf-8';
      } else if (filename.endsWith('.png')) {
        contentType = 'image/png';
      } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (filename.endsWith('.gif')) {
        contentType = 'image/gif';
      } else if (filename.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (filename.endsWith('.ico')) {
        contentType = 'image/x-icon';
      }

      const isBinary = filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.gif') || filename.endsWith('.webp') || filename.endsWith('.ico');
      res.setHeader('Content-Type', contentType);

      if (isBinary) {
        const cleanBase64 = fileObj.content.replace(/^data:[^;]+;base64,/, '');
        return res.send(Buffer.from(cleanBase64, 'base64'));
      } else {
        let content = fileObj.content;
        if (contentType.startsWith('text/html')) {
          content = injectLmsSdk(content, req, { id: resource.id, name: resource.name, uuid: resource.id });
        }
        return res.send(content);
      }
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

  app.post('/api/resources', async (req, res) => {
    try {
      const { name, type, content } = req.body;
      if (!name || !type) {
        return res.status(400).json({ error: 'Name and type are required' });
      }

      const id = 'res_' + Math.random().toString(36).substring(2, 10);
      const createdAt = Date.now();

      kernelContainer.db.prepare(
        'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, name, type, content, createdAt);

      // Try calling AI provider to create an auto-submit version if needed
      try {
        if (type === 'html') {
          if (!hasDataSubmission(content) && hasScoreDisplay(content)) {
            const modified = await injectScoreSubmissionUsingAI(kernelContainer.db, content);
            if (modified && modified !== content) {
              const newId = 'res_' + Math.random().toString(36).substring(2, 10);
              const newName = `[自动提交版] ${name}`;
              kernelContainer.db.prepare(
                'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
              ).run(newId, newName, type, modified, createdAt + 10);
            }
          }
        } else if (type === 'folder') {
          let files: any[] = [];
          try {
            files = JSON.parse(content || '[]');
          } catch (err) {}
          const indexFile = files.find(f => {
            const p = f.path.toLowerCase();
            return p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html') || p.endsWith('/index.htm');
          }) || files.find(f => f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) || files[0];

          if (indexFile && indexFile.content) {
            if (!hasDataSubmission(indexFile.content) && hasScoreDisplay(indexFile.content)) {
              const modified = await injectScoreSubmissionUsingAI(kernelContainer.db, indexFile.content);
              if (modified && modified !== indexFile.content) {
                const modifiedFiles = files.map(f => {
                  if (f.path === indexFile.path) {
                    return { ...f, content: modified };
                  }
                  return f;
                });
                const newId = 'res_' + Math.random().toString(36).substring(2, 10);
                const newName = `[自动提交版] ${name}`;
                kernelContainer.db.prepare(
                  'INSERT INTO system_resources (id, name, type, content, created_at) VALUES (?, ?, ?, ?, ?)'
                ).run(newId, newName, type, JSON.stringify(modifiedFiles), createdAt + 10);
              }
            }
          }
        }
      } catch (aiErr) {
        console.error('Failed to create AI modified version:', aiErr);
      }

      res.json({ success: true, id, name, type });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/resources/:id', (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM system_resources WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });


  // ── Resource command bus handlers (plugin accessible) ─────────────────
  // Plugins call ctx.services.commandBus.execute('resource.list', {}) etc.
  const RESOURCE_HANDLERS = {
    'resource.list': {
      execute: async (cmd: any) => {
        const rows = kernelContainer.db.prepare(
          'SELECT id, name, type, created_at FROM system_resources ORDER BY created_at DESC'
        ).all();
        return { resources: rows };
      }
    },
    'resource.get': {
      execute: async (cmd: any) => {
        const row = kernelContainer.db.prepare(
          'SELECT * FROM system_resources WHERE id = ?'
        ).get(cmd.payload?.id) as any;
        if (!row) return { error: 'not_found' };
        return { resource: row };
      }
    },
    'resource.create': {
      execute: async (cmd: any) => {
        const { name, type, content } = cmd.payload || {};
        if (!name || !type || content === undefined)
          return { error: 'invalid_params', message: 'name, type, content required' };
        const id = globalThis.crypto.randomUUID();
        kernelContainer.db.prepare(
          'INSERT INTO system_resources(id,name,type,content,created_at) VALUES(?,?,?,?,datetime(\'now\'))'
        ).run(id, name, type, content);
        return { success: true, id, name, type };
      }
    },
    'resource.delete': {
      execute: async (cmd: any) => {
        if (!cmd.payload?.id) return { error: 'invalid_params', message: 'id required' };
        kernelContainer.db.prepare('DELETE FROM system_resources WHERE id = ?').run(cmd.payload.id);
        return { success: true };
      }
    },
  };
  for (const [type, handler] of Object.entries(RESOURCE_HANDLERS)) {
    try {
      kernelContainer.commandBus.registerHandler(type, handler);
    } catch {
      /* already registered �? harmless on server reload */
    }
  }
}
