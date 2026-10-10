/**
 * E-1 护栏：manifest `contributes` schema 与 ContributionRegistry 的**双源一致**。
 *
 * 修复前 schema 只枚举 6 个 slot，其余经 passthrough 原样入库 ——
 * 「安装期 schema 校验」对多数 slot 不成立。现已补全 21 个服务端 slot。
 *
 * 但 schema（manifest-schema.ts）与 Config 接口（contribution-registry.ts）
 * 仍是两份手写声明。本测试锚定最常见的两种漂移：
 *   1. **key 名漂移** —— schema 认的 slot 名与 registry 消费的名字不一致；
 *   2. **形状漂移** —— 某 slot 漏了 zod 校验（坏条目安装期不被拒）。
 * 用「全 slot 合法 fixture 双向通过 + 每 slot 一个坏条目被拒」把两者钉住。
 */
import { describe, it, expect } from 'vitest';
import { manifestSchema } from '../../esm-loader/manifest-schema.js';
import { ContributionRegistry } from '../contribution-registry.js';

/** 每个服务端 slot 的一条**合法**条目（字段与 contribution-registry.ts 的接口一致） */
const VALID_ENTRY: Record<string, unknown> = {
  'classroom.tool': { id: 't1', name: 'Tool', commandType: 'x.y' },
  'teacher.tab': { id: 't2', label: 'Tab' },
  'teacher.dashboard.widget': { id: 't3', label: 'Widget' },
  'student.view': { id: 't4', label: 'View' },
  'student.lesson.tool': { id: 't5', label: 'LessonTool' },
  'classroom.quick_activity': { id: 't6', name: 'Quick' },
  'timeline.segments': { id: 't7', labelZh: '环节', labelEn: 'Segment' },
  'palette.items': { id: 't8', type: 'widget', labelZh: '工具', labelEn: 'Item' },
  'teacher.cockpit.widget': { id: 't9', title: 'Cockpit' },
  'stage.display.card': { id: 't10', title: 'Stage' },
  'classroom.topbar.action': { id: 't11', name: 'Topbar' },
  'classroom.attribution.award': {
    id: 't12',
    dimensionId: 'd1',
    name: 'Award',
    description: 'd',
    defaultDeltaPoints: 5,
  },
  'student.profile.dimension': { id: 't13', label: 'Dim', key: 'k1' },
  'student.profile.card': { id: 't14', title: 'Card' },
  'whiteboard.canvas.widget': { id: 't15', title: 'Canvas', component: 'C' },
  'classroom.barometer.metric': { id: 't16', label: 'Metric' },
  'peer_review.rubric.dimension': { id: 't17', name: 'Rubric' },
  'peer_review.badge': { id: 't18', title: 'Badge' },
  'classroom.preclass.passcode_action': { id: 't19', label: 'PasscodeAction' },
  'classroom.preclass.passcode_addon': { id: 't20', title: 'Addon' },
  'help.plugin_docs': { id: 't21', title: 'Docs' },
  'command_palette.item': { id: 't22', title: 'Open Palette' },
  'quick_insert.item': { id: 't23', title: 'Insert Diagram' },
  'ai.prompt.template': { id: 't24', title: 'Toulmin Model', prompt: 'Analyze claims' },
  'ai.skill.provider': { id: 't25', name: 'calc_tool', description: 'Calculator' },
  'class.tab': { id: 't26', label: 'Class Stats' },
  'class.batch.action': { id: 't27', label: 'Batch Export' },
  'student.row.panel': { id: 't28', title: 'Student Detail' },
  'editor.header.action': { id: 't29', label: 'AI Check' },
  'classroom.post_class.widget': { id: 't30', title: 'Exit Ticket' },
  'courseware.viewer.toolbar': { id: 't31', label: 'Draw Tool' },
  'courseware.viewer.overlay': { id: 't32', title: 'Watermark' },
  'classroom.portal.telemetry': { id: 't33', label: 'Ping' },
  'classroom.portal.course_badge': { id: 't34', label: 'VIP' },
  'classroom.portal.teaching_mode': { id: 't35', title: 'Flipped' },
  'classroom.portal.insight': { id: 't36', title: 'Weak Points' },
  'classroom.portal.preflight': { id: 't37', label: 'Mic Check' },
  'classroom.portal.launch_action': { id: 't38', label: 'Fast Start' },
  'classroom.countdown.widget': { id: 't39', title: 'Countdown' },
  'classroom.countdown.action': { id: 't40', label: 'Add 1m' },
  'student.classroom.countdown': { id: 't41', title: 'Exam End' },
  'student.quick_actions.item': { id: 't42', label: 'Raise Hand' },
  'student.quick_actions.action': { id: 't43', label: 'Ask Doubt' },
  'student.quick_actions.fab': { id: 't44', label: 'Help' },
  'classroom.notification.tabs': { id: 't45', label: 'SMS' },
  'classroom.pacing.dashboard': { id: 't46', title: 'Pacing' },
  'classroom.diagnostic.feed': { id: 't47', title: 'Logs' },
  'classroom.collab.canvas': { id: 't48', label: 'Group 1' },
  'classroom.topbar.pill': { id: 't49', label: 'Syncing' },
  'classroom.attribution.action': { id: 't50', label: 'Add 5 pts' },
  'classroom.leaderboard.action': { id: 't51', label: 'Export Ranks' },
  'student.profile.action': { id: 't52', label: 'Send Medal' },
  'student.profile.timeline_item': { id: 't53', title: 'Quiz Answer' },
  'classroom.header.action': { id: 't54', label: 'Record Screen' },
  'classroom.agenda.action': { id: 't55', label: 'Skip Step' },
  'whiteboard.dock.plugin': { id: 't56', title: 'Desmos' },
  'classroom.audit.event': { id: 't57', title: 'Audit' },
  'peer_review.action': { id: 't58', label: 'Submit Review' },
  'peer_review.showcase.widget': { id: 't59', title: 'Compare' },
  'classroom.seating.toolbar': { id: 't60', label: 'Lock Seats' },
  'classroom.seating.legend': { id: 't61', label: 'Present' },
  'classroom.seating.seat_badge': { id: 't62', label: 'Leader' },
  'classroom.seating.seat_actions': { id: 't63', label: 'Reboot PC' },
  'classroom.seating.summary': { id: 't64', title: 'Lab Stats' },
  'whiteboard.autosave.status': { id: 't65', label: 'Saved' },
  'whiteboard.autosave.action': { id: 't66', label: 'Backup Now' },
  'teacher.panel': { id: 't67', title: 'Full Panel' },
  'student.fullscreen': { id: 't68', title: 'Exam Lock' },
  'global.setting': { id: 't69', title: 'OSS Storage' },
  'nav.user_menu': { id: 't70', label: 'My Badges' },
};

