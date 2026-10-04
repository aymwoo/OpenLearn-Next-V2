import { describe, it, expect } from 'vitest';
import { validateMagicBytes, BLOCKED_EXTENSIONS } from '../utils/upload.js';
import {
  validateMagicBytes as sharedValidateMagicBytes,
  BLOCKED_EXTENSIONS as sharedBlockedExtensions,
} from '../routes/shared.js';

describe('Upload Security & Magic Bytes Validation (E4b SSOT)', () => {
  it('server/routes/shared.ts 导出的函数与常量必须与 server/utils/upload.ts 严格同一源', () => {
    expect(sharedValidateMagicBytes).toBe(validateMagicBytes);
    expect(sharedBlockedExtensions).toBe(BLOCKED_EXTENSIONS);
  });

  it('正确识别合法 PDF 文件头 (%PDF)', () => {
    const validPdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    expect(validateMagicBytes(validPdf, 'lesson.pdf')).toBe(true);

    const invalidPdf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(validateMagicBytes(invalidPdf, 'fake.pdf')).toBe(false);
  });

  it('正确识别合法 PNG 文件头 (.PNG)', () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateMagicBytes(validPng, 'avatar.png')).toBe(true);

    const spoofedPng = Buffer.from('NOT_A_PNG_FILE');
    expect(validateMagicBytes(spoofedPng, 'spoofed.png')).toBe(false);
  });

  it('正确识别合法 ZIP/PPTX 文件头 (PK..)', () => {
    const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(validateMagicBytes(validZip, 'courseware.zip')).toBe(true);
    expect(validateMagicBytes(validZip, 'presentation.pptx')).toBe(true);
  });

  it('正确识别合法 JPEG 文件头', () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(validateMagicBytes(validJpeg, 'photo.jpg')).toBe(true);
    expect(validateMagicBytes(validJpeg, 'photo.jpeg')).toBe(true);
  });

  it('拦截所有危险黑名单扩展名', () => {
    const dangerousExts = ['.exe', '.sh', '.bat', '.cmd', '.dll', '.so', '.dylib', '.ps1'];
    for (const ext of dangerousExts) {
      expect(BLOCKED_EXTENSIONS).toContain(ext);
    }
  });
});
