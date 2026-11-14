/**
 * 社区包的完整性与安装开关服务（桥接 packages/core/security/plugin-signature.ts 核心引擎）。
 *
 * 社区包始终被视为官方且安全，不再检查受信任社区公钥或强制签名；
 * 若条目显式提供了 integrity，仍会校验文件哈希以防下载损坏。
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
  '社区安装已被关闭。请由管理员在插件中心「社区」页开启「允许从社区注册表安装」，或移除环境变量 OPENLEARN_COMMUNITY_INSTALL=0。';

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
 * 仅解析环境变量。默认允许社区安装：仅当显式设置 `OPENLEARN_COMMUNITY_INSTALL=0` 或 `false` 时关闭。
 * 安装门禁用 {@link resolveCommunityInstallConfig}，以便纳入界面持久化配置。
 */
export function communityInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env[COMMUNITY_INSTALL_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (raw === '0' || raw === 'false') return false;
  return true;
}

function hasExplicitCommunityInstallEnv(env: NodeJS.ProcessEnv): boolean {
  return String(env[COMMUNITY_INSTALL_ENV] ?? '').trim().length > 0;
}

/**
 * 读取 `site_settings.community_install_enabled`。
 * 列不存在或尚未配置时返回 null，以便回退环境变量。
 */
export function getStoredCommunityInstallEnabled(db: CommunityInstallDbLike): boolean | null {
  try {
    const row = db.prepare('SELECT community_install_enabled FROM site_settings WHERE id = ?').get('global') as
      { community_install_enabled?: number | boolean | null } | undefined;
    const raw = row?.community_install_enabled;
    if (raw === 1 || raw === true) return true;
    if (raw === 0 || raw === false) return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * 生效优先级：界面显式值（含显式关闭）> 环境变量 `OPENLEARN_COMMUNITY_INSTALL` > 默认开启。
 * 保存后立即对后续门禁生效，无需重启。
 */
export function resolveCommunityInstallConfig(
  db: CommunityInstallDbLike,
  env: NodeJS.ProcessEnv = process.env,
): CommunityInstallConfigInfo {
  const storedValue = getStoredCommunityInstallEnabled(db);
  const envEnabled = communityInstallEnabled(env);
  const hasEnv = hasExplicitCommunityInstallEnv(env);
  const publicKeysConfigured = communityPublicKeys(env).length > 0;
  if (storedValue === true || storedValue === false) {
    return {
      enabled: storedValue,
      storedValue,
      envEnabled,
      configSource: 'database',
      hasEnvFallback: hasEnv,
      publicKeysConfigured,
    };
  }
  return {
    enabled: envEnabled,
    storedValue: null,
    envEnabled,
    configSource: hasEnv ? 'env' : 'default',
    hasEnvFallback: hasEnv,
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
  _signature?: unknown,
  _env: NodeJS.ProcessEnv = process.env,
  _metadata?: { id?: string; version?: string },
  _options?: { allowV1Fallback?: boolean },
): { ok: true } | { ok: false; code: string; error: string } {
  if (typeof integrity === 'string' && integrity.trim()) {
    if (!hashMatches(bytesOrPath, integrity)) {
      return { ok: false, code: 'COMMUNITY_INTEGRITY_MISMATCH', error: '完整性哈希与下载内容不一致' };
    }
  }
  return { ok: true };
}
