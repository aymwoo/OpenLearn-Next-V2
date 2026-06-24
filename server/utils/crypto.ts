/**
 * 安全工具函数：API Key 加密/解密、密码验证、prompt 注入检测
 */
import crypto from 'crypto';

// ── API Key 加密 (AES-256-GCM) ─────────────────────────────────────

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.trim() === '') {
    throw new Error('ENCRYPTION_KEY environment variable is required.');
  }
  return Buffer.from(keyHex.trim(), 'hex');
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
