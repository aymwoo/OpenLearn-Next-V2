/**
 * 文件上传安全工具：Magic bytes 校验、类型限制
 */
import path from 'path';

const MAGIC_BYTES: Record<string, number[][]> = {
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.pptx': [[0x50, 0x4b, 0x03, 0x04]],
  '.zip': [[0x50, 0x4b, 0x03, 0x04]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.png': [[0x89, 0x50, 0x4e, 0x47]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]],
};

export const BLOCKED_EXTENSIONS = [
  '.exe', '.sh', '.bat', '.cmd', '.dll', '.so', '.dylib', '.scr', '.msi', '.ps1',
];

export function validateMagicBytes(buffer: Buffer, fileName: string): boolean {
  const ext = path.extname(fileName || '').toLowerCase();
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return true;
  return signatures.some(sig => sig.every((byte, i) => buffer[i] === byte));
}

export const SIZE_LIMITS: Record<string, number> = {
  courseware: 50 * 1024 * 1024,
  plugin: 10 * 1024 * 1024,
  assignment: 20 * 1024 * 1024,
  generic: 10 * 1024 * 1024,
};
