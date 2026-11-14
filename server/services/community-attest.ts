/**
 * 社区包的完整性与签名服务（桥接 packages/core/security/plugin-signature.ts 核心引擎）。
 *
 * “已认证”只表示：ZIP 字节的哈希与登记的 integrity 一致，
 * 且该 integrity 字符串（或绑定的元数据载荷）带有 OPENLEARN_COMMUNITY_PUBKEY 的 Ed25519 签名。
 * 注册表 JSON 里的 verified 字段不参与这个判断。
 */

import {
  computeSha256,
  hashMatches,
  verifySignature,
  resolveTrustedPublicKeys,
} from '../../packages/core/security/plugin-signature.js';

export { computeSha256, hashMatches };

export const COMMUNITY_INSTALL_ENV = 'OPENLEARN_COMMUNITY_INSTALL';

export const COMMUNITY_INSTALL_DISABLED_MESSAGE =
  '社区安装默认关闭。请由管理员在插件中心「社区」页开启「允许从社区注册表安装」。未在界面配置时，也可由部署者设置 OPENLEARN_COMMUNITY_INSTALL=1 作为回退。';

export type CommunityInstallConfigSource = 'database' | 'env' | 'default';

export interface CommunityInstallConfigInfo {
  /** 对安装/更新门禁生效的最终值。 */
  enabled: boolean;
  /** 界面持久化的显式值；null 表示未配置，回退环境变量。 */
  storedValue: boolean | null;
  envEnabled: boolean;
  configSource: CommunityInstallConfigSource;
  /** 环境变量是否为 1，供界面提示「清除后将回退到环境变量」。 */
  hasEnvFallback: boolean;
  /** 是否已配置社区验签公钥（不返回密钥本身）。 */
  publicKeysConfigured: boolean;
}

export interface CommunityInstallDbLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

/**
 * 仅解析环境变量。历史默认关闭：只有显式 `OPENLEARN_COMMUNITY_INSTALL=1` 才为 true。
 * 安装门禁用 {@link resolveCommunityInstallConfig}，以便纳入界面持久化配置。
 */
export function communityInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[COMMUNITY_INSTALL_ENV] === '1';
}

/**
 * 读取 `site_settings.community_install_enabled`。
 * 列不存在或尚未配置时返回 null，以便回退环境变量。
 */
export function getStoredCommunityInstallEnabled(db: CommunityInstallDbLike): boolean | null {
  try {
    const row = db
      .prepare('SELECT community_install_enabled FROM site_settings WHERE id = ?')
      .get('global') as { community_install_enabled?: number | boolean | null } | undefined;
    const raw = row?.community_install_enabled;
    if (raw === 1 || raw === true) return true;
    if (raw === 0 || raw === false) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * 生效优先级：界面显式值（含显式关闭）> 环境变量 `OPENLEARN_COMMUNITY_INSTALL=1` > 默认关闭。
 * 保存后立即对后续门禁生效，无需重启。
 */
export function resolveCommunityInstallConfig(
  db: CommunityInstallDbLike,
  env: NodeJS.ProcessEnv = process.env,
): CommunityInstallConfigInfo {
  const storedValue = getStoredCommunityInstallEnabled(db);
  const envEnabled = communityInstallEnabled(env);
  const publicKeysConfigured = communityPublicKeys(env).length > 0;
  if (storedValue === true || storedValue === false) {
    return {
      enabled: storedValue,
      storedValue,
      envEnabled,
      configSource: 'database',
      hasEnvFallback: envEnabled,
      publicKeysConfigured,
    };
  }
  return {
    enabled: envEnabled,
    storedValue: null,
    envEnabled,
    configSource: envEnabled ? 'env' : 'default',
    hasEnvFallback: envEnabled,
    publicKeysConfigured,
  };
}

/** 传入 null 表示清除界面覆盖，回退到环境变量或默认关闭。 */
export function setStoredCommunityInstallEnabled(
  db: CommunityInstallDbLike,
  value: boolean | null,
  env: NodeJS.ProcessEnv = process.env,
): CommunityInstallConfigInfo {
  if (value === null) {
    db.prepare(
      `INSERT INTO site_settings (id, community_install_enabled) VALUES ('global', NULL)
       ON CONFLICT(id) DO UPDATE SET community_install_enabled = NULL`,
    ).run();
  } else {
    db.prepare(
      `INSERT INTO site_settings (id, community_install_enabled) VALUES ('global', ?)
       ON CONFLICT(id) DO UPDATE SET community_install_enabled = excluded.community_install_enabled`,
    ).run(value ? 1 : 0);
  }
  return resolveCommunityInstallConfig(db, env);
}

export function communityPublicKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  return resolveTrustedPublicKeys([], env);
}

export function communityPublicKeyPem(env: NodeJS.ProcessEnv = process.env): string | null {
  const keys = communityPublicKeys(env);
  return keys[0] || null;
}

/** 签名覆盖 integrity 字符串或绑定元数据的载荷。 */
export function signatureMatches(
  integrity: string,
  signature: string,
  pemOrKeys: string | string[],
  metadata?: { id?: string; version?: string },
  options?: { allowV1Fallback?: boolean },
): boolean {
  const allowV1 = options?.allowV1Fallback ?? (!metadata || !metadata.id);
  const res = verifySignature(integrity, signature, pemOrKeys, metadata, { allowV1Fallback: allowV1 });
  return res.ok;
}

export function verifyCommunityPackage(
  bytesOrPath: Buffer | string,
  integrity: unknown,
  signature: unknown,
  env: NodeJS.ProcessEnv = process.env,
  metadata?: { id?: string; version?: string },
  options?: { allowV1Fallback?: boolean },
): { ok: true } | { ok: false; code: string; error: string } {
  if (typeof integrity !== 'string' || !integrity.trim() || typeof signature !== 'string' || !signature.trim()) {
    return {
      ok: false,
      code: 'COMMUNITY_ATTESTATION_REQUIRED',
      error: '社区包必须同时提供 integrity 与 signature',
    };
  }
  const keys = communityPublicKeys(env);
  if (keys.length === 0) {
    return {
      ok: false,
      code: 'COMMUNITY_PUBKEY_MISSING',
      error: '未配置受信任社区公钥 (OPENLEARN_COMMUNITY_PUBKEY 或 OPENLEARN_TRUSTED_PUBKEYS)，拒绝安装社区包',
    };
  }
  if (!hashMatches(bytesOrPath, integrity)) {
    return { ok: false, code: 'COMMUNITY_INTEGRITY_MISMATCH', error: '完整性哈希与下载内容不一致' };
  }
  const allowV1 = options?.allowV1Fallback ?? (!metadata || !metadata.id);
  if (!signatureMatches(integrity, signature, keys, metadata, { allowV1Fallback: allowV1 })) {
    return { ok: false, code: 'COMMUNITY_SIGNATURE_INVALID', error: '社区包签名校验失败' };
  }
  return { ok: true };
}
