/**
 * 错误上报与审计字段的递归脱敏。
 *
 * 与 pino redact 互补：pino 按路径替换日志对象；这里处理即将离开进程的
 * 错误载荷（Sentry 兼容上报、审计附加字段、异常 message/stack）。
 * 只按字段名和少数凭据形态替换，不尝试理解自由文本里的学生作文。
 */

export const REDACTED = '***REDACTED***';

const SENSITIVE_KEYS = new Set(
  [
    'password',
    'newpassword',
    'oldpassword',
    'currentpassword',
    'confirmpassword',
    'passwordhash',
    'password_hash',
    'passcode',
    'class_passcode',
    'classpasscode',
    'cookie',
    'set-cookie',
    'authorization',
    'apikey',
    'api_key',
    'secret',
    'sessiontoken',
    'session_data',
    'edu_os_token',
    'token',
    'textcontent',
    'text_content',
    'studentanswer',
    'student_answer',
    'answer',
    'answers',
    'correctanswer',
    'correct_answer',
    'content',
    'requestpayload',
    'responsepayload',
    'headers',
    'body',
    'req',
    'request',
    'socket',
  ].map((name) => name.toLowerCase()),
);

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/olenc1:[0-9a-fA-F:]+/g, '***REDACTED***'],
  [/token_[a-f0-9]{8,}/gi, 'token_***REDACTED***'],
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***REDACTED***'],
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/g, '***REDACTED***'],
  [
    /(password|passcode|api[_-]?key|authorization|cookie|session|text[_-]?content|student[_-]?answer|correct[_-]?answer|answers?)\s*[:=]\s*([^\s&,"']+)/gi,
    '$1=***REDACTED***',
  ],
];

const MAX_DEPTH = 8;
const MAX_ARRAY = 20;
const MAX_STRING = 4000;

export function scrubString(value: string): string {
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return scrubString(String(value));
}
