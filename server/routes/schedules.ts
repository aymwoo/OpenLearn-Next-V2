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

export function registerSchedulesRoutes(ctx: ServerContext) {
  const {
    app, io, loginLimiter,
    MF_REMOTE_CACHE, lessonActiveSegments,
    buildAgentSystemInstruction, buildAgentFinalMessage, normalizeToolSchema,
    buildOpenAITools, executeAgentToolCall, buildOpenAIChatUrl,
    runGeminiAgentChat, runOpenAIAgentChat,
  } = ctx;

  app.get('/api/schedules/today', (req, res) => {
    try {
      const clientDate = req.query.date as string || new Date().toISOString().split('T')[0];
      
      // Weekly repeating: match the day of week (strftime('%w', s.scheduled_date) = strftime('%w', ?))
      // Partition by class_id and time_slot to get the latest schedule defined for this slot on this weekday
      const schedules = kernelContainer.db.prepare(`
        WITH RankedSchedules AS (
          SELECT s.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY s.class_id, s.time_slot, strftime('%w', s.scheduled_date)
                   ORDER BY s.scheduled_date DESC, s.created_at DESC
                 ) as rn
          FROM schedules s
          WHERE strftime('%w', s.scheduled_date) = strftime('%w', ?)
        )
        SELECT r.id, r.class_id, r.lesson_id, ? as scheduled_date, r.time_slot, r.status, r.notes, r.created_at,
               COALESCE(l.title, '未设定内�? (上课时自由选择)') as lesson_title, c.name as class_name
        FROM RankedSchedules r
        LEFT JOIN lessons l ON r.lesson_id = l.id
        JOIN classes c ON r.class_id = c.id
        WHERE r.rn = 1
        ORDER BY r.time_slot ASC, r.created_at ASC
      `).all(clientDate, clientDate) as any[];
      
      res.json({ success: true, schedules });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/schedules', (req, res) => {
    try {
      const schedules = kernelContainer.db.prepare(`
        SELECT s.*, COALESCE(l.title, '未设定内�? (上课时自由选择)') as lesson_title, c.name as class_name
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        LEFT JOIN classes c ON s.class_id = c.id
        ORDER BY s.scheduled_date DESC, s.time_slot ASC
      `).all();
      res.json(schedules);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/classes/:classId/schedules', (req, res) => {
    try {
      const schedules = kernelContainer.db.prepare(`
        SELECT s.*, COALESCE(l.title, '未设定内�? (上课时自由选择)') as lesson_title
        FROM schedules s
        LEFT JOIN lessons l ON s.lesson_id = l.id
        WHERE s.class_id = ?
        ORDER BY s.scheduled_date DESC, s.time_slot ASC
      `).all(req.params.classId);
      res.json(schedules);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:classId/schedules', (req, res) => {
    try {
      const { lessonId, scheduledDate, timeSlot, status, notes } = req.body;
      const id = 'sch-' + Date.now().toString(36);
      kernelContainer.db.prepare(`
        INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, 
        req.params.classId, 
        lessonId || '', 
        scheduledDate, 
        timeSlot || null, 
        status || 'scheduled', 
        notes || null, 
        Date.now()
      );
      res.json({ 
        success: true, 
        schedule: { 
          id, 
          class_id: req.params.classId, 
          lesson_id: lessonId || '', 
          scheduled_date: scheduledDate,
          time_slot: timeSlot || null,
          status: status || 'scheduled',
          notes: notes || null
        } 
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/classes/:classId/schedules/:scheduleId', (req, res) => {
    try {
      const { lessonId, scheduledDate, timeSlot, status, notes } = req.body;
      kernelContainer.db.prepare(`
        UPDATE schedules 
        SET lesson_id = ?, scheduled_date = ?, time_slot = ?, status = ?, notes = ?
        WHERE id = ? AND class_id = ?
      `).run(
        lessonId || '', 
        scheduledDate, 
        timeSlot || null, 
        status || 'scheduled', 
        notes || null, 
        req.params.scheduleId, 
        req.params.classId
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/classes/:classId/schedules/:scheduleId', (req, res) => {
    try {
      kernelContainer.db.prepare('DELETE FROM schedules WHERE id = ? AND class_id = ?').run(req.params.scheduleId, req.params.classId);
      kernelContainer.db.prepare('DELETE FROM attendance WHERE schedule_id = ?').run(req.params.scheduleId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/classes/:classId/schedules/batch', (req, res) => {
    try {
      const { schedules } = req.body; // array of { lessonId, scheduledDate, timeSlot, status, notes }
      const db = kernelContainer.db;
      
      const insertStmt = db.prepare(`
        INSERT INTO schedules (id, class_id, lesson_id, scheduled_date, time_slot, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const transaction = db.transaction((items) => {
        for (const item of items) {
          const id = 'sch-' + Math.random().toString(36).slice(2, 10);
          insertStmt.run(
            id,
            req.params.classId,
            item.lessonId || item.lesson_id || '',
            item.scheduledDate || item.scheduled_date || '',
            item.timeSlot || item.time_slot || null,
            item.status || 'scheduled',
            item.notes || null,
            Date.now()
          );
        }
      });
      
      transaction(schedules);
      res.json({ success: true, count: schedules.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== Timetable OCR ====================
  app.post('/api/timetable/ocr', async (req, res) => {
    const startTime = Date.now();
    console.log(`[OCR Start] Starting timetable OCR. Payload size: ${req.body.imageBase64?.length || 0} bytes. Lang: ${req.body.lang || 'zh'}`);
    
    try {
      const { imageBase64, lang = 'zh', providerId } = req.body;

      if (!imageBase64) {
        console.warn(`[OCR Error] Missing imageBase64`);
        return res.status(400).json({ error: 'imageBase64 is required' });
      }

      const base64Content = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const mimeMatch = imageBase64.match(/^data:(image\/[^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

      const prompt = `你是一个专业的课程表识别助手。请仔细分析这张学校教师的周课程表图片，直接提取出所有的课程条目�?

重要指令（非常关键，必须遵守）：
1. 严禁输出任何长篇的推理过程、草稿或思考步骤（如不要输�? <think> 标签及其中的英文/中文思考过程）�?
2. 直接�? JSON 格式输出课程表数据数组，不要有任何前导说明文字或后随文字�?
3. 请立即输出结果，保持极简，避免输出长度超限而被API截断�?

对于每一个课程条目，请提取以下信息：
- dayOfWeek: 星期几（1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六, 7=周日�?
- periodNumber: 第几节课�?1-9�?
- className: 班级名称（例�? "高一(13)"�?"高二(5)"�?
- subject: 科目名称（例�? "信息"�?"劳动"�?"数学"�?
- timeSlot: 上课时间段（例如 "10:50-11:30"）。如果图片中可见，请填入具体时间。通常课表的最左侧或某列（“时间”列）会标注该节次对应的上下课时间（例如�?4节对应�?10:50-11:30”），请将对应的时段填入该节次的所有课程条目中。如果确实不可见则为空字符串
- location: 教室/机房信息（如果图片中可见，例�? "312"），如果不可见则为空字符�?
- teacherName: 教师姓名（如果图片中可见），如果不可见则为空字符�?

请注意：
1. 必须提取课程表中的所有课程条目，不要遗漏
2. 仔细区分不同的星期和节次
3. 只返回一个有效的 JSON 数组，包含在方括�? [] 中，严禁使用 markdown 格式包裹
4. 如果某个字段在图片中不可见，请使用空字符�?

返回格式示例�?
[{"dayOfWeek":1,"periodNumber":1,"className":"高一(13)","subject":"信息","timeSlot":"08:00-08:40","location":"312","teacherName":""}]`;

      let text = '';

      const provider = providerId
        ? kernelContainer.db.prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE id = ?').get(providerId) as StoredAIProvider | undefined
        : undefined;

      if (provider?.api_key) provider.api_key = decryptApiKey(provider.api_key);

      if (provider && provider.api_key && provider.api_key.trim()) {
        let chatUrl = provider.api_url.trim();
        if (!chatUrl.endsWith('/chat/completions')) {
          chatUrl = chatUrl.endsWith('/') ? chatUrl + 'chat/completions' : chatUrl + '/chat/completions';
        }

        console.log(`[OCR Routing] Using AI Provider: ${provider.name} (${provider.model_name}) at URL: ${chatUrl}`);

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.api_key.trim()}`
        };

        const messages = [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Content}`
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ];

        const controller = new AbortController();
        let timeoutTriggered = false;
        const timeout = setTimeout(() => {
          timeoutTriggered = true;
          console.warn(`[OCR Timeout] AI OCR request to ${provider.name} timed out after 300 seconds (300000ms)`);
          controller.abort();
        }, 300000); // 300s timeout

        try {
          console.log(`[OCR Request] Sending fetch request to AI Provider...`);
          const response = await fetch(chatUrl, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              model: provider.model_name,
              messages,
              temperature: 0.1,
              max_tokens: 8192
            })
          });

          clearTimeout(timeout);
          console.log(`[OCR Response] Received response. Status: ${response.status} ${response.statusText}`);

          const responseText = await response.text();
          console.log(`[OCR Response Body] Length: ${responseText?.length || 0} bytes. Preview: ${responseText?.substring(0, 500)}`);

          if (!response.ok) {
            throw new Error(`AI Provider (${provider.name}) request failed (${response.status}): ${responseText || response.statusText}`);
          }

          if (!responseText || !responseText.trim()) {
            throw new Error(lang === 'zh' ? `AI Provider (${provider.name}) 返回了空响应，请检查模型是否支持图片识别。` : `AI Provider (${provider.name}) returned an empty response.`);
          }

          let data: any;
          try {
            data = JSON.parse(responseText);
          } catch (jsonErr) {
            throw new Error(lang === 'zh' ? `AI Provider (${provider.name}) 返回了非 JSON 响应: ${responseText.substring(0, 200)}` : `AI Provider (${provider.name}) returned non-JSON: ${responseText.substring(0, 200)}`);
          }

          text = data.choices?.[0]?.message?.content?.trim() || '';
          if (!text) {
            throw new Error(lang === 'zh' ? `AI Provider (${provider.name}) 未返回有效文本内容。可能该模型不支持图片输入。` : `AI Provider (${provider.name}) returned no text content. The model may not support image input.`);
          }
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          console.error(`[OCR Fetch Error] Detailed Error:`, {
            name: fetchErr.name,
            message: fetchErr.message,
            stack: fetchErr.stack,
            cause: fetchErr.cause,
            timeoutTriggered
          });
          throw fetchErr;
        }
      } else {
        console.log(`[OCR Routing] Using system default Gemini`);
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) {
          console.warn(`[OCR Error] GEMINI_API_KEY is not configured`);
          return res.status(500).json({ error: lang === 'zh' ? '未配�? AI 服务。请在系统设置中添加 AI Provider 或配�? GEMINI_API_KEY�?' : 'No AI provider configured. Please add an AI Provider in settings or set GEMINI_API_KEY.' });
        }

        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Content } },
              { text: prompt }
            ]
          }]
        });

        text = response.text?.trim() || '';
        console.log(`[OCR Gemini Response] Length: ${text?.length || 0} bytes. Preview: ${text?.substring(0, 500)}`);
      }

      // Strip <think> tags if present
      let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      // Find the first '[' and the last ']' to extract the JSON array
      const startIdx = cleanText.indexOf('[');
      const endIdx = cleanText.lastIndexOf(']');
      
      let jsonStr = '';
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonStr = cleanText.substring(startIdx, endIdx + 1).trim();
      } else {
        // Fallback to markdown strip
        jsonStr = cleanText
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
      }

      const entries = JSON.parse(jsonStr);
      console.log(`[OCR Success] Successfully parsed ${entries.length} timetable entries. Time elapsed: ${Date.now() - startTime}ms`);

      res.json({
        success: true,
        entries,
        providerUsed: provider
          ? { id: provider.id, name: provider.name, model_name: provider.model_name }
          : { id: 'system', name: 'Gemini', model_name: 'gemini-2.5-flash' }
      });
    } catch (e: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[OCR Global Catch] Timetable OCR error after ${elapsed}ms:`, {
        name: e.name,
        message: e.message,
        stack: e.stack,
        cause: e.cause
      });
      res.status(500).json({ error: e.message });
    }
  });

}
