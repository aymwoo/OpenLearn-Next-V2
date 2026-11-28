import { describe, it, expect } from 'vitest';
import {
  detectProtocolFromManifestFiles,
  detectScormVersion,
  normalizeCoursewareProtocol,
  needsProtocolAdapter,
  toSubmissionProtocolSource,
} from '../protocol.js';

describe('courseware protocol detection', () => {
  it('SCORM 1.2：imsmanifest.xml 无 2004 标记', () => {
    const result = detectProtocolFromManifestFiles([
      { path: 'imsmanifest.xml', content: '<manifest><schema>ADL SCORM</schema></manifest>' },
      { path: 'index.html' },
    ]);
    expect(result.protocol).toBe('scorm-12');
    expect(result.evidence).toEqual(['imsmanifest.xml']);
  });

  it('SCORM 2004：schemaversion 2004 标记', () => {
    expect(detectScormVersion('<schemaversion>2004 4th Edition</schemaversion>')).toBe('scorm-2004');
    expect(
      detectProtocolFromManifestFiles([
        { path: 'imsmanifest.xml', content: '<schemaversion>2004 4th Edition</schemaversion>' },
      ]).protocol,
    ).toBe('scorm-2004');
  });

  it('SCORM 2004：adlcp_v1p3 / imsss 命名空间', () => {
    expect(detectScormVersion('xmlns="http://www.adlnet.org/xsd/adlcp_v1p3"')).toBe('scorm-2004');
    expect(detectScormVersion('xmlns:imsss="http://www.imsglobal.org/xsd/imsss"')).toBe('scorm-2004');
  });

  it('xAPI：tincan.xml 或 activity.json', () => {
    expect(detectProtocolFromManifestFiles([{ path: 'tincan.xml' }]).protocol).toBe('xapi');
    expect(detectProtocolFromManifestFiles([{ path: 'activity.json' }]).protocol).toBe('xapi');
  });

  it('H5P 优先于 xAPI / SCORM 清单', () => {
    const result = detectProtocolFromManifestFiles([
      { path: 'h5p.json' },
      { path: 'tincan.xml' },
      { path: 'imsmanifest.xml', content: '<schemaversion>2004</schemaversion>' },
    ]);
    expect(result.protocol).toBe('h5p');
  });

  it('仅识别浅层清单，深层第三方目录里的同名文件不误判', () => {
    const result = detectProtocolFromManifestFiles([
      { path: 'a/b/c/imsmanifest.xml', content: '<schemaversion>2004</schemaversion>' },
    ]);
    expect(result.protocol).toBe('html');
  });

  it('无清单一律 html', () => {
    expect(detectProtocolFromManifestFiles([{ path: 'index.html' }]).protocol).toBe('html');
  });

  it('协议别名收敛', () => {
    expect(normalizeCoursewareProtocol('SCORM1.2')).toBe('scorm-12');
    expect(normalizeCoursewareProtocol('scorm_2004')).toBe('scorm-2004');
    expect(normalizeCoursewareProtocol('tin-can')).toBe('xapi');
    expect(normalizeCoursewareProtocol('H5P')).toBe('h5p');
    expect(normalizeCoursewareProtocol('weird')).toBe('html');
  });

  it('仅外部协议需要注入适配器', () => {
    expect(needsProtocolAdapter('html')).toBe(false);
    for (const protocol of ['scorm-12', 'scorm-2004', 'xapi', 'h5p'] as const) {
      expect(needsProtocolAdapter(protocol)).toBe(true);
    }
  });

  it('成绩来源优先采用上报方合法自报值', () => {
    expect(toSubmissionProtocolSource('scorm-12', 'official-lms')).toBe('official-lms');
    expect(toSubmissionProtocolSource('html', 'watch')).toBe('watch');
    expect(toSubmissionProtocolSource('scorm-2004')).toBe('scorm-2004');
    expect(toSubmissionProtocolSource('html', 'not-a-protocol')).toBe('official-lms');
  });
});
