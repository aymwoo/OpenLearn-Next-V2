import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  communityInstallEnabled,
  communityPublicKeyPem,
  getStoredCommunityInstallEnabled,
  hashMatches,
  resolveCommunityInstallConfig,
  setStoredCommunityInstallEnabled,
  signatureMatches,
  verifyCommunityPackage,
  type CommunityInstallDbLike,
} from '../services/community-attest.js';

describe('community-attest 密码学完整性与签名校验', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const testBytes = Buffer.from('fake-zip-binary-payload-data');
  const testHashHex = crypto.createHash('sha256').update(testBytes).digest('hex');
  const testSig = crypto.sign(null, Buffer.from(testHashHex, 'utf8'), privateKey).toString('base64');

  it('开关读取正常（默认开启，仅 0/false 关闭）', () => {
    expect(communityInstallEnabled({})).toBe(true);
    expect(communityInstallEnabled({ OPENLEARN_COMMUNITY_INSTALL: '1' })).toBe(true);
    expect(communityInstallEnabled({ OPENLEARN_COMMUNITY_INSTALL: '0' })).toBe(false);
    expect(communityInstallEnabled({ OPENLEARN_COMMUNITY_INSTALL: 'false' })).toBe(false);
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

  it('未配置公钥或缺少签名/integrity 时直接放行', () => {
    const noPubkey = verifyCommunityPackage(testBytes, testHashHex, testSig, {
      OPENLEARN_COMMUNITY_INSTALL: '1',
    });
    expect(noPubkey.ok).toBe(true);

    const noSig = verifyCommunityPackage(testBytes, testHashHex, '', {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(noSig.ok).toBe(true);

    const noIntegrityOrSig = verifyCommunityPackage(testBytes, undefined, undefined, {});
    expect(noIntegrityOrSig.ok).toBe(true);
  });

  it('提供 integrity 且内容篡改时拒绝，其余情况视为官方安全包通过', () => {
    const tamperedBytes = Buffer.from('tampered-payload');
    const badHash = verifyCommunityPackage(tamperedBytes, testHashHex, testSig, {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(badHash.ok).toBe(false);
    expect((badHash as any).code).toBe('COMMUNITY_INTEGRITY_MISMATCH');

    const skipSig = verifyCommunityPackage(testBytes, testHashHex, 'invalid-signature-base64', {
      OPENLEARN_COMMUNITY_INSTALL: '1',
      OPENLEARN_COMMUNITY_PUBKEY: pubPem,
    });
    expect(skipSig.ok).toBe(true);
  });

  it('B4: 支持多受信公钥 Keyring，signatureMatches 辅助函数仍可正常验签', () => {
    const keyPair2 = crypto.generateKeyPairSync('ed25519');
    const pubPem2 = keyPair2.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const manifestId = 'ext-keyring-test';
    const version = '2.0.0';
    const boundPayload = `openlearn-plugin-attestation-v2\n${manifestId}\n${version}\n${testHashHex}`;
    const sigWithKey2 = crypto.sign(null, Buffer.from(boundPayload, 'utf8'), keyPair2.privateKey).toString('base64');

    expect(signatureMatches(testHashHex, sigWithKey2, [pubPem, pubPem2], { id: manifestId, version })).toBe(true);
  });
});

describe('resolveCommunityInstallConfig 优先级与持久化', () => {
  function memoryDb(initial: number | boolean | null | 'missing' = null): CommunityInstallDbLike {
    let stored: number | boolean | null | 'missing' = initial;
    return {
      prepare(sql: string) {
        return {
          get() {
            if (stored === 'missing') {
              throw new Error('no such column: community_install_enabled');
            }
            return { community_install_enabled: stored };
          },
          run(...params: unknown[]) {
            if (!sql.includes('?')) {
              stored = null;
              return;
            }
            stored = params[0] as number;
          },
        };
      },
    };
  }

  it('未配置且无环境变量时默认开启', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(communityInstallEnabled(env)).toBe(true);
    const resolved = resolveCommunityInstallConfig(memoryDb(null), env);
    expect(resolved).toMatchObject({
      enabled: true,
      storedValue: null,
      envEnabled: true,
      configSource: 'default',
      hasEnvFallback: false,
    });
  });

  it('数据库尚未显式设置时回退 OPENLEARN_COMMUNITY_INSTALL=1 或 0', () => {
    const env = { OPENLEARN_COMMUNITY_INSTALL: '1' } as NodeJS.ProcessEnv;
    const resolved = resolveCommunityInstallConfig(memoryDb(null), env);
    expect(resolved).toMatchObject({
      enabled: true,
      storedValue: null,
      envEnabled: true,
      configSource: 'env',
      hasEnvFallback: true,
    });
    const envOff = { OPENLEARN_COMMUNITY_INSTALL: '0' } as NodeJS.ProcessEnv;
    expect(resolveCommunityInstallConfig(memoryDb(null), envOff)).toMatchObject({
      enabled: false,
      storedValue: null,
      envEnabled: false,
      configSource: 'env',
      hasEnvFallback: true,
    });
  });

  it('缺少列时按未配置处理并回退环境变量或默认开启', () => {
    const env = { OPENLEARN_COMMUNITY_INSTALL: '0' } as NodeJS.ProcessEnv;
    expect(getStoredCommunityInstallEnabled(memoryDb('missing'))).toBeNull();
    expect(resolveCommunityInstallConfig(memoryDb('missing'), env).enabled).toBe(false);
    expect(resolveCommunityInstallConfig(memoryDb('missing'), {}).enabled).toBe(true);
  });

  it('环境变量仅 0/false 会关闭，其余值保持开启', () => {
    for (const value of ['0', 'false']) {
      const env = { OPENLEARN_COMMUNITY_INSTALL: value } as NodeJS.ProcessEnv;
      expect(communityInstallEnabled(env)).toBe(false);
      expect(resolveCommunityInstallConfig(memoryDb(null), env).enabled).toBe(false);
    }
    for (const value of ['', '1', 'true', 'yes']) {
      const env = { OPENLEARN_COMMUNITY_INSTALL: value } as NodeJS.ProcessEnv;
      expect(communityInstallEnabled(env)).toBe(true);
      expect(resolveCommunityInstallConfig(memoryDb(null), env).enabled).toBe(true);
    }
  });

  it('界面显式关闭覆盖环境变量 1，清除后恢复环境回退', () => {
    const env = { OPENLEARN_COMMUNITY_INSTALL: '1' } as NodeJS.ProcessEnv;
    const db = memoryDb(null);
    const closed = setStoredCommunityInstallEnabled(db, false, env);
    expect(closed).toMatchObject({
      enabled: false,
      storedValue: false,
      configSource: 'database',
      hasEnvFallback: true,
    });
    // 再次读取模拟进程重载后仍读持久化值
    expect(resolveCommunityInstallConfig(db, env).enabled).toBe(false);
    const cleared = setStoredCommunityInstallEnabled(db, null, env);
    expect(cleared).toMatchObject({
      enabled: true,
      storedValue: null,
      configSource: 'env',
    });
  });

  it('界面显式开启无需环境变量，保存后再次读取仍开启', () => {
    const env = {} as NodeJS.ProcessEnv;
    const db = memoryDb(null);
    const opened = setStoredCommunityInstallEnabled(db, true, env);
    expect(opened).toMatchObject({
      enabled: true,
      storedValue: true,
      configSource: 'database',
      hasEnvFallback: false,
    });
    expect(resolveCommunityInstallConfig(db, env).enabled).toBe(true);
  });

  it('publicKeysConfigured 只反映是否已配置公钥，不暴露密钥', () => {
    const withoutKeys = resolveCommunityInstallConfig(memoryDb(null), {} as NodeJS.ProcessEnv);
    expect(withoutKeys.publicKeysConfigured).toBe(false);
    expect(JSON.stringify(withoutKeys)).not.toMatch(/BEGIN PUBLIC KEY/);
    const withKeys = resolveCommunityInstallConfig(memoryDb(null), {
      OPENLEARN_COMMUNITY_PUBKEY: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----',
    } as NodeJS.ProcessEnv);
    expect(withKeys.publicKeysConfigured).toBe(true);
    expect(JSON.stringify(withKeys)).not.toMatch(/BEGIN PUBLIC KEY/);
  });
});
