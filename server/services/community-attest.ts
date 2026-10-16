/**
 * 社区包的完整性与签名。
 *
 * “已认证”只表示：ZIP 字节的哈希与登记的 integrity 一致，
 * 且该 integrity 字符串（或绑定的元数据载荷）带有 OPENLEARN_COMMUNITY_PUBKEY 的 Ed25519 签名。
 * 注册表 JSON 里的 verified 字段不参与这个判断。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export function communityInstallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENLEARN_COMMUNITY_INSTALL === '1';
}

export function communityPublicKeyPem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OPENLEARN_COMMUNITY_PUBKEY;
  if (!raw || !raw.trim()) return null;
  return raw.replace(/\\n/g, '\n').trim();
}

export function computeSha256(input: Buffer | string): { hex: string; base64: string } {
  const hash = crypto.createHash('sha256');
  if (typeof input === 'string') {
    if (fs.existsSync(input)) {
      const fd = fs.openSync(input, 'r');
      const buf = Buffer.alloc(64 * 1024);
      let bytesRead = 0;
      try {
        while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
          hash.update(buf.subarray(0, bytesRead));
        }
      } finally {
        fs.closeSync(fd);
      }
      const digest = hash.digest();
      return { hex: digest.toString('hex'), base64: digest.toString('base64') };
    }
    hash.update(Buffer.from(input, 'utf8'));
    const digest = hash.digest();
    return { hex: digest.toString('hex'), base64: digest.toString('base64') };
  }
  hash.update(input);
  const digest = hash.digest();
  return { hex: digest.toString('hex'), base64: digest.toString('base64') };
}

export function hashMatches(input: Buffer | string, integrity: string): boolean {
  const expected = integrity.trim();
  const { hex, base64 } = computeSha256(input);
  if (expected.startsWith('sha256-')) {
    return expected.slice('sha256-'.length) === base64;
  }
  return expected.toLowerCase() === hex.toLowerCase();
}

/** 签名覆盖 integrity 字符串或绑定元数据的载荷。 */
export function signatureMatches(
  integrity: string,
  signature: string,
  pem: string,
  metadata?: { id?: string; version?: string },
): boolean {
  try {
    const key = crypto.createPublicKey(pem);
    const sig = Buffer.from(signature.trim(), 'base64');
    // 若提供了 metadata，优先验证带绑定元数据的结构化载荷
    if (metadata && metadata.id) {
      const boundPayload = `openlearn-plugin-attestation-v2\n${metadata.id}\n${metadata.version || ''}\n${integrity.trim()}`;
      if (crypto.verify(null, Buffer.from(boundPayload, 'utf8'), key, sig)) {
        return true;
      }
      // 当明确指定了预期 id 与 version 时，禁止降级回退到无元数据的裸哈希签名
      if (metadata.version !== undefined) {
        return false;
      }
    }
    // 仅在未指定完整版本元数据时，向后兼容验证 integrity 原文签名
    return crypto.verify(null, Buffer.from(integrity.trim(), 'utf8'), key, sig);
  } catch {
    return false;
  }
}

export function verifyCommunityPackage(
  bytesOrPath: Buffer | string,
  integrity: unknown,
  signature: unknown,
  env: NodeJS.ProcessEnv = process.env,
  metadata?: { id?: string; version?: string },
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
  if (!hashMatches(bytesOrPath, integrity)) {
    return { ok: false, code: 'COMMUNITY_INTEGRITY_MISMATCH', error: '完整性哈希与下载内容不一致' };
  }
  if (!signatureMatches(integrity, signature, pem, metadata)) {
    return { ok: false, code: 'COMMUNITY_SIGNATURE_INVALID', error: '社区包签名校验失败' };
  }
  return { ok: true };
}