/** 每个 slot 的**破坏形状**与期望命中的错误特征（缺必填字段 / 枚举越界 / 类型错误） */
const INVALID_ENTRY: Record<string, { entry: unknown; pattern: RegExp }> = {
  'classroom.tool': { entry: { id: 'b1', name: 'x' /* 缺 commandType */ }, pattern: /commandType|classroom\.tool/i },
  'timeline.segments': { entry: { id: 'b7', labelEn: 'x' /* 缺 labelZh */ }, pattern: /labelZh|timeline\.segments/i },
  'palette.items': {
    entry: { id: 'b8', type: 'w', labelZh: 'x', labelEn: 'y', category: 'bad-enum' },
    pattern: /category|palette\.items/i,
  },
  'classroom.attribution.award': {
    entry: { id: 'b12', dimensionId: 'd', name: 'a', description: 'd' /* 缺 defaultDeltaPoints */ },
    pattern: /defaultDeltaPoints/i,
  },
  'whiteboard.canvas.widget': { entry: { id: 'b15', title: 'x' /* 缺 component */ }, pattern: /component/i },
  'command_palette.item': { entry: { id: 'b22' /* 缺 title */ }, pattern: /title/i },
  'quick_insert.item': { entry: { id: 'b23' /* 缺 title */ }, pattern: /title/i },
  'ai.prompt.template': { entry: { id: 'b24', title: 'T' /* 缺 prompt */ }, pattern: /prompt/i },
  'ai.skill.provider': { entry: { id: 'b25', name: 'N' /* 缺 description */ }, pattern: /description/i },
};

