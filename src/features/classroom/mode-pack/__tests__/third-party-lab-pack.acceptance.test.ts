/**
 * 第三方模式包验收（阶段 11.1，前端链路）。
 *
 * 与 `server/services/__tests__/mode-pack-lab.acceptance.test.ts` 共用同一份 fixture，
 * 覆盖 `docs/tutorials/mode-pack-third-party.md` §6 的前端部分：
 * 工作区决议、大纲贡献、环节类型自动注册 / 清理、课程徽标与扩展点声明一致性。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setModePacksEnabledForTests } from '../flags';
import { resolveWorkspace } from '../resolveWorkspace';
import { resolveOutlineContribution } from '../outlineContribution';
import { applyModePackSegmentTypes } from '../ModePackSegmentTypeBridge';
import { resolveLessonDeliveryMode, resolveLessonModeBadge, type ModePackCatalogEntry } from '../useModePackCatalog';
import {
  getAllSegmentTypes,
  SEGMENT_TYPES,
  unregisterCustomSegmentType,
} from '../../../teacher/lesson-editor/timelineConfig';
import {
  LAB_EXTENSION_REGISTRATIONS,
  LAB_MODE_PACK,
  LAB_MODE_PACK_ID,
  LAB_MODE_PACK_PLUGIN_ID,
  LAB_MODE_PACK_PLUGIN_NAME,
  LAB_OUTLINE_CONTRIBUTION_ID,
  LAB_PREP_CONTRIBUTION_ID,
  LAB_STUDENT_WORKSPACE_ID,
  LAB_TEACHER_WORKSPACE_ID,
} from '../../../../../packages/core/plugin-host/__tests__/fixtures/mode-pack-lab';

const LAB_ENTRY: ModePackCatalogEntry = {
  ...LAB_MODE_PACK,
  source: 'plugin',
  pluginId: LAB_MODE_PACK_PLUGIN_ID,
  pluginName: LAB_MODE_PACK_PLUGIN_NAME,
};

afterEach(() => {
  setModePacksEnabledForTests(null);
  for (const type of getAllSegmentTypes()) {
    if (!SEGMENT_TYPES.some((builtin) => builtin.id === type.id)) unregisterCustomSegmentType(type.id);
  }
});

describe('第三方模式包 fixture：前端消费链路', () => {
  it('flag 关闭时始终 legacy', () => {
    setModePacksEnabledForTests(false);
    expect(resolveWorkspace({ segmentType: 'inquiry', packs: [LAB_MODE_PACK] }).kind).toBe('legacy');
  });

  it('按 segmentTypes 前缀命中双端工作区，未认领类型不抢白板', () => {
    setModePacksEnabledForTests(true);

    const exact = resolveWorkspace({ segmentType: 'inquiry', packs: [LAB_MODE_PACK] });
    expect(exact.kind).toBe('mode-pack');
    expect(exact.kind === 'mode-pack' && exact.pack.id).toBe(LAB_MODE_PACK_ID);

    const child = resolveWorkspace({ segmentType: 'inquiry:sim', packs: [LAB_MODE_PACK] });
    expect(child.kind === 'mode-pack' && child.pack.teacherWorkspaceId).toBe(LAB_TEACHER_WORKSPACE_ID);
    expect(child.kind === 'mode-pack' && child.pack.studentWorkspaceId).toBe(LAB_STUDENT_WORKSPACE_ID);

    // fixture 不是 isDefault，白板环节不应被它接管
    expect(resolveWorkspace({ segmentType: 'whiteboard', packs: [LAB_MODE_PACK] }).kind).toBe('legacy');
  });

  it('大纲贡献决议为 extension，并带上包的 outlineContributionId', () => {
    expect(resolveOutlineContribution({ segmentType: 'inquiry', packs: [LAB_MODE_PACK] })).toEqual({
      kind: 'extension',
      outlineContributionId: LAB_OUTLINE_CONTRIBUTION_ID,
      packId: LAB_MODE_PACK_ID,
    });
  });

  it('环节类型自动注册进选择器，包消失后清理', () => {
    const registered = applyModePackSegmentTypes({ packs: [LAB_ENTRY] });
    expect(Array.from(registered.get(LAB_MODE_PACK_PLUGIN_ID) ?? [])).toEqual(['inquiry']);
    expect(getAllSegmentTypes().map((type) => type.id)).toContain('inquiry');

    applyModePackSegmentTypes({ packs: [], previous: registered });
    expect(getAllSegmentTypes().map((type) => type.id)).not.toContain('inquiry');
  });

  it('课程徽标优先显示第三方包名，未知包回落并提示', () => {
    const badge = resolveLessonModeBadge(
      { mode_pack_id: LAB_MODE_PACK_ID, delivery_mode: 'whiteboard' },
      [LAB_ENTRY],
      'zh',
    );
    expect(badge.label).toBe(LAB_MODE_PACK.label);
    expect(badge.title).toBe(LAB_MODE_PACK_ID);

    const missing = resolveLessonModeBadge({ mode_pack_id: 'ext-missing:mode' }, [LAB_ENTRY], 'zh');
    expect(missing.label).toBe('白板');
    expect(missing.title).toContain('模式包不可用');
  });

  it('第三方包沿用兼容交付模式，旧读路径不退化', () => {
    expect(resolveLessonDeliveryMode({ mode_pack_id: LAB_MODE_PACK_ID, delivery_mode: 'whiteboard' })).toBe(
      'whiteboard',
    );
  });

  it('扩展点注册声明与包字段一一对应', () => {
    const bySlot = new Map(LAB_EXTENSION_REGISTRATIONS.map((entry) => [entry.slot, entry.config]));

    expect(bySlot.get('classroom.prep')?.id).toBe(LAB_PREP_CONTRIBUTION_ID);
    expect(bySlot.get('classroom.outline')?.id).toBe(LAB_OUTLINE_CONTRIBUTION_ID);
    expect(bySlot.get('classroom.active_segment.main')?.id).toBe(LAB_TEACHER_WORKSPACE_ID);
    expect(bySlot.get('classroom.active_segment.student_main')?.id).toBe(LAB_STUDENT_WORKSPACE_ID);
    expect(new Set(LAB_EXTENSION_REGISTRATIONS.map((entry) => entry.slot)).size).toBe(
      LAB_EXTENSION_REGISTRATIONS.length,
    );
  });
});
