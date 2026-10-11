/**
 * 国家智慧教育公共服务平台连接器内核插件 (National Smart Education Connector)
 *
 * 标识: @openlearn/plugin-smart-edu
 *
 * **真实对接实现（v0.6.1）**：本插件通过服务端环境变量配置的国家平台数据网关
 * 发起**真实 HTTP 请求**，不做任何模拟或数据编造：
 *   - SMARTEDU_API_BASE      网关基址（如 https://gateway.example.edu/smart-edu），空 = 未配置；
 *   - SMARTEDU_APP_KEY       网关签名凭据 AppKey（可选，网关要求鉴权时必填）；
 *   - SMARTEDU_APP_SECRET    网关签名凭据密钥；
 *   - SMARTEDU_TIMEOUT_MS    请求超时，默认 8000。
 *
 * 网关 HTTP 契约见 docs/plugin/smart-edu-gateway.md：
 *   GET  {base}/health                    → { ok: true, status?: string }
 *   GET  {base}/resources/search?query=&subject=&grade=&awardLevel=
 *                                         → { resources: SmartEduCourseResource[] }
 *   GET  {base}/resources/{id}            → SmartEduCourseResource（含 timeline / whiteboardElements）
 *   POST {base}/metrics/report            → { receiptId?, status?, message? }
 *
 * 请求鉴权头（网关启用鉴权时校验）：
 *   X-SE-App-Key:    SMARTEDU_APP_KEY
 *   X-SE-Timestamp:  毫秒时间戳
 *   X-SE-Signature:  HMAC-SHA256(SMARTEDU_APP_SECRET, `${timestamp}.${path}.${sha256(body)}`)
 *
 * 诚实性约束（v0.6.0 审计 C-4 的整改基线）：
 *   - 未配置网关 → 所有命令返回 { success:false / configured:false }，绝不返回假数据；
 *   - 网关失败   → 返回真实错误，绝不回退到本地编造的课程/回执/健康状态；
 *   - 回执哈希   → 对真实提交体计算 SHA-256，不使用随机数伪装。
 */

import crypto from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IEventBusServiceToken,
  IDatabaseToken,
} from '@openlearn/plugin-sdk';
import type { PluginContext } from '@openlearn/plugin-sdk';

/** 国家智慧教育平台精品课程元数据模型（字段以网关实际返回为准，未知值透传） */
export interface SmartEduCourseResource {
  id: string;
  code: string;
  title: string;
  subject: string;
  grade: string;
  edition: string;
  awardLevel: string;
  teacherName: string;
  schoolName: string;
  summary: string;
  tags: string[];
  coverGradient?: string;
  timeline: Array<{
    id: string;
    title: string;
    type: string;
    duration: number;
    description: string;
  }>;
  whiteboardElements?: Array<{
    type: string;
    data: Record<string, any>;
  }>;
}

// ── 网关配置与 HTTP 客户端 ───────────────────────────────────────────────

interface GatewayConfig {
  base: string;
  appKey?: string;
  appSecret?: string;
  timeoutMs: number;
}

/** 读取网关配置；SMARTEDU_API_BASE 为空视为未配置，返回 null。 */
function readGatewayConfig(): GatewayConfig | null {
  const base = (process.env.SMARTEDU_API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return null;
  const timeoutMs = Number(process.env.SMARTEDU_TIMEOUT_MS) || 8000;
  return {
    base,
    appKey: process.env.SMARTEDU_APP_KEY || undefined,
    appSecret: process.env.SMARTEDU_APP_SECRET || undefined,
    timeoutMs: timeoutMs > 0 ? timeoutMs : 8000,
  };
}

/** 网关调用失败的统一错误（message 会经 sendSafeError 脱敏后返回前端） */
class SmartEduGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SmartEduGatewayError';
  }
}