const SERVER_SLOTS = Object.keys(VALID_ENTRY);

describe('E-1 · contributes schema ↔ contribution-registry 双源一致', () => {
  it('21 个服务端 slot 的合法条目全部通过安装期校验', () => {
    const contributes = Object.fromEntries(SERVER_SLOTS.map((k) => [k, [VALID_ENTRY[k]]]));
    const parsed = manifestSchema.parse({ id: 'p', name: 'P', version: '1.0.0', main: 'index.js', contributes });

    for (const slot of SERVER_SLOTS) {
      expect((parsed.contributes as Record<string, unknown[]>)[slot], `slot "${slot}" 应在 parse 后保留`).toHaveLength(
        1,
      );
    }
  });

  it('schema 认的 slot 名与 registry 消费的名字一致（双向 getBySlot 命中）', () => {
    const registry = new ContributionRegistry();
    const contributes = Object.fromEntries(SERVER_SLOTS.map((k) => [k, [VALID_ENTRY[k]]]));
    // 先过 schema 校验，再把「校验后」的对象注册进 registry —— 模拟真实安装链路
    const parsed = manifestSchema.parse({ id: 'p', name: 'P', version: '1.0.0', main: 'index.js', contributes });
    registry.register('ext-parity', parsed.contributes as Record<string, never>);

    for (const slot of SERVER_SLOTS) {
      expect(registry.getBySlot(slot), `registry 未消费 schema 校验通过的 slot "${slot}" —— key 名漂移`).toHaveLength(
        1,
      );
    }
    expect(registry.stats().totalContributions).toBe(SERVER_SLOTS.length);
  });

  it('每个被抽查 slot 的坏条目在安装期即被拒（而非运行时才炸）', () => {
    for (const [slot, { entry, pattern }] of Object.entries(INVALID_ENTRY)) {
      expect(
        () =>
          manifestSchema.parse({
            id: 'p',
            name: 'P',
            version: '1.0.0',
            main: 'index.js',
            contributes: { [slot]: [entry] },
          }),
        `slot "${slot}" 的坏条目未被 schema 拒绝 —— 该 slot 漏了 zod 校验`,
      ).toThrow(pattern);
    }
  });

  it('anchor:* 开放命名空间仍由 passthrough 透传（不被 strip、不强制数组）', () => {
    const parsed = manifestSchema.parse({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      main: 'index.js',
      contributes: { 'anchor:toolbar-export': { id: 'a1', placement: 'before', label: 'x' } },
    });
    expect((parsed.contributes as Record<string, unknown>)['anchor:toolbar-export']).toMatchObject({ id: 'a1' });
  });

  it('前端专属 slot 宽松兜底：缺 id 被拒，其余字段透传', () => {
    expect(() =>
      manifestSchema.parse({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        main: 'index.js',
        contributes: { 'header.action': [{ label: 'no-id' }] },
      }),
    ).toThrow(/header\.action|id/i);

    const parsed = manifestSchema.parse({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      main: 'index.js',
      contributes: { 'header.action': [{ id: 'h1', anything: { nested: true } }] },
    });
    expect((parsed.contributes as Record<string, unknown[]>)['header.action'][0]).toMatchObject({
      id: 'h1',
      anything: { nested: true },
    });

    // 验证新加入的备课与智慧教育对接业务槽位
    expect(() =>
      manifestSchema.parse({
        id: 'p',
        name: 'P',
        version: '1.0.0',
        main: 'index.js',
        contributes: { 'course.list.toolbar.action': [{ label: 'no-id' }] },
      }),
    ).toThrow(/course\.list\.toolbar\.action|id/i);

    const parsedCourse = manifestSchema.parse({
      id: 'p',
      name: 'P',
      version: '1.0.0',
      main: 'index.js',
      contributes: { 'course.list.toolbar.action': [{ id: 'national-edu-sync', title: '国家智慧教育平台同步' }] },
    });
    expect((parsedCourse.contributes as Record<string, unknown[]>)['course.list.toolbar.action'][0]).toMatchObject({
      id: 'national-edu-sync',
      title: '国家智慧教育平台同步',
    });
  });
});
