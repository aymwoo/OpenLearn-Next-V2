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

export function registerProcessesRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/approvals', (req, res) => {
    try {
      const list = kernelContainer.db.prepare('SELECT * FROM pending_commands ORDER BY created_at DESC').all();
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/approvals/:id/approve', async (req, res) => {
    try {
      const pending: any = kernelContainer.db.prepare('SELECT * FROM pending_commands WHERE id = ?').get(req.params.id);
      if (!pending) return res.status(404).json({error: 'Not found'});
      
      let payload = JSON.parse(pending.payload);
      if (req.body && req.body.payloadOverride) {
        payload = { ...payload, ...req.body.payloadOverride };
      }

      const cmd = kernelContainer.commandBus.createCommand(
        pending.command_type,
        payload,
        pending.actor_id,
        { approved: true } // Bypass high risk check now
      );
      
      const result = await kernelContainer.commandBus.execute(cmd);
      kernelContainer.db.prepare('DELETE FROM pending_commands WHERE id = ?').run(pending.id);
      
      res.json({ success: true, result });
    } catch(e: any) {
      res.status(500).json({ error: e.message });
    }
  });
  
  app.post('/api/approvals/:id/reject', async (req, res) => {
     try {
       kernelContainer.db.prepare('DELETE FROM pending_commands WHERE id = ?').run(req.params.id);
       res.json({ success: true });
     } catch(e: any) {
       res.status(500).json({ error: e.message });
     }
  });

  // Processes APIs
  app.get('/api/processes', (req, res) => {
    try {
      // Only return currently active running processes to ensure real-time accuracy
      const list = kernelContainer.db.prepare("SELECT id, name, status, created_at, updated_at FROM processes WHERE status = 'running' ORDER BY created_at DESC").all();
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/processes/:id/logs', (req, res) => {
    try {
      const dbRow = kernelContainer.db.prepare('SELECT logs FROM processes WHERE id = ?').get(req.params.id) as any;
      res.json(dbRow || { logs: '' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Seed example demo data for the Help Tour wizard.
  // Idempotent: uses stable demo IDs and reuses existing rows, so repeated
  // clicks (or a DB that already holds demo data) never throw UNIQUE errors.
}