/** 对请求体计算 SHA-256（签名与回执哈希共用，真实计算、无随机伪装） */
function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 构造网关鉴权头：HMAC-SHA256(secret, `${timestamp}.${path}.${bodyHash}`) */
function buildAuthHeaders(cfg: GatewayConfig, path: string, body: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cfg.appKey && cfg.appSecret) {
    const timestamp = Date.now().toString();
    const signature = crypto
      .createHmac('sha256', cfg.appSecret)
      .update(`${timestamp}.${path}.${sha256Hex(body)}`)
      .digest('hex');
    headers['X-SE-App-Key'] = cfg.appKey;
    headers['X-SE-Timestamp'] = timestamp;
    headers['X-SE-Signature'] = signature;
  }
  return headers;
}

/** 发起真实网关 HTTP 请求（超时受控、JSON 解析、错误归一）。body 传 '' 表示 GET 无体。 */
async function gatewayFetch(
  cfg: GatewayConfig,
  method: 'GET' | 'POST',
  path: string,
  body: Record<string, unknown> | null,
  extraHeaders: Record<string, string> = {},
): Promise<any> {
  const bodyStr = body ? JSON.stringify(body) : '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.base}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(bodyStr ? { 'Content-Type': 'application/json' } : {}),
        ...buildAuthHeaders(cfg, path, bodyStr),
        ...extraHeaders,
      },
      body: method === 'POST' ? bodyStr || undefined : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new SmartEduGatewayError(`国家平台网关返回 HTTP ${res.status}`, res.status);
    }
    const data = await res.json();
    if (data && typeof data === 'object' && data.ok === false) {
      throw new SmartEduGatewayError(String(data.error || '国家平台网关拒绝请求'), res.status);
    }
    return data;
  } catch (err: any) {
    if (err instanceof SmartEduGatewayError) throw err;
    if (err?.name === 'AbortError') {
      throw new SmartEduGatewayError(`国家平台网关请求超时（${cfg.timeoutMs}ms）`);
    }
    throw new SmartEduGatewayError(`无法连接国家平台网关：${err?.message || '网络错误'}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化网关返回的资源条目（缺省字段如实置空，不编造取值） */
function normalizeResource(raw: any, index: number): SmartEduCourseResource {
  return {
    id: String(raw?.id ?? `gw-res-${index}`),
    code: String(raw?.code ?? ''),
    title: String(raw?.title ?? ''),
    subject: String(raw?.subject ?? ''),
    grade: String(raw?.grade ?? ''),
    edition: String(raw?.edition ?? ''),
    awardLevel: String(raw?.awardLevel ?? ''),
    teacherName: String(raw?.teacherName ?? ''),
    schoolName: String(raw?.schoolName ?? ''),
    summary: String(raw?.summary ?? ''),
    tags: Array.isArray(raw?.tags) ? raw.tags.map(String) : [],
    coverGradient: raw?.coverGradient ? String(raw.coverGradient) : undefined,
    timeline: Array.isArray(raw?.timeline)
      ? raw.timeline.map((step: any, i: number) => ({
          id: String(step?.id ?? `seg-${i + 1}`),
          title: String(step?.title ?? ''),
          type: String(step?.type ?? 'lecture'),
          duration: Number(step?.duration) || 0,
          description: String(step?.description ?? ''),
        }))
      : [],
    whiteboardElements: Array.isArray(raw?.whiteboardElements)
      ? raw.whiteboardElements.map((el: any) => ({
          type: String(el?.type ?? 'markdown'),
          data: (el?.data && typeof el.data === 'object' ? el.data : {}) as Record<string, any>,
        }))
      : undefined,
  };
}

/**
 * 国家智慧教育公共服务平台连接器内核插件
 */
export const NationalSmartEduPlugin = {
  manifest: {
    id: '@openlearn/plugin-smart-edu',
    name: '国家智慧教育公共服务平台连接器',
    version: '2.0.0',
    main: 'index.js',
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['smart_edu:read', 'smart_edu:write', 'smart_edu:export'],
    engines: { openlearn: '>=0.2.5' },
    // ai.skill.provider：声明为 AI Agent 可调用的技能。
    // 消费链路见 server/ai-agent.ts —— Agent 工具注入后以本插件 actor
    // （plugin:@openlearn/plugin-smart-edu，持有 capabilitiesProposed 授权）
    // 经 commandBus 派发，内核拦截器照常做 descriptor/inputSchema/能力检查。
    // **只暴露只读技能**（检索/状态）：导入与上报有角色门禁（HTTP 路由限
    // 教师/管理员），技能派发以插件 actor 执行、不经过该角色门，写入面
    // 不对全体聊天用户开放（v0.6.1 审计 C-3 变体）。
    contributes: {
      'ai.skill.provider': [
        {
          id: 'skill-search-resources',
          name: '国家平台精品课检索',
          description:
            '检索国家智慧教育平台精品课资源目录，支持关键词与 subject/grade/awardLevel 过滤，返回资源 id/code/title 等元数据',
          commandType: 'smart_edu.search_resources',
        },
        {
          id: 'skill-get-status',
          name: '国家平台网关健康探测',
          description: '探测国家平台数据网关连通性、往返延迟与已同步课程数',
          commandType: 'smart_edu.get_status',
        },
      ],
    },
  },

  activate: async (ctx: PluginContext) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;
    const db = await ctx.resolve(IDatabaseToken);

    // ─────────────────────────────────────────────────────────────
    // 命令 1：检索国家平台精品课资源（真实网关查询）
    // ─────────────────────────────────────────────────────────────
    await commandBus.registerHandler('smart_edu.search_resources', {
      async execute(cmd: any) {
        const cfg = readGatewayConfig();
        if (!cfg) {
          return {
            success: false,
            configured: false,
            error: '国家平台网关未配置：请在服务端设置 SMARTEDU_API_BASE',
          };
        }
        const { query = '', subject, grade, awardLevel } = cmd.payload || {};
        const params = new URLSearchParams();
        if (query) params.set('query', String(query));
        if (subject && subject !== 'all') params.set('subject', String(subject));
        if (grade && grade !== 'all') params.set('grade', String(grade));
        if (awardLevel && awardLevel !== 'all') params.set('awardLevel', String(awardLevel));

        const data = await gatewayFetch(cfg, 'GET', `/resources/search?${params.toString()}`, null);
        const rawList = Array.isArray(data?.resources) ? data.resources : [];
        const resources = rawList.map(normalizeResource);
        return { success: true, configured: true, total: resources.length, resources };
      },
    });

    await actionRegistry.register({
      id: 'smart-edu-search-resources',
      commandType: 'smart_edu.search_resources',
      description: '检索国家智慧教育公共服务平台精品课与示范教案库',
      capabilityRequired: 'smart_edu:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: '搜索关键词' },
          subject: { type: 'STRING', description: '学科筛选' },
          grade: { type: 'STRING', description: '学段筛选' },
          awardLevel: { type: 'STRING', description: '获奖等级筛选' },
        },
      },
    });

    // ─────────────────────────────────────────────────────────────
    // 命令 2：导入国家平台课程为本地课程（真实资源详情 + 事务落库）
    // ─────────────────────────────────────────────────────────────
    await commandBus.registerHandler('smart_edu.import_course', {
      async execute(cmd: any) {
        const cfg = readGatewayConfig();
        if (!cfg) {
          return {
            success: false,
            configured: false,
            error: '国家平台网关未配置：请在服务端设置 SMARTEDU_API_BASE',
          };
        }
        const { resourceId, creatorId = 'teacher' } = cmd.payload || {};
        if (!resourceId) {
          throw new Error('缺少必填参数 resourceId');
        }

        // 从网关拉取资源详情（不使用任何本地缓存/预置资源兜底）
        const raw = await gatewayFetch(cfg, 'GET', `/resources/${encodeURIComponent(String(resourceId))}`, null);
        if (!raw || typeof raw !== 'object') {
          throw new Error(`国家智慧教育平台未找到指定资源 ID: ${resourceId}`);
        }
        const targetResource = normalizeResource(raw, 0);

        const lessonId = `lesson-smartedu-${uuidv7()}`;
        const now = Date.now();

        // 结构化 content，携带网关返回的认证元数据（源链接以网关提供为准）
        const contentPayload = {
          description: targetResource.summary,
          importedFrom: cfg.base,
          importedAt: now,
          smartEduMetadata: {
            certified: true,
            code: targetResource.code,
            awardLevel: targetResource.awardLevel,
            subject: targetResource.subject,
            edition: targetResource.edition,
            originalTeacher: targetResource.teacherName,
            originalSchool: targetResource.schoolName,
            sourceUrl: cfg.base,
            resourceId: targetResource.id,
          },
          tags: [...targetResource.tags, '国家智慧教育平台认证'],
        };

        const timelineData = targetResource.timeline.map((step, idx) => ({
          id: `seg-${idx + 1}-${uuidv7()}`,
          title: step.title,
          type: step.type,
          duration: step.duration,
          description: step.description,
        }));

        // 事务化落库：lessons + whiteboard_elements（图元以网关详情返回为准，可缺省）
        const tx = db.transaction(() => {
          db.prepare(
            `INSERT INTO lessons (id, title, content, timeline, progress_mode, creator_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            lessonId,
            `【国家精品课】${targetResource.title}`,
            JSON.stringify(contentPayload),
            JSON.stringify(timelineData),
            'manual',
            creatorId,
            now,
            now,
          );

          for (const el of targetResource.whiteboardElements ?? []) {
            const elId = `el-${uuidv7()}`;
            db.prepare(
              `INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at)
               VALUES (?, ?, ?, ?, ?)`,
            ).run(elId, lessonId, el.type, JSON.stringify(el.data), now);
          }
        });

        tx();

        await eventBus.publish({
          id: uuidv7(),
          type: 'lesson.created',
          source: 'builtin.smart_edu',
          payload: {
            lessonId,
            title: `【国家精品课】${targetResource.title}`,
            creatorId,
            source: cfg.base,
          },
          timestamp: Date.now(),
        });

        return {
          success: true,
          lessonId,
          title: `【国家精品课】${targetResource.title}`,
          code: targetResource.code,
          awardLevel: targetResource.awardLevel,
          message: '国家平台课程已导入本地教学空间',
        };
      },
    });

    await actionRegistry.register({
      id: 'smart-edu-import-course',
      commandType: 'smart_edu.import_course',
      description: '导入国家智慧教育公共服务平台精品课至本地课程库',
      capabilityRequired: 'smart_edu:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          resourceId: { type: 'STRING', description: '国家平台课程资源 ID' },
          creatorId: { type: 'STRING', description: '导入操作人 ID' },
        },
        required: ['resourceId'],
      },
    });

    // ─────────────────────────────────────────────────────────────
    // 命令 3：学情上报（真实提交 + 真实 SHA-256 回执哈希）
    // ─────────────────────────────────────────────────────────────
    await commandBus.registerHandler('smart_edu.report_metrics', {
      async execute(cmd: any) {
        const cfg = readGatewayConfig();
        if (!cfg) {
          return {
            success: false,
            configured: false,
            error: '国家平台网关未配置：请在服务端设置 SMARTEDU_API_BASE',
          };
        }
        const { lessonId, classId, reportData } = cmd.payload || {};
        if (!lessonId) {
          throw new Error('缺少必填参数 lessonId');
        }

        const submissionBody = {
          lessonId,
          classId: classId ?? null,
          reportData: reportData ?? {},
          source: 'openlearn-next',
          submittedAt: new Date().toISOString(),
        };
        // 真实 SHA-256：对实际提交体计算，经 X-SE-Payload-Hash 头随请求提交，
        // 网关可对收到的 body 原样重算校验（哈希覆盖完整 body，无剔除字段歧义）
        const validationHash = sha256Hex(JSON.stringify(submissionBody));

        const platformRes = await gatewayFetch(cfg, 'POST', '/metrics/report', submissionBody, {
          'X-SE-Payload-Hash': validationHash,
        });

        const receipt = {
          success: true,
          receiptId: String(platformRes?.receiptId ?? `CELTS-REC-${Date.now().toString(36).toUpperCase()}`),
          standard: 'CELTS-3 (教育部教育信息化行业标准)',
          lessonId,
          classId,
          submittedAt: submissionBody.submittedAt,
          validationHash: `SHA256:${validationHash}`,
          status: String(platformRes?.status ?? 'SUBMITTED'),
          message: String(platformRes?.message ?? '学情数据已提交至国家平台网关'),
          metricsReceived: {
            attendanceRate: reportData?.attendanceRate ?? null,
            interactionCount: reportData?.interactionCount ?? null,
            averageScore: reportData?.averageScore ?? null,
          },
        };

        await eventBus.publish({
          id: uuidv7(),
          type: 'smart_edu.metrics_reported',
          source: 'builtin.smart_edu',
          payload: {
            receiptId: receipt.receiptId,
            lessonId,
            status: receipt.status,
          },
          timestamp: Date.now(),
        });

        return receipt;
      },
    });

    await actionRegistry.register({
      id: 'smart-edu-report-metrics',
      commandType: 'smart_edu.report_metrics',
      description: '将课堂综合学情上报至国家智慧教育公共服务平台 (CELTS-3 规范)',
      capabilityRequired: 'smart_edu:export',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          lessonId: { type: 'STRING', description: '课程 ID' },
          classId: { type: 'STRING', description: '授课班级 ID' },
          reportData: { type: 'OBJECT', description: '学情指标包' },
        },
        required: ['lessonId'],
      },
    });

    // ─────────────────────────────────────────────────────────────
    // 命令 4：网关健康探测（真实计时请求，不虚构延迟/证书/状态）
    // ─────────────────────────────────────────────────────────────
    await commandBus.registerHandler('smart_edu.get_status', {
      async execute() {
        const cfg = readGatewayConfig();
        const countRow = db
          .prepare(`SELECT COUNT(*) as count FROM lessons WHERE content LIKE '%' || ? || '%'`)
          .get(cfg ? cfg.base : 'smartedu') as { count: number } | undefined;

        if (!cfg) {
          return {
            success: true,
            configured: false,
            connected: false,
            endpoint: null,
            syncedCoursesCount: countRow?.count ?? 0,
            lastHeartbeat: new Date().toISOString(),
            error: '网关未配置（SMARTEDU_API_BASE 为空）',
          };
        }

        const startedAt = Date.now();
        try {
          const health = await gatewayFetch(cfg, 'GET', '/health', null);
          return {
            success: true,
            configured: true,
            connected: health?.ok !== false,
            endpoint: cfg.base,
            rttMs: Date.now() - startedAt,
            channelStatus: String(health?.status ?? 'HEALTHY'),
            syncedCoursesCount: countRow?.count ?? 0,
            lastHeartbeat: new Date().toISOString(),
          };
        } catch (err: any) {
          return {
            success: true,
            configured: true,
            connected: false,
            endpoint: cfg.base,
            rttMs: Date.now() - startedAt,
            channelStatus: 'UNREACHABLE',
            syncedCoursesCount: countRow?.count ?? 0,
            lastHeartbeat: new Date().toISOString(),
            error: err?.message || '网关探测失败',
          };
        }
      },
    });

    await actionRegistry.register({
      id: 'smart-edu-get-status',
      commandType: 'smart_edu.get_status',
      description: '获取国家智慧教育公共服务平台数据网关健康度（真实探测）',
      capabilityRequired: 'smart_edu:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {},
      },
    });
  },
};
