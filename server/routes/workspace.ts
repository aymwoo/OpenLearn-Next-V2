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

export function registerWorkspaceRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/events', (req, res) => {
    try {
      const events = kernelContainer.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT 50').all();
      res.json(events);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

    // ── MFE Remote Entries ─────────────────────────────────────────────────
    app.get('/api/mfe/remotes', (req, res) => {
      try {
        const name = req.query.name as string | undefined;

        if (!name) {
          // Return all registered remotes
          const rows = kernelContainer.db.prepare(
            'SELECT name, entry, meta FROM mfe_remotes',
          ).all() as Array<{ name: string; entry: string; meta: string }>;
          return res.json({ success: true, result: rows });
        }

        // Cache-first strategy (D-24)
        const cached = MF_REMOTE_CACHE.get(name);
        if (cached) {
          return res.json({ success: true, result: cached });
        }

        // Cache miss: query database
        const row = kernelContainer.db.prepare(
          'SELECT name, entry, meta FROM mfe_remotes WHERE name = ?',
        ).get(name) as { name: string; entry: string; meta: string } | undefined;

        if (!row) {
          return res.status(404).json({
            success: false,
            error: `Remote "${name}" not registered`,
          });
        }

        const result = {
          entry: row.entry,
          meta: JSON.parse(row.meta || '{}'),
        };

        // Populate cache (D-24)
        MF_REMOTE_CACHE.set(name, result);

        res.json({ success: true, result });
      } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
      }
    });

  // VFS APIs
  app.get('/api/vfs', (req, res) => {
    try {
      const parentId = req.query.parentId === 'null' ? null : (req.query.parentId || null);
      
      let nodes: any[] = [];
      
      if (parentId === 'virtual-lessons') {
        const lessons = kernelContainer.db.prepare('SELECT id, title, content FROM lessons').all() as any[];
        nodes = lessons.map(l => ({ id: `lesson-${l.id}`, parent_id: 'virtual-lessons', type: 'file', name: `${l.title}.md`, content: l.content }));
      } else if (parentId === 'virtual-assignments') {
        const assignments = kernelContainer.db.prepare('SELECT a.id, a.title, c.name as cname, a.content FROM assignments a JOIN classes c ON a.class_id = c.id').all() as any[];
        nodes = assignments.map(a => ({ id: `assgn-${a.id}`, parent_id: 'virtual-assignments', type: 'file', name: `[${a.cname}] ${a.title}.md`, content: a.content }));
      } else if (parentId === 'virtual-submissions') {
        const submissions = kernelContainer.db.prepare(`
          SELECT sub.id, sub.content, a.title, s.name as sname, sub.score
          FROM assignment_submissions sub
          JOIN assignments a ON sub.assignment_id = a.id
          JOIN students s ON sub.student_id = s.id
        `).all() as any[];
        nodes = submissions.map(sub => ({
          id: `sub-${sub.id}`, parent_id: 'virtual-submissions', type: 'file', name: `${sub.sname} - ${sub.title}.md`,
          content: `# ${sub.title} by ${sub.sname}\n\nScore: ${sub.score || 'Ungraded'}\n\n---\n\n${sub.content}`
        }));
      } else {
        let q = 'SELECT * FROM vfs_nodes WHERE parent_id IS ? ORDER BY type ASC, name ASC';
        nodes = kernelContainer.db.prepare(q).all(parentId);
        
        if (parentId === null) {
          nodes.unshift(
            { id: 'virtual-lessons', parent_id: null, type: 'dir', name: '📚 Lessons (Virtual)' },
            { id: 'virtual-assignments', parent_id: null, type: 'dir', name: '📝 Assignments (Virtual)' },
            { id: 'virtual-submissions', parent_id: null, type: 'dir', name: '🎓 Student Works (Virtual)' }
          );
        }
      }
      
      res.json(nodes);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  // VFS File Download Router (V5.1+)
  app.get('/files/*', (req, res) => {
    try {
      let filePath = req.params[0] || '';
      if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
      }

      const parts = filePath.split('/').filter(Boolean);
      if (parts.length === 0) {
        return res.status(400).send('Invalid file path');
      }

      let currentParentId: string | null = null;
      let foundNode: any = null;

      for (let i = 0; i < parts.length; i++) {
        const name = parts[i];
        const isLast = i === parts.length - 1;
        const type = isLast ? 'file' : 'dir';
        
        const node = kernelContainer.db.prepare('SELECT * FROM vfs_nodes WHERE parent_id IS ? AND name = ? AND type = ?')
          .get(currentParentId, name, type) as any;
          
        if (!node) {
          return res.status(404).send(`File not found: ${filePath}`);
        }
        
        if (isLast) {
          foundNode = node;
        } else {
          currentParentId = node.id;
        }
      }

      if (!foundNode) {
        return res.status(404).send(`File not found: ${filePath}`);
      }

      const filename = parts[parts.length - 1];
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

      const ext = path.extname(filename).toLowerCase();
      const binaryExtensions = ['.pdf', '.xlsx', '.xls', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.mp4', '.mp3'];
      
      const content = foundNode.content || '';
      if (binaryExtensions.includes(ext)) {
        try {
          const buffer = Buffer.from(content, 'base64');
          return res.send(buffer);
        } catch (e) {
          // fallback
        }
      }

      res.send(content);
    } catch (e: any) {
      res.status(500).send(e.message);
    }
  });

}
