/**
 * 社区包的完整性与签名。
 *
 * “已认证”只表示：ZIP 字节的哈希与登记的 integrity 一致，
 * 且该 integrity 字符串带有 OPENLEARN_COMMUNITY_PUBKEY 的 Ed25519 签名。
 * 注册表 JSON 里的 verified 字段不参与这个判断。
 */

import crypto from 'node:crypto';

export function communityInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENLEARN_COMMUNITY_INSTALL === '1';
}

export function communityPublicKeyPem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OPENLEARN_COMMUNITY_PUBKEY;
  if (!raw || !raw.trim()) return null;
  return raw.replace(/\\n/g, '\n').trim();
}

export function hashMatches(bytes: Buffer, integrity: string): boolean {
  const expected = integrity.trim();
  const hash = crypto.createHash('sha256').update(bytes);
  if (expected.startsWith('sha256-')) {
    return expected.slice('sha256-'.length) === hash.digest('base64');
  }
  return expected.toLowerCase() === hash.digest('hex').toLowerCase();
}

/** 签名覆盖 integrity 字符串本身的 UTF-8 字节，而不是 ZIP 原文。 */
export function signatureMatches(integrity: string, signature: string, pem: string): boolean {
  try {
    const key = crypto.createPublicKey(pem);
    const sig = Buffer.from(signature.trim(), 'base64');
    return crypto.verify(null, Buffer.from(integrity.trim(), 'utf8'), key, sig);
  } catch {
    return false;
  }
}

export function verifyCommunityPackage(
  bytes: Buffer,
  integrity: unknown,
  signature: unknown,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; code: string; error: string } {
  if (typeof integrity !== 'string' || !integrity.trim() || typeof signature !== 'string' || !signature.trim()) {
    return {
      ok: false,
      code: 'COMMUNITY_ATTESTATION_REQUIRED',
      error: '社区包必须同时提供 integrity 与 signature',
    };
  }
  const pem = communityPublicKeyPem(env);
  if (!pem) {
    return {
      ok: false,
      code: 'COMMUNITY_PUBKEY_MISSING',
      error: '未配置 OPENLEARN_COMMUNITY_PUBKEY，拒绝安装社区包',
    };
  }
  if (!hashMatches(bytes, integrity)) {
    return { ok: false, code: 'COMMUNITY_INTEGRITY_MISMATCH', error: '完整性哈希与下载内容不一致' };
  }
  if (!signatureMatches(integrity, signature, pem)) {
    return { ok: false, code: 'COMMUNITY_SIGNATURE_INVALID', error: '社区包签名校验失败' };
  }
  return { ok: true };
}
