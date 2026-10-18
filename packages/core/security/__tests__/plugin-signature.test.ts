import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import {
  computeSha256,
  hashMatches,
  buildAttestationPayload,
  signPayload,
  verifySignature,
  extractEmbeddedSignature,
  resolveTrustedPublicKeys,
  verifyPluginPackage,
} from '../plugin-signature.js';

describe('Plugin Publisher Signature & Integrity Subsystem (Issue #143)', () => {
  const keyPair1 = crypto.generateKeyPairSync('ed25519');
  const pubPem1 = keyPair1.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem1 = keyPair1.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const keyPair2 = crypto.generateKeyPairSync('ed25519');
  const pubPem2 = keyPair2.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privPem2 = keyPair2.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const fakeBytes = Buffer.from('openlearn-plugin-content-test');
  const sha = computeSha256(fakeBytes);

  describe('基础密码学与载荷构建', () => {
    it('正确计算 SHA-256 并比对 hex 与 sha256- 前缀', () => {
      expect(hashMatches(fakeBytes, sha.hex)).toBe(true);
      expect(hashMatches(fakeBytes, `sha256-${sha.base64}`)).toBe(true);
      expect(hashMatches(fakeBytes, 'sha256-wrongbase64')).toBe(false);
    });

    it('支持结构化绑定 v2 载荷签名与验签', () => {
      const meta = { id: 'ext-test', version: '1.0.0' };
      const payload = buildAttestationPayload(sha.hex, meta);
      const signature = signPayload(payload, privPem1);

      // 单公钥验签通过
      const res = verifySignature(sha.hex, signature, pubPem1, meta);
      expect(res.ok).toBe(true);

      // 多公钥 Keyring 能够正确匹配 pubPem1
      const resKeyring = verifySignature(sha.hex, signature, [pubPem2, pubPem1], meta);
      expect(resKeyring.ok).toBe(true);
      expect(resKeyring.matchedKey).toBe(pubPem1);

      // 错误公钥验签失败
      const resFail = verifySignature(sha.hex, signature, pubPem2, meta);
      expect(resFail.ok).toBe(false);

      // ID 冒名被拒绝
      const resImpersonate = verifySignature(sha.hex, signature, pubPem1, {
        id: 'ext-attacker',
        version: '1.0.0',
      });
      expect(resImpersonate.ok).toBe(false);

      // 版本篡改被拒绝
      const resTamperVersion = verifySignature(sha.hex, signature, pubPem1, {
        id: 'ext-test',
        version: '2.0.0',
      });
      expect(resTamperVersion.ok).toBe(false);
    });

    it('兼容向后裸哈希签名载荷', () => {
      const signature = signPayload(sha.hex, privPem1);
      // 未传 version 时允许回退匹配裸哈希
      const res = verifySignature(sha.hex, signature, pubPem1);
      expect(res.ok).toBe(true);
    });
  });

  describe('嵌入式 signature.json 解析', () => {
    it('能够从 ZIP 包中自动提取 signature.json', async () => {
      const zip = new JSZip();
      zip.file('index.js', 'console.log("hello");');
      zip.file(
        'signature.json',
        JSON.stringify({
          version: 2,
          algorithm: 'ed25519',
          signature: 'dummy-base64-sig',
          publisher: 'official-team',
        }),
      );
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

      const sigInfo = await extractEmbeddedSignature(zipBuf);
      expect(sigInfo).toBeDefined();
      expect(sigInfo?.signature).toBe('dummy-base64-sig');
      expect(sigInfo?.publisher).toBe('official-team');
    });

    it('无 signature.json 时返回 null', async () => {
      const zip = new JSZip();
      zip.file('index.js', 'console.log("hello");');
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
      const sigInfo = await extractEmbeddedSignature(zipBuf);
      expect(sigInfo).toBeNull();
    });
  });

  describe('verifyPluginPackage 综合策略分级门禁', () => {
    it('内置插件 (builtin) 直接完全信任放行', async () => {
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'builtin',
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('trusted_builtin');
      }
    });

    it('社区包未声明 integrity 被明确拒绝 (COMMUNITY_INTEGRITY_REQUIRED)', async () => {
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'community',
        metadata: { id: 'ext-comm', version: '1.0.0' }, // 缺少 integrity
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('COMMUNITY_INTEGRITY_REQUIRED');
      }
    });

    it('社区包未包含有效签名被明确拒绝 (COMMUNITY_ATTESTATION_REQUIRED)', async () => {
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'community',
        metadata: {
          id: 'ext-comm',
          version: '1.0.0',
          integrity: sha.hex, // 有 integrity 但缺少 signature
        },
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('COMMUNITY_ATTESTATION_REQUIRED');
      }
    });

    it('社区包未配置宿主公钥时被明确拒绝 (COMMUNITY_PUBKEY_MISSING)', async () => {
      const sig = signPayload(sha.hex, privPem1);
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'community',
        metadata: {
          id: 'ext-comm',
          version: '1.0.0',
          integrity: sha.hex,
          signature: sig,
        },
        trustedPublicKeys: [],
        env: {}, // 未配 OPENLEARN_COMMUNITY_PUBKEY
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('COMMUNITY_PUBKEY_MISSING');
      }
    });

    it('社区包哈希不符时被拒绝 (COMMUNITY_INTEGRITY_MISMATCH)', async () => {
      const sig = signPayload(sha.hex, privPem1);
      const tamperedBytes = Buffer.from('tampered-content');
      const res = await verifyPluginPackage({
        packageSource: tamperedBytes,
        sourceType: 'community',
        metadata: {
          id: 'ext-comm',
          version: '1.0.0',
          integrity: sha.hex,
          signature: sig,
        },
        trustedPublicKeys: [pubPem1],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('COMMUNITY_INTEGRITY_MISMATCH');
      }
    });

    it('社区包签名无效或不受信任时被拒绝 (COMMUNITY_SIGNATURE_INVALID)', async () => {
      const wrongSig = signPayload(sha.hex, privPem2); // 用未信任的 key2 签名
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'community',
        metadata: {
          id: 'ext-comm',
          version: '1.0.0',
          integrity: sha.hex,
          signature: wrongSig,
        },
        trustedPublicKeys: [pubPem1], // 宿主只信任 key1
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('COMMUNITY_SIGNATURE_INVALID');
      }
    });

    it('社区包通过元数据签名验证成功 (verified)', async () => {
      const meta = { id: 'ext-comm', version: '1.0.0', publisher: 'official-hub' };
      const payload = buildAttestationPayload(sha.hex, meta);
      const sig = signPayload(payload, privPem1);

      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'community',
        metadata: {
          ...meta,
          integrity: sha.hex,
          signature: sig,
        },
        trustedPublicKeys: [pubPem1],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('verified');
        expect(res.publisher).toBe('official-hub');
      }
    });

    it('社区包通过 ZIP 包内置 signature.json 验证成功 (verified)', async () => {
      // 1. 构建初始 zip
      const zip = new JSZip();
      zip.file('index.js', 'console.log("secure plugin");');
      zip.file('manifest.json', JSON.stringify({ id: 'ext-embedded', version: '2.1.0' }));
      const unsignedZip = await zip.generateAsync({ type: 'nodebuffer' });
      const zipSha = computeSha256(unsignedZip);

      // 2. 签署该 zip 内容并嵌入 signature.json
      const meta = { id: 'ext-embedded', version: '2.1.0' };
      const payload = buildAttestationPayload(zipSha.hex, meta);
      const sig = signPayload(payload, privPem1);

      zip.file(
        'signature.json',
        JSON.stringify({
          version: 2,
          algorithm: 'ed25519',
          signature: sig,
          publisher: 'verified-developer',
        }),
      );
      const signedZip = await zip.generateAsync({ type: 'nodebuffer' });
      const signedZipSha = computeSha256(signedZip);

      // 对 signedZip 进行全包签名并测试
      const signedPayload = buildAttestationPayload(signedZipSha.hex, meta);
      const outerSig = signPayload(signedPayload, privPem1);

      // 重新写入包含自身正确哈希签名的包
      zip.file(
        'signature.json',
        JSON.stringify({
          version: 2,
          algorithm: 'ed25519',
          signature: outerSig,
          publisher: 'verified-developer',
        }),
      );

      const res = await verifyPluginPackage({
        packageSource: signedZip,
        sourceType: 'community',
        metadata: {
          id: 'ext-embedded',
          version: '2.1.0',
          integrity: signedZipSha.hex,
          signature: outerSig,
        },
        trustedPublicKeys: [pubPem1],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('verified');
      }
    });

    it('本地上传包无签名时默认放行 (unverified_local_acknowledged)', async () => {
      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'local',
        allowUnsignedLocal: true,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('unverified_local_acknowledged');
      }
    });

    it('本地上传包若携带签名且有效时标记为 verified', async () => {
      const meta = { id: 'ext-local', version: '1.0.0' };
      const payload = buildAttestationPayload(sha.hex, meta);
      const sig = signPayload(payload, privPem1);

      const res = await verifyPluginPackage({
        packageSource: fakeBytes,
        sourceType: 'local',
        metadata: {
          ...meta,
          integrity: sha.hex,
          signature: sig,
          publisher: 'trusted-local-dev',
        },
        trustedPublicKeys: [pubPem1],
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.status).toBe('verified');
        expect(res.publisher).toBe('trusted-local-dev');
      }
    });
  });
});
