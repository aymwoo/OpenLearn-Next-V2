/**
 * api-key-crypto — canonical AES-256-GCM encryption/decryption for AI Provider API keys.
 *
 * ## Why this module exists
 *
 * Historically the encryption/decryption logic was duplicated:
 *   - `server/utils/crypto.ts` (robust: falls back to reading `.env` when
 *     `process.env.ENCRYPTION_KEY` is missing/empty — e.g. PM2 setting it to `''`)
 *   - `packages/core/di/ai-service.ts` (fragile: only read `process.env` and
 *     silently returned the ciphertext when the key was absent)
 *
 * That divergence made the "AI Provider 测试" button succeed while plugin-facing
 * `ctx.services.ai.generateText()` sent the encrypted blob as the Bearer token,
 * producing `401 ... Please carry the API secret key`.
 *
 * This module is now the single source of truth; `server/utils/crypto.ts`
 * re-exports from here so the two paths can never drift again.
 *
 * ## Key resolution order (see getEncryptionKey)
 * 1. `process.env.ENCRYPTION_KEY` (non-empty)
 * 2. `.env` file in `process.cwd()` (handles PM2 overriding the var with `''`)
 * 3. Auto-generate + persist to `.env` — but NEVER overwrite an existing
 *    `ENCRYPTION_KEY=` line (even an empty one): rotating the key would make
 *    every previously encrypted provider key undecryptable.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let _encryptionKey: Buffer | null = null;

export function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;

  const envPath = path.resolve(process.cwd(), '.env');

  // 1. 优先从 process.env 读取（忽略空字符串）
  const keyHex = process.env.ENCRYPTION_KEY;
  if (keyHex && keyHex.trim() !== '') {
    _encryptionKey = Buffer.from(keyHex.trim(), 'hex');
    return _encryptionKey;
  }

  // 2. process.env 为空时，直接从 .env 文件读取
  //    （PM2 env 块可能用空字符串覆盖了 process.env.ENCRYPTION_KEY）
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/^ENCRYPTION_KEY=(.+)$/m);
      if (match && match[1].trim() !== '') {
        const fileKeyHex = match[1].trim();
        _encryptionKey = Buffer.from(fileKeyHex, 'hex');
        process.env.ENCRYPTION_KEY = fileKeyHex;
        console.log('[Crypto] ENCRYPTION_KEY loaded from .env file');
        return _encryptionKey;
      }
    } catch {
      // .env 读取失败，继续自动生成
    }
  }

  // 3. 自动生成并持久化到 .env（仅在 .env 中尚无 ENCRYPTION_KEY 行时）
  //
  // 安全约束：绝不原地覆盖 .env 中已有的 ENCRYPTION_KEY= 行（即便值为空）。
  // 覆盖现有密钥会导致已用旧密钥加密的 AI Provider Key 全部无法解密。
  const newKey = crypto.randomBytes(32).toString('hex');

  try {
    if (fs.existsSync(envPath)) {
      const existingContent = fs.readFileSync(envPath, 'utf-8');
      if (/^ENCRYPTION_KEY=/m.test(existingContent)) {
        // .env 中已存在 ENCRYPTION_KEY= 行（包括空值），绝不覆盖。
        console.warn(
          '[Crypto] ENCRYPTION_KEY missing/empty in .env; NOT overwriting existing entry. ' +
            'Generating ephemeral in-memory key — please set ENCRYPTION_KEY manually before relying on encrypted storage.',
        );
        process.env.ENCRYPTION_KEY = newKey;
        _encryptionKey = Buffer.from(newKey, 'hex');
        return _encryptionKey;
      }
      fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${newKey}\n`);
      console.log('[Crypto] ENCRYPTION_KEY auto-generated and persisted to .env');
    } else {
      fs.writeFileSync(envPath, `ENCRYPTION_KEY=${newKey}\n`);
      console.log('[Crypto] .env created with auto-generated ENCRYPTION_KEY');
    }
  } catch {
    console.warn('[Crypto] Could not persist ENCRYPTION_KEY, using in-memory fallback');
  }

  // 4. 同步到 process.env，保证进程内一致性
  process.env.ENCRYPTION_KEY = newKey;
  _encryptionKey = Buffer.from(newKey, 'hex');
  return _encryptionKey;
}

export function encryptApiKey(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** 判断字符串是否形如 `iv:authTag:ciphertext`（三段十六进制）。 */
export function looksLikeCiphertext(value: string): boolean {
  const parts = (value || '').split(':');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[0-9a-fA-F]+$/.test(p));
}

export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return '';
  // 明文（未加密或旧数据）：直接返回
  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch {
    // 解密失败（ENCRYPTION_KEY 变更或数据损坏），按明文处理
    console.warn('[Crypto] Failed to decrypt API key, treating as plaintext');
    return encrypted;
  }
}
