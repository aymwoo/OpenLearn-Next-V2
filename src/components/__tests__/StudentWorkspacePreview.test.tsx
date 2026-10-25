/**
 * Student Workspace 预览开关（C 组迁移 P1）
 *
 * 这组用例守的是一件很窄但很重要的事：**开关必须默认关闭，且只认显式参数**。
 * 一旦它误开，所有学生会进到一个功能不等价的半成品壳 —— 那是最坏的结果。
 */
import { describe, it, expect } from 'vitest';
import {
  isStudentWorkspacePreviewEnabled,
  STUDENT_WORKSPACE_PREVIEW_QUERY,
  STUDENT_WORKSPACE_PREVIEW_VALUE,
} from '../StudentWorkspacePreview';

describe('Student Workspace 预览开关', () => {
  it('默认关闭：空 query / 无参数', () => {
    expect(isStudentWorkspacePreviewEnabled('')).toBe(false);
    expect(isStudentWorkspacePreviewEnabled('?')).toBe(false);
    expect(isStudentWorkspacePreviewEnabled('?foo=bar')).toBe(false);
  });

  it('只有显式的 studentShell=workspace 才开启', () => {
    expect(
      isStudentWorkspacePreviewEnabled(`?${STUDENT_WORKSPACE_PREVIEW_QUERY}=${STUDENT_WORKSPACE_PREVIEW_VALUE}`),
    ).toBe(true);
  });

  it('值必须精确匹配 —— 不接受 "1" / "true" / 其它拼写', () => {
    for (const bad of ['1', 'true', 'on', 'workspaces', 'Workspace', '']) {
      expect(
        isStudentWorkspacePreviewEnabled(`?${STUDENT_WORKSPACE_PREVIEW_QUERY}=${bad}`),
        `值 "${bad}" 不应开启预览壳`,
      ).toBe(false);
    }
  });

  it('与其它参数共存时仍能识别', () => {
    expect(
      isStudentWorkspacePreviewEnabled(
        `?lang=zh&${STUDENT_WORKSPACE_PREVIEW_QUERY}=${STUDENT_WORKSPACE_PREVIEW_VALUE}&x=1`,
      ),
    ).toBe(true);
  });

  it('非法 query 不抛错，按关闭处理', () => {
    expect(isStudentWorkspacePreviewEnabled('?%')).toBe(false);
  });
});
