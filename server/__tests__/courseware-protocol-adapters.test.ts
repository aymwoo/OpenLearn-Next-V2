import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  detectProtocolInDirectory,
  readProtocolSidecar,
  resolveProtocolForStorageDir,
  writeProtocolSidecar,
} from '../../packages/courseware-adapters/node.js';
import { injectLmsSdk } from '../routes/shared.js';
import { mintCoursewareToken, verifyCoursewareToken, verifyCoursewareTokenClaims } from '../utils/courseware-access.js';

/**
 * Issue IKYP8P 阶段 A / C / F 的服务端落点：
 * - 上传/渲染按清单识别协议；
 * - SCORM 适配器随课件 HTML 注入，并接管 DOM 猜测式自动提交；
 * - 启动 token 绑定 coursewareId + attemptId + userId + lessonId。
 */
describe('courseware protocol adapters (Issue IKYP8P)', () => {
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ol-cw-proto-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('从磁盘清单识别 SCORM 2004，并写入旁车', () => {
    fs.writeFileSync(
      path.join(tempDir, 'imsmanifest.xml'),
      '<manifest><schemaversion>2004 4th Edition</schemaversion></manifest>',
      'utf8',
    );
    const detection = detectProtocolInDirectory(tempDir);
    expect(detection.protocol).toBe('scorm-2004');
    expect(detection.evidence).toContain('imsmanifest.xml');

    writeProtocolSidecar(tempDir, detection.protocol, detection.evidence);
    expect(readProtocolSidecar(tempDir)).toBe('scorm-2004');
    expect(resolveProtocolForStorageDir(tempDir)).toBe('scorm-2004');
  });

  it('旁车优先于现场扫描（支持教师在 UI 纠正误判）', () => {
    fs.writeFileSync(path.join(tempDir, 'imsmanifest.xml'), '<manifest></manifest>', 'utf8');
    writeProtocolSidecar(tempDir, 'scorm-2004');
    expect(resolveProtocolForStorageDir(tempDir)).toBe('scorm-2004');
  });

  it('SCORM 1.2 课件注入 window.API 适配器并关闭 DOM 自动提交', () => {
    const html = injectLmsSdk(
      '<html><head></head><body><div id="score">88</div></body></html>',
      { headers: {} },
      { id: 'cw-test', name: 'SCORM 课件', uuid: 'cw-uuid-test' },
      {
        protocol: 'scorm-12',
        launch: {
          attemptId: 'att-bound-1',
          userId: 'stu-1',
          learnerId: 'stu-1',
          learnerName: '测试学生',
          role: 'student',
        },
        launchToken: 'ct-test',
      },
    );

    expect(html).toContain('window.API = api');
    expect(html).toContain('LMSInitialize');
    expect(html).toContain('window.__LMS_ADAPTER_MANAGED__ = true');
    expect(html).toContain('protocol: "scorm-12"');
    // token 绑定的 attempt 直接注入，不再创建 guest 共享 attempt
    expect(html).toContain('"attempt_id":"att-bound-1"');
    expect(html).not.toContain('att_guest_');
    // 桥接 SDK 仍在适配器之前，保证 window.LMS 已就绪
    expect(html.indexOf('window.LMS =')).toBeLessThan(html.indexOf('window.API = api'));
  });

  it('普通 HTML 不注入适配器，保留 DOM 自动提交能力', () => {
    const html = injectLmsSdk(
      '<html><head></head><body></body></html>',
      { headers: {} },
      { id: 'cw-html', name: '普通课件', uuid: 'cw-uuid-html' },
      {
        protocol: 'html',
        launch: { attemptId: 'att-html-1', userId: 'stu-1', learnerId: 'stu-1', role: 'student' },
      },
    );
    expect(html).toContain('window.__LMS_ADAPTER_MANAGED__ = false');
    expect(html).not.toContain('window.API = api');
    expect(html).not.toContain('window.API_1484_11 = api');
  });

  it('v2 token 绑定课件 / attempt / 用户 / 课节', () => {
    const token = mintCoursewareToken('cw-1', {
      attemptId: 'att-1',
      userId: 'stu-1',
      lessonId: 'lesson-1',
    });
    const claims = verifyCoursewareTokenClaims('cw-1', token);
    expect(claims).not.toBeNull();
    expect(claims?.attemptId).toBe('att-1');
    expect(claims?.userId).toBe('stu-1');
    expect(claims?.lessonId).toBe('lesson-1');
    expect(claims?.version).toBe('v2');

    // 换课件、篡改、过期一律失败
    expect(verifyCoursewareToken('cw-2', token)).toBe(false);
    expect(verifyCoursewareToken('cw-1', `${token}x`)).toBe(false);
    const expired = mintCoursewareToken('cw-1', { attemptId: 'att-1', userId: 'u', ttlMs: -1000 });
    expect(verifyCoursewareToken('cw-1', expired)).toBe(false);
  });

  it('历史 legacy token 仍可验证（滚动升级兼容）', () => {
    const legacy = mintCoursewareToken('cw-legacy');
    const claims = verifyCoursewareTokenClaims('cw-legacy', legacy);
    expect(claims?.version).toBe('legacy');
    expect(claims?.attemptId).toBeUndefined();
  });
});
