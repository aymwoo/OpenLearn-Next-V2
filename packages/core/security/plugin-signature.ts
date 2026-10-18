/**
 * OpenLearn Platform Kernel - Plugin Publisher Signature & Integrity Subsystem
 *
 * Provides cryptographic integrity verification (SHA-256) and publisher identity
 * attestation using Ed25519 asymmetric cryptography.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

export interface PackageSignatureManifest {
  readonly version?: number;
  readonly algorithm?: 'ed25519' | string;
  readonly keyId?: string;
  readonly signature: string;
  readonly publisher?: string;
}

export interface VerifyPluginPackageOptions {
  /** ZIP file path or buffer */
  readonly packageSource: string | Buffer;
  /** Plugin origin: builtin, local (uploaded by admin), or community/remote */
  readonly sourceType: 'builtin' | 'local' | 'community' | 'remote';
  /** Expected plugin metadata from registry or manifest */
  readonly metadata?: {
    readonly id?: string;
    readonly version?: string;
    readonly integrity?: string;
    readonly signature?: string;
    readonly publisher?: string;
  };
  /** List of trusted Ed25519 public keys in PEM format */
  readonly trustedPublicKeys?: string[];
  /** Process environment to resolve fallback keys */
  readonly env?: NodeJS.ProcessEnv;
  /** Whether unsigned packages are allowed for local uploads (defaults to true) */
  readonly allowUnsignedLocal?: boolean;
}

export type VerifyPluginPackageResult =
  | {
      readonly ok: true;
      readonly status: 'trusted_builtin' | 'verified' | 'unverified_local_acknowledged';
      readonly publisher?: string;
      readonly integrity?: string;
      readonly matchedKey?: string;
    }
  | {
      readonly ok: false;
      readonly code:
        | 'COMMUNITY_INTEGRITY_REQUIRED'
        | 'COMMUNITY_ATTESTATION_REQUIRED'
        | 'COMMUNITY_PUBKEY_MISSING'
        | 'COMMUNITY_INTEGRITY_MISMATCH'
        | 'COMMUNITY_SIGNATURE_INVALID'
        | 'LOCAL_INTEGRITY_MISMATCH'
        | 'LOCAL_SIGNATURE_INVALID'
        | 'PACKAGE_READ_ERROR';
      readonly error: string;
    };

/**
 * Compute SHA-256 digest for a Buffer or file path.
 */
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

/**
 * Check if the SHA-256 hash of input matches expected integrity string.
 */
export function hashMatches(input: Buffer | string, integrity: string): boolean {
  if (!integrity || !integrity.trim()) return false;
  const expected = integrity.trim();
  const { hex, base64 } = computeSha256(input);
  if (expected.startsWith('sha256-')) {
    return expected.slice('sha256-'.length) === base64;
  }
  return expected.toLowerCase() === hex.toLowerCase();
}

/**
 * Build deterministic signing payload for attestation.
 */
export function buildAttestationPayload(
  integrity: string,
  metadata?: { id?: string; version?: string },
): Buffer {
  const trimmedHash = integrity.trim();
  if (metadata && metadata.id) {
    const boundPayload = `openlearn-plugin-attestation-v2\n${metadata.id}\n${metadata.version || ''}\n${trimmedHash}`;
    return Buffer.from(boundPayload, 'utf8');
  }
  return Buffer.from(trimmedHash, 'utf8');
}

/**
 * Sign payload using Ed25519 private key PEM.
 */
export function signPayload(payload: Buffer | string, privateKeyPem: string): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const privKey = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, buf, privKey);
  return sig.toString('base64');
}

/**
 * Verify signature against one or more Ed25519 public key PEMs.
 */
