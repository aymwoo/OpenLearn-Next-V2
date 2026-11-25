import { describe, expect, it } from 'vitest';
import {
  buildSkillToolBindings,
  isSkillVisible,
  normalizeLessonSegments,
  parseManifestSkills,
  parseSkillArtifact,
  type SkillDescriptor,
} from '../skill-registry.js';

/**
 * P0 Skill 注册表回归：manifest → 描述符、场景/角色过滤、产物解析。
 * 这些是纯函数，不依赖真实 AI Provider，也不读写业务表。
 */

const PLUGIN_MANIFEST = {
  id: '@scope/demo-plugin',
  contributes: {
    'ai.skill.provider': [
      {
        id: 'prep-outline',
        name: '大纲生成',
        description: '生成课时大纲',
        whenToUse: '备课时需要大纲',
        instructions: '只输出 JSON',
        surfaces: ['lesson_prep'],
        roles: ['teacher'],
        tools: [{ commandType: 'demo.outline', requiresConfirm: true }],
        outputKind: 'lesson_segments',
        latencyClass: 'background',
        maxTurns: 3,
      },
      {
        id: 'legacy-tool',
        name: '旧式工具',
        description: '兼容旧字段',
        commandType: 'demo.search',
      },
      {
        id: 'no-command',
        name: '缺少命令',
        description: '应被跳过',
      },
    ],
  },
};

describe('parseManifestSkills', () => {
  it('解析新技能包字段，并把旧条目归一为单工具技能', () => {
    const skills = parseManifestSkills(PLUGIN_MANIFEST);
    expect(skills).toHaveLength(2);

    const outline = skills.find((skill) => skill.id === '@scope/demo-plugin:prep-outline');
    expect(outline).toBeDefined();
    expect(outline?.source).toBe('plugin');
    expect(outline?.pluginId).toBe('@scope/demo-plugin');
    expect(outline?.surfaces).toEqual(['lesson_prep']);
    expect(outline?.roles).toEqual(['teacher']);
    expect(outline?.tools).toEqual([{ commandType: 'demo.outline', requiresConfirm: true }]);
    expect(outline?.outputKind).toBe('lesson_segments');
    expect(outline?.latencyClass).toBe('background');
    expect(outline?.maxTurns).toBe(3);

    const legacy = skills.find((skill) => skill.id === '@scope/demo-plugin:legacy-tool');
    expect(legacy?.tools).toEqual([{ commandType: 'demo.search', requiresConfirm: false }]);
    expect(legacy?.surfaces).toEqual(['lesson_prep', 'admin_settings', 'classroom_live']);
    expect(legacy?.roles).toBeUndefined();
  });

  it('忽略非法 JSON、非对象条目与缺少命令的条目', () => {
    expect(parseManifestSkills('{invalid json')).toEqual([]);
    expect(parseManifestSkills(null)).toEqual([]);
    expect(
      parseManifestSkills({ id: '@scope/p', contributes: { 'ai.skill.provider': [null, 42, { id: 'x' }] } }),
    ).toEqual([]);
  });
});

describe('isSkillVisible', () => {
  const base: SkillDescriptor = {
    id: 'builtin:demo',
    source: 'builtin',
    name: 'demo',
    description: 'demo',
    surfaces: ['lesson_prep'],
    roles: ['teacher'],
    tools: [],
    latencyClass: 'interactive',
  };

  it('按场景过滤', () => {
    expect(isSkillVisible(base, 'lesson_prep', 'teacher')).toBe(true);
    expect(isSkillVisible(base, 'classroom_live', 'teacher')).toBe(false);
  });

  it('未声明 roles 时默认排除学生', () => {
    const noRoles: SkillDescriptor = { ...base, roles: undefined };
    expect(isSkillVisible(noRoles, 'lesson_prep', 'teacher')).toBe(true);
    expect(isSkillVisible(noRoles, 'lesson_prep', 'student')).toBe(false);
  });

  it('显式声明 student 时才对学生可见', () => {
    const studentSkill: SkillDescriptor = { ...base, roles: ['student'] };
    expect(isSkillVisible(studentSkill, 'lesson_prep', 'student')).toBe(true);
    expect(isSkillVisible(studentSkill, 'lesson_prep', 'teacher')).toBe(false);
  });
});

describe('buildSkillToolBindings', () => {
  it('第三方技能的命令强制命名空间化，并保留 requiresConfirm', () => {
    const skill = parseManifestSkills(PLUGIN_MANIFEST).find(
      (item) => item.id === '@scope/demo-plugin:prep-outline',
    ) as SkillDescriptor;
    const bindings = buildSkillToolBindings(skill);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].commandType).toBe('@scope/demo-plugin.demo.outline');
    expect(bindings[0].pluginActorId).toBe('plugin:@scope/demo-plugin');
    expect(bindings[0].requiresConfirm).toBe(true);
  });
});

describe('normalizeLessonSegments', () => {
  it('裁剪非法字段、限制数量并归一 duration/type', () => {
    const segments = normalizeLessonSegments([
      { title: '导入', duration: '5', type: 'intro' },
      { title: '', duration: '10m', type: 'lecture' },
      { title: '练习', duration: 'abc', type: 'unknown' },
      ...Array.from({ length: 10 }, (_, index) => ({ title: `S${index}`, duration: '10m', type: 'practice' })),
    ]);
    expect(segments).toHaveLength(8);
    expect(segments[0]).toEqual({ title: '导入', duration: '5m', type: 'intro' });
    expect(segments[1]).toEqual({ title: '练习', duration: '15m', type: 'lecture' });
  });
});

describe('parseSkillArtifact', () => {
  const skill: SkillDescriptor = {
    id: 'lesson.plan.generate',
    source: 'builtin',
    name: '课时教案生成',
    description: 'demo',
    surfaces: ['lesson_prep'],
    roles: ['teacher', 'administrator'],
    tools: [],
    outputKind: 'lesson_segments',
    latencyClass: 'interactive',
  };

  it('解析裸 JSON 与代码围栏 JSON', () => {
    const raw = '{"segments":[{"title":"导入","duration":"5m","type":"intro"}]}';
    expect(parseSkillArtifact(skill, raw)?.segments[0].title).toBe('导入');
    expect(parseSkillArtifact(skill, `\`\`\`json\n${raw}\n\`\`\``)?.segments).toHaveLength(1);
  });

  it('混入解释文字时提取首个 JSON 对象', () => {
    const text = '好的，以下是结果：\n{"segments":[{"title":"练习","duration":"10m","type":"practice"}]}\n请查收。';
    expect(parseSkillArtifact(skill, text)?.segments[0]).toEqual({
      title: '练习',
      duration: '10m',
      type: 'practice',
    });
  });

  it('无法解析时回退为单个环节', () => {
    const artifact = parseSkillArtifact(skill, '# 开场导入\n讲解新课');
    expect(artifact?.segments).toHaveLength(1);
    expect(artifact?.segments[0]).toMatchObject({ title: '开场导入', duration: '15m', type: 'lecture' });
  });

  it('非 lesson_segments 产物直接返回 null', () => {
    expect(parseSkillArtifact({ ...skill, outputKind: undefined }, 'anything')).toBeNull();
  });
});
