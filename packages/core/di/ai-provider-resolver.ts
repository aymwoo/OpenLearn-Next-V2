import type BetterSqlite3 from 'better-sqlite3';
import { decryptApiKey } from './api-key-crypto.js';

export interface StoredAIProvider {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  model_name: string;
  owner_id?: string | null;
  is_shared?: number;
  created_at?: number;
  updated_at?: number;
}

export interface ResolveAiProviderOptions {
  providerId?: string | null;
  userId?: string | null;
  lang?: string;
}

export class AiProviderError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = 'AI_PROVIDER_ERROR') {
    super(message);
    this.name = 'AiProviderError';
    this.status = status;
    this.code = code;
  }
}

function hasOwnerColumns(db: BetterSqlite3.Database): boolean {
  try {
    const cols = db.prepare('PRAGMA table_info(ai_providers)').all() as { name: string }[];
    return cols.some((c) => c.name === 'owner_id');
  } catch {
    return false;
  }
}

/**
 * 校验并解析当前用户有权使用的 AI Provider。
 *
 * 访问控制规则（Issue #383）：
 * 1. 显式指定 providerId 时：
 *    - 若记录不存在，抛出 404 (PROVIDER_NOT_FOUND)；
 *    - 若记录存在，但既不是该用户创建的私有模型（owner_id === userId），
 *      也不是平台共享模型（is_shared === 1），抛出 403 (PROVIDER_ACCESS_DENIED)；
 * 2. 未指定 providerId 时（兜底模式）：
 *    - 仅在当前用户可访问范围内查找可用提供商：
 *      本人私有模型（owner_id = userId）优先，其次平台共享模型（is_shared = 1）；
 *    - 绝不跨账号使用其他用户的私有模型；
 *    - 若无可用的非空密钥模型，抛出 400 (NO_AI_PROVIDER)；
 * 3. 密钥自动解密，若解密后为空则视为未配置。
 */
export function resolveAccessibleAiProvider(
  db: BetterSqlite3.Database,
  options: ResolveAiProviderOptions = {},
): StoredAIProvider {
  const { providerId, userId, lang = 'zh' } = options;
  const supportsOwner = hasOwnerColumns(db);

  let provider: StoredAIProvider | undefined;

  if (providerId) {
    const row = supportsOwner
      ? (db
          .prepare(
            'SELECT id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at FROM ai_providers WHERE id = ?',
          )
          .get(providerId) as StoredAIProvider | undefined)
      : (db.prepare('SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE id = ?').get(providerId) as
          StoredAIProvider | undefined);

    if (!row) {
      throw new AiProviderError(
        lang === 'zh' ? '未找到指定的 AI 提供商' : 'Specified AI Provider not found',
        404,
        'PROVIDER_NOT_FOUND',
      );
    }

    if (supportsOwner) {
      const isShared = Number(row.is_shared) === 1 || row.owner_id === null;
      const isOwner = Boolean(userId && row.owner_id === userId);

      if (!isShared && !isOwner) {
        throw new AiProviderError(
          lang === 'zh'
            ? '无权使用该 AI 提供商（非本人私有且未共享）'
            : 'Forbidden: You do not have access to this private AI provider',
          403,
          'PROVIDER_ACCESS_DENIED',
        );
      }
    }

    provider = row;
  } else {
    // 自动兜底查询
    if (!supportsOwner) {
      provider = db
        .prepare(
          "SELECT id, name, api_url, api_key, model_name FROM ai_providers WHERE api_key IS NOT NULL AND api_key != '' ORDER BY created_at DESC LIMIT 1",
        )
        .get() as StoredAIProvider | undefined;
    } else if (userId) {
      provider = db
        .prepare(
          `SELECT id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at
           FROM ai_providers
           WHERE (owner_id = ? OR is_shared = 1 OR owner_id IS NULL)
             AND api_key IS NOT NULL AND api_key != ''
           ORDER BY (CASE WHEN owner_id = ? THEN 0 WHEN is_shared = 1 THEN 1 ELSE 2 END), created_at DESC
           LIMIT 1`,
        )
        .get(userId, userId) as StoredAIProvider | undefined;
    } else {
      // 无 userId（如未登录环境或未绑定上下文的系统任务）：使用平台共享或预设 Provider
      provider = db
        .prepare(
          `SELECT id, name, api_url, api_key, model_name, owner_id, is_shared, created_at, updated_at
           FROM ai_providers
           WHERE (is_shared = 1 OR owner_id IS NULL)
             AND api_key IS NOT NULL AND api_key != ''
           ORDER BY (CASE WHEN is_shared = 1 THEN 0 ELSE 1 END), created_at DESC
           LIMIT 1`,
        )
        .get() as StoredAIProvider | undefined;
    }
  }

  if (provider?.api_key) {
    provider.api_key = decryptApiKey(provider.api_key);
  }

  if (!provider || !provider.api_key || !provider.api_key.trim()) {
    throw new AiProviderError(
      lang === 'zh'
        ? '未检测到可用的 AI 提供商。请前往配置大模型服务。'
        : 'No active AI Provider configured. Please add and configure an AI Provider in settings.',
      400,
      'NO_AI_PROVIDER',
    );
  }

  return provider;
}
