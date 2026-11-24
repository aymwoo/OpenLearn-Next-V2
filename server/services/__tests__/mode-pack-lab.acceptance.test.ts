/**
 * 第三方模式包验收（阶段 11.1）。
 *
 * 用同一份 fixture 把 `docs/tutorials/mode-pack-third-party.md` §6 的服务端部分
 * 转成用例：manifest 校验 → 目录收录 → 能力诊断 → 课时绑定 → 环节类型路由。
 */
import { describe, expect, it } from 'vitest';
import { manifestSchema } from '../../../packages/core/esm-loader/manifest-schema.js';
import {
  normalizeSegmentType,
  resolveModePackForSegment,
  BUILTIN_WHITEBOARD_MODE_PACK_ID,
} from '../../../packages/core/plugin-host/mode-pack.js';
import {
  collectModePacks,
  findModePack,
  resolveLessonModeBinding,
  type ModePackPluginRecord,
} from '../mode-pack-catalog.js';
import {
  LAB_ADAPTER_ID,
  LAB_CHANNEL_NAME,
  LAB_MODE_PACK,
  LAB_MODE_PACK_ID,
  LAB_MODE_PACK_PLUGIN_ID,
  LAB_MODE_PACK_PLUGIN_NAME,
  LAB_OUTLINE_CONTRIBUTION_ID,
  LAB_PREP_CONTRIBUTION_ID,
  LAB_PLUGIN_MANIFEST,
  LAB_STUDENT_WORKSPACE_ID,
  LAB_TEACHER_WORKSPACE_ID,
} from '../../../packages/core/plugin-host/__tests__/fixtures/mode-pack-lab.js';

function activeRecord(overrides: Partial<ModePackPluginRecord> = {}): ModePackPluginRecord {
  return {
    id: LAB_MODE_PACK_PLUGIN_ID,
    name: LAB_MODE_PACK_PLUGIN_NAME,
    state: 'active',
    status: 'active',
    manifest: JSON.stringify(LAB_PLUGIN_MANIFEST),
    ...overrides,
  };
}

const FULL_CAPABILITIES = {
  adapterIds: new Set([LAB_ADAPTER_ID]),
  channelNames: new Set([LAB_CHANNEL_NAME]),
};

describe('第三方模式包 fixture：服务端目录', () => {
  it('manifest 通过 schema 校验并保留全部 mode.pack 字段', () => {
    const parsed = manifestSchema.safeParse(LAB_PLUGIN_MANIFEST);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const packs = parsed.data.contributes?.['mode.pack'] ?? [];
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: LAB_MODE_PACK_ID,
      label: LAB_MODE_PACK.label,
      segmentTypes: LAB_MODE_PACK.segmentTypes,
      prepContributionId: LAB_PREP_CONTRIBUTION_ID,
      outlineContributionId: LAB_OUTLINE_CONTRIBUTION_ID,
      teacherWorkspaceId: LAB_TEACHER_WORKSPACE_ID,
      studentWorkspaceId: LAB_STUDENT_WORKSPACE_ID,
      adapterIds: [LAB_ADAPTER_ID],
      channels: [LAB_CHANNEL_NAME],
    });
  });

  it('已激活插件进入目录，能力齐全时不产生 warnings', () => {
    const packs = collectModePacks([activeRecord()], FULL_CAPABILITIES);
    const lab = findModePack(LAB_MODE_PACK_ID, packs);

    expect(lab).toMatchObject({
      source: 'plugin',
      pluginId: LAB_MODE_PACK_PLUGIN_ID,
      pluginName: LAB_MODE_PACK_PLUGIN_NAME,
    });
    expect(lab?.warnings).toBeUndefined();
  });

  it('adapter / channel 未注册时目录带 warnings，但仍返回条目', () => {
    const packs = collectModePacks([activeRecord()], {
      adapterIds: new Set(),
      channelNames: new Set(),
    });
    const lab = findModePack(LAB_MODE_PACK_ID, packs);

    expect(lab).toBeDefined();
    expect(lab?.warnings).toEqual([`适配器未注册：${LAB_ADAPTER_ID}`, `消息通道未注册：${LAB_CHANNEL_NAME}`]);
  });

  it('未激活或 manifest 损坏的插件不进目录', () => {
    const inactive = collectModePacks([activeRecord({ state: 'inactive', status: 'disabled' })], FULL_CAPABILITIES);
    expect(findModePack(LAB_MODE_PACK_ID, inactive)).toBeNull();

    const broken = collectModePacks([activeRecord({ manifest: '{broken' })], FULL_CAPABILITIES);
    expect(findModePack(LAB_MODE_PACK_ID, broken)).toBeNull();
  });

  it('课时绑定第三方包直接落库，不回落白板', () => {
    const packs = collectModePacks([activeRecord()], FULL_CAPABILITIES);
    const binding = resolveLessonModeBinding({ modePackId: LAB_MODE_PACK_ID, packs });

    expect(binding).toEqual({
      modePackId: LAB_MODE_PACK_ID,
      deliveryMode: 'whiteboard',
      fallback: false,
    });
  });

  it('按前缀认领子环节，未认领的类型回落白板默认包', () => {
    const packs = collectModePacks([activeRecord()], FULL_CAPABILITIES);

    expect(resolveModePackForSegment(packs, 'inquiry')?.id).toBe(LAB_MODE_PACK_ID);
    expect(resolveModePackForSegment(packs, 'inquiry:sim')?.id).toBe(LAB_MODE_PACK_ID);
    expect(resolveModePackForSegment(packs, normalizeSegmentType(null))?.id).toBe(BUILTIN_WHITEBOARD_MODE_PACK_ID);
    expect(resolveModePackForSegment(packs, 'whiteboard')?.id).toBe(BUILTIN_WHITEBOARD_MODE_PACK_ID);
  });
});
