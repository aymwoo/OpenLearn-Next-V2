/**
 * 安全工具函数：API Key 加密/解密、密码验证、prompt 注入检测
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ── API Key 加密 (AES-256-GCM) ─────────────────────────────────────

let _encryptionKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey;

  const envPath = path.resolve(process.cwd(), '.env');

  // 1. 优先从 process.env 读取
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

  // 3. 自动生成并持久化到 .env（首次启动或密钥缺失/为空时）
  const newKey = crypto.randomBytes(32).toString('hex');

  try {
    if (fs.existsSync(envPath)) {
      let content = fs.readFileSync(envPath, 'utf-8');
      if (/^ENCRYPTION_KEY=/m.test(content)) {
        // .env 中已有 ENCRYPTION_KEY= 行（值为空或不合法），原地替换
        content = content.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${newKey}`);
        fs.writeFileSync(envPath, content);
        console.log('[Crypto] ENCRYPTION_KEY replaced in .env (was empty or invalid)');
      } else {
        fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${newKey}\n`);
        console.log('[Crypto] ENCRYPTION_KEY auto-generated and persisted to .env');
      }
    } else {
      fs.writeFileSync(envPath, `ENCRYPTION_KEY=${newKey}\n`);
      console.log('[Crypto] .env created with auto-generated ENCRYPTION_KEY');
    }
  } catch (e) {
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

export function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key ? '****' : '';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

// ── Prompt 注入检测 ───────────────────────────────────────────────

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|directives?)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|another)/i,
  /forget\s+(all\s+)?(your|the)\s+(training|instructions?|rules?)/i,
  /system\s*(prompt|message|instruction):\s*/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
];

export function detectPromptInjection(input: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some(p => p.test(input));
}