export function verifySignature(
  integrity: string,
  signature: string,
  publicKeys: string | string[],
  metadata?: { id?: string; version?: string },
): { ok: boolean; matchedKey?: string } {
  const keys = Array.isArray(publicKeys) ? publicKeys : [publicKeys];
  const sig = Buffer.from(signature.trim(), 'base64');

  for (const pem of keys) {
    if (!pem || !pem.trim()) continue;
    try {
      const pubKey = crypto.createPublicKey(pem.trim());
      // 1. Try v2 bound payload first if metadata.id is provided
      if (metadata && metadata.id) {
        const boundBuf = buildAttestationPayload(integrity, metadata);
        if (crypto.verify(null, boundBuf, pubKey, sig)) {
          return { ok: true, matchedKey: pem };
        }
        // Strict v2: if version was explicitly provided, do not allow falling back to raw hash
        if (metadata.version !== undefined) {
          continue;
        }
      }

      // 2. Fallback to v1 raw hash payload
      const rawBuf = Buffer.from(integrity.trim(), 'utf8');
      if (crypto.verify(null, rawBuf, pubKey, sig)) {
        return { ok: true, matchedKey: pem };
      }
    } catch {
      // Ignore key parsing/crypto error for individual key, continue checking next
    }
  }

  return { ok: false };
}

/**
 * Extract embedded signature.json from a ZIP file if present.
 */
