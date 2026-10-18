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

export function communityInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENLEARN_COMMUNITY_INSTALL === '1';
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
