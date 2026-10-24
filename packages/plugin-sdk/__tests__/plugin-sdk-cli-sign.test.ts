import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { verifyPluginPackage } from '../../core/security/plugin-signature.js';

describe('@openlearn/plugin-sdk CLI 签名能力 (Issue #143)', () => {
  const cliPath = path.resolve(__dirname, '../cli.mjs');

  it('支持使用 sign 命令对已有 ZIP 签署 Ed25519 签名并嵌入 signature.json', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sdk-sign-'));
    try {
      // 1. 生成 Ed25519 密钥对
      const keyPair = crypto.generateKeyPairSync('ed25519');
      const privPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const pubPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const privKeyFile = path.join(tmpDir, 'publisher.pem');
      fs.writeFileSync(privKeyFile, privPem, 'utf8');

      // 2. 创建一个测试 ZIP
      const zip = new JSZip();
      zip.file('index.js', 'export default {};');
      zip.file(
        'manifest.json',
        JSON.stringify({
          id: 'ext-signed-test',
          name: 'ext-signed-test',
          version: '1.0.0',
          author: 'Alice',
        }),
      );
      const zipPath = path.join(tmpDir, 'ext-signed-test.zip');
      const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
      fs.writeFileSync(zipPath, zipBuf);

      // 3. 执行 CLI sign 命令
      const output = execSync(`node ${cliPath} sign --key ${privKeyFile} --publisher "Alice Dev" ${zipPath}`, {
        encoding: 'utf8',
      });
      expect(output).toContain('Successfully signed ext-signed-test.zip');
      expect(output).toContain('Publisher: Alice Dev');

      // 4. 验证 ZIP 中已生成 signature.json
      const signedZipBuf = fs.readFileSync(zipPath);
      const loadedZip = await JSZip.loadAsync(signedZipBuf);
      const sigFile = loadedZip.file('signature.json');
      expect(sigFile).toBeDefined();

      const sigJson = JSON.parse(await sigFile!.async('string'));
      expect(sigJson.version).toBe(2);
      expect(sigJson.algorithm).toBe('ed25519');
      expect(sigJson.publisher).toBe('Alice Dev');
      expect(sigJson.signature).toBeTruthy();

      // 5. 使用核心 verifyPluginPackage 验证该产物
      // 提取外层 integrity 打印
      const intMatch = output.match(/Integrity:\s*([a-f0-9]+)/i);
      const sigMatch = output.match(/Signature:\s*([A-Za-z0-9+/=]+)/i);
      expect(intMatch).toBeTruthy();
      expect(sigMatch).toBeTruthy();

      const verifyRes = await verifyPluginPackage({
        packageSource: zipPath,
        sourceType: 'community',
        metadata: {
          id: 'ext-signed-test',
          version: '1.0.0',
          integrity: intMatch![1],
          signature: sigMatch![1],
        },
        trustedPublicKeys: [pubPem],
      });
      expect(verifyRes.ok).toBe(true);
      if (verifyRes.ok) {
        expect(verifyRes.status).toBe('verified');
      }

      // 6. 测试纯嵌入式签名场景（无外部 metadata 传入）实现真实 round-trip 闭环 (B1)
      const embeddedVerifyRes = await verifyPluginPackage({
        packageSource: zipPath,
        sourceType: 'community',
        trustedPublicKeys: [pubPem],
      });
      expect(embeddedVerifyRes.ok).toBe(true);
      if (embeddedVerifyRes.ok) {
        expect(embeddedVerifyRes.status).toBe('verified');
        expect(embeddedVerifyRes.publisher).toBe('Alice Dev');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
