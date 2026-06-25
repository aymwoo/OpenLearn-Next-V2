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

  const keyHex = process.env.ENCRYPTION_KEY;
  if (keyHex && keyHex.trim() !== '') {
    _encryptionKey = Buffer.from(keyHex.trim(), 'hex');
    return _encryptionKey;
  }

  // 自动生成并持久化到 .env（首次启动或未配置时）
  const newKey = crypto.randomBytes(32).toString('hex');
  const envPath = path.resolve(process.cwd(), '.env');

  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      if (!content.includes('ENCRYPTION_KEY=')) {
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
  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted; // backward compat: plaintext
  const key = getEncryptionKey();
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
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