export async function extractEmbeddedSignature(
  zipPathOrBuffer: string | Buffer,
): Promise<PackageSignatureManifest | null> {
  try {
    const JSZip = (await import('jszip')).default;
    let buffer: Buffer;
    if (typeof zipPathOrBuffer === 'string') {
      if (!fs.existsSync(zipPathOrBuffer)) return null;
      buffer = fs.readFileSync(zipPathOrBuffer);
    } else {
      buffer = zipPathOrBuffer;
    }

    const zip = await JSZip.loadAsync(buffer);
    const sigFile = zip.file('signature.json');
    if (!sigFile) return null;

    const content = await sigFile.async('string');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.signature === 'string') {
      return parsed as PackageSignatureManifest;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve trusted public keys from parameters and environment.
 */
export function resolveTrustedPublicKeys(
  explicitKeys?: string[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const keys: string[] = [];
  if (explicitKeys && explicitKeys.length > 0) {
    keys.push(...explicitKeys);
  }

  // 1. OPENLEARN_COMMUNITY_PUBKEY
  const rawCommunity = env.OPENLEARN_COMMUNITY_PUBKEY;
  if (rawCommunity && rawCommunity.trim()) {
    keys.push(rawCommunity.replace(/\\n/g, '\n').trim());
  }

  // 2. OPENLEARN_TRUSTED_PUBKEYS (comma or semicolon separated PEMs/paths)
  const rawTrusted = env.OPENLEARN_TRUSTED_PUBKEYS;
  if (rawTrusted && rawTrusted.trim()) {
    const parts = rawTrusted.split(/;|\n/);
    for (const part of parts) {
      const p = part.trim();
      if (!p) continue;
      if (p.includes('BEGIN PUBLIC KEY')) {
        keys.push(p.replace(/\\n/g, '\n'));
      } else if (fs.existsSync(p)) {
        try {
          keys.push(fs.readFileSync(p, 'utf8').trim());
        } catch {}
      }
    }
  }

  // Deduplicate keys
  return Array.from(new Set(keys.filter((k) => k.length > 0)));
}

/**
 * Comprehensive verification of plugin package integrity and publisher signature.
 */
export async function verifyPluginPackage(
  options: VerifyPluginPackageOptions,
): Promise<VerifyPluginPackageResult> {
  const { packageSource, sourceType, metadata, allowUnsignedLocal = true } = options;
  const env = options.env ?? process.env;

  // 1. Built-in plugins are fully trusted
  if (sourceType === 'builtin') {
    return { ok: true, status: 'trusted_builtin' };
  }

  // 2. Compute package hash
  let calculatedSha: { hex: string; base64: string };
  try {
    calculatedSha = computeSha256(packageSource);
  } catch (err) {
    return {
      ok: false,
      code: 'PACKAGE_READ_ERROR',
      error: `Failed to read plugin package: ${(err as Error).message}`,
    };
  }

  // 3. Resolve integrity string (from metadata or calculate fresh)
  const declaredIntegrity = metadata?.integrity?.trim();
  const effectiveIntegrity = declaredIntegrity || calculatedSha.hex;

  // 4. Resolve signature & publisher (from metadata or embedded signature.json)
  let declaredSignature = metadata?.signature?.trim();
  let declaredPublisher = metadata?.publisher?.trim();

  if (!declaredSignature) {
    const embedded = await extractEmbeddedSignature(packageSource);
    if (embedded) {
      declaredSignature = embedded.signature?.trim();
      if (!declaredPublisher && embedded.publisher) {
        declaredPublisher = embedded.publisher.trim();
      }
    }
  }

  const isCommunity = sourceType === 'community' || sourceType === 'remote';

  // 5. Community policy enforcement
  if (isCommunity) {
    // 5.1 Must declare integrity
    if (!declaredIntegrity) {
      return {
        ok: false,
        code: 'COMMUNITY_INTEGRITY_REQUIRED',
        error: '社区插件包必须在元数据中声明 integrity (SHA-256)，未声明完整性的社区包被拒绝',
      };
    }

    // 5.2 Must have publisher signature
    if (!declaredSignature) {
      return {
        ok: false,
        code: 'COMMUNITY_ATTESTATION_REQUIRED',
        error: '社区包必须同时提供 integrity 与有效发布者 signature，拒绝未签名的社区包',
      };
    }

    // 5.3 Must have trusted public keys configured
    const trustedKeys = resolveTrustedPublicKeys(options.trustedPublicKeys, env);
    if (trustedKeys.length === 0) {
      return {
        ok: false,
        code: 'COMMUNITY_PUBKEY_MISSING',
        error: '宿主未配置信任公钥 (OPENLEARN_COMMUNITY_PUBKEY)，拒绝安装社区包',
      };
    }

    // 5.4 Check integrity hash
    if (!hashMatches(packageSource, declaredIntegrity)) {
      return {
        ok: false,
        code: 'COMMUNITY_INTEGRITY_MISMATCH',
        error: '社区包完整性哈希与下载内容不一致 (ZIP 可能在传输中损坏或被篡改)',
      };
    }

    // 5.5 Verify cryptographic signature
    const sigCheck = verifySignature(declaredIntegrity, declaredSignature, trustedKeys, {
      id: metadata?.id,
      version: metadata?.version,
    });

    if (!sigCheck.ok) {
      return {
        ok: false,
        code: 'COMMUNITY_SIGNATURE_INVALID',
        error: '社区包发布者签名校验失败：签名无效或非受信任发布者',
      };
    }

    return {
      ok: true,
      status: 'verified',
      publisher: declaredPublisher,
      integrity: declaredIntegrity,
      matchedKey: sigCheck.matchedKey,
    };
  }

  // 6. Local uploads policy
  if (declaredIntegrity && !hashMatches(packageSource, declaredIntegrity)) {
    return {
      ok: false,
      code: 'LOCAL_INTEGRITY_MISMATCH',
      error: '本地插件包完整性哈希校验失败，内容与声明不符',
    };
  }

  if (declaredSignature) {
    const trustedKeys = resolveTrustedPublicKeys(options.trustedPublicKeys, env);
    if (trustedKeys.length > 0) {
      const sigCheck = verifySignature(effectiveIntegrity, declaredSignature, trustedKeys, {
        id: metadata?.id,
        version: metadata?.version,
      });
      if (!sigCheck.ok) {
        return {
          ok: false,
          code: 'LOCAL_SIGNATURE_INVALID',
          error: '本地插件包携带了发布者签名，但签名校验失败',
        };
      }
      return {
        ok: true,
        status: 'verified',
        publisher: declaredPublisher,
        integrity: effectiveIntegrity,
        matchedKey: sigCheck.matchedKey,
      };
    }
  }

  if (!allowUnsignedLocal) {
    return {
      ok: false,
      code: 'COMMUNITY_ATTESTATION_REQUIRED',
      error: '平台策略禁止安装未签名的本地插件包',
    };
  }

  return {
    ok: true,
    status: 'unverified_local_acknowledged',
    publisher: declaredPublisher,
    integrity: effectiveIntegrity,
  };
}
