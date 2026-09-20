/**
 * 安全工具函数：API Key 加密/解密、密码验证、prompt 注入检测
 *
 * API Key 的 AES-256-GCM 加解密已收敛到 `packages/core/di/api-key-crypto.ts`，
 * 与内核 `AIService`（插件 ctx.services.ai）共用同一套密钥解析逻辑，
 * 避免出现「AI Provider 测试通过、插件调用 401」的解密分叉。
 * 这里仅做转发，保持既有导入路径不变。
 */
import {
  getEncryptionKey,
  encryptApiKey,
  decryptApiKey,
  looksLikeCiphertext,
} from '../../packages/core/di/api-key-crypto.js';

export { getEncryptionKey, encryptApiKey, decryptApiKey, looksLikeCiphertext };

// ── API Key 掩码 ────────────────────────────────────────────────────

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
  return PROMPT_INJECTION_PATTERNS.some((p) => p.test(input));
}
