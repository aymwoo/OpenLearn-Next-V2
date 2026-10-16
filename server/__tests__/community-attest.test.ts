import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  communityInstallEnabled,
  communityPublicKeyPem,
  hashMatches,
  signatureMatches,
  verifyCommunityPackage,
} from '../services/community-attest.js';

describe('community-attest 密码学完整性与签名校验', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const testBytes = Buffer.from('fake-zip-binary-payload-data');
  const testHashHex = crypto.createHash('sha256').update(testBytes).digest('hex');
  const testSig = crypto.sign(null, Buffer.from(testHashHex, 'utf8'), privateKey).toString('base64');

  it('开关读取正常', () => {
    expect(communityInstallEnabled({})).toBe(false);
    expect(communityInstallEnabled({ OPENLEARN_COMMUNITY_INSTALL: '1' })).toBe(true);
  });

  it('正确比对 hash 与 Ed25519 签名', () => {
    expect(hashMatches(testBytes, testHashHex)).toBe(true);
    expect(signatureMatches(testHashHex, testSig, pubPem)).toBe(true);

    const result = verifyCommunityPackage(testBytes, testHashHex, testSig, {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(result.ok).toBe(true);
  });

  it('支持大包文件路径流式分块校验', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-test-'));
    const tmpFile = path.join(tmpDir, 'test.zip');
    fs.writeFileSync(tmpFile, testBytes);

    try {
      expect(hashMatches(tmpFile, testHashHex)).toBe(true);
      const result = verifyCommunityPackage(tmpFile, testHashHex, testSig, {
        OPENLEARN_COMMUNITY_INSTALL: '1',
        OPENLEARN_COMMUNITY_PUBKEY: pubPem,
      });
      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('支持元数据绑定（ID 与版本）的结构化签名校验', () => {
    const manifestId = 'ext-secure-plugin';
    const version = '1.2.3';
    const boundPayload = `openlearn-plugin-attestation-v2\n${manifestId}\n${version}\n${testHashHex}`;
    const boundSig = crypto.sign(null, Buffer.from(boundPayload, 'utf8'), privateKey).toString('base64');

    expect(signatureMatches(testHashHex, boundSig, pubPem, { id: manifestId, version })).toBe(true);

    // 尝试冒名使用其他 ID 验证：应被拒绝
    expect(signatureMatches(testHashHex, boundSig, pubPem, { id: 'ext-attacker-plugin', version })).toBe(false);

    // 当明确提供 { id, version } 元数据时，禁止使用未绑定元数据的裸哈希签名降级绕过
    expect(signatureMatches(testHashHex, testSig, pubPem, { id: manifestId, version })).toBe(false);

    // 完整性校验流程集成
    const result = verifyCommunityPackage(
      testBytes,
      testHashHex,
      boundSig,
      {
        OPENLEARN_COMMUNITY_INSTALL: '1',
        OPENLEARN_COMMUNITY_PUBKEY: pubPem,
      },
      { id: manifestId, version },
    );
    expect(result.ok).toBe(true);
  });

  it('缺少签名或公钥配置时明确报错', () => {
    const noPubkey = verifyCommunityPackage(testBytes, testHashHex, testSig, {
      OPENLEARN_COMMUNITY_INSTALL: '1',
    });
    expect(noPubkey.ok).toBe(false);
    expect((noPubkey as any).code).toBe('COMMUNITY_PUBKEY_MISSING');

    const noSig = verifyCommunityPackage(testBytes, testHashHex, '', {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(noSig.ok).toBe(false);
    expect((noSig as any).code).toBe('COMMUNITY_ATTESTATION_REQUIRED');
  });

  it('内容篡改或伪造签名时拒绝', () => {
    const tamperedBytes = Buffer.from('tampered-payload');
    const badHash = verifyCommunityPackage(tamperedBytes, testHashHex, testSig, {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(badHash.ok).toBe(false);
    expect((badHash as any).code).toBe('COMMUNITY_INTEGRITY_MISMATCH');

    const badSig = verifyCommunityPackage(testBytes, testHashHex, 'invalid-signature-base64', {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(badSig.ok).toBe(false);
    expect((badSig as any).code).toBe('COMMUNITY_SIGNATURE_INVALID');
  });
});
