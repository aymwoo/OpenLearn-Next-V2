import { describe, it, expect } from 'vitest';
import {
  collectPluginSkills,
  buildPluginSkillTools,
  findSkillByToolName,
  skillToolName,
  SKILL_TOOL_PREFIX,
} from '../ai-agent.js';

/**
 * ai.skill.provider 消费链路（真实工具注入）回归测试。
 *
 * v0.6.0 审计遗留：该槽位此前只有 schema 与 store 登记、无任何消费方。
 * 现在的消费链：manifest contributes['ai.skill.provider'] → agent 工具注入
 * → 以贡献插件 actor 派发。这里钉住纯函数语义（收集/解析/去重/命名）。
 */

const MANIFEST_WITH_SKILLS = {
  id: '@scope/my-plugin',
  contributes: {
    'ai.skill.provider': [
      {
        id: 'skill-1',
        name: '课程检索',
        description: '按关键词检索课程',
        commandType: 'my.search',
      },
      {
        id: 'skill-2',
        name: '无命令技能',
        description: '缺 commandType，应被跳过',
      },
      { id: 'skill-3', name: '噪声', description: '非对象条目' },
    ],
  },
};

describe('collectPluginSkills', () => {
  it('命令名已有 descriptor 时按原名保留（内核直注册的内置命令）', () => {
    const skills = collectPluginSkills([JSON.stringify(MANIFEST_WITH_SKILLS)], (ct) => ct === 'my.search');
    expect(skills).toHaveLength(1);
    expect(skills[0].commandType).toBe('my.search');
    expect(skills[0].pluginActorId).toBe('plugin:@scope/my-plugin');
    expect(skills[0].skillName).toBe('课程检索');
  });

  it('命令名未注册时回退插件命名空间规则（worker 插件 handler）', () => {
    const skills = collectPluginSkills([JSON.stringify(MANIFEST_WITH_SKILLS)], () => false);
    expect(skills).toHaveLength(1);
    expect(skills[0].commandType).toBe('@scope/my-plugin.my.search');
    expect(skills[0].toolName).toBe(skillToolName('@scope/my-plugin.my.search'));
  });

  it('缺 commandType 与非对象条目被跳过；无效 JSON 源被忽略', () => {
    const skills = collectPluginSkills(
      [JSON.stringify(MANIFEST_WITH_SKILLS), '{invalid json', null, { not: 'a manifest' }],
      () => true,
    );
    expect(skills).toHaveLength(1);
  });

  it('toolName 加 pskill_ 前缀并清洗非法字符', () => {
    expect(skillToolName('smart_edu.search_resources')).toBe(`${SKILL_TOOL_PREFIX}smart_edu_search_resources`);
    expect(skillToolName('@scope/p.foo.bar')).toBe(`${SKILL_TOOL_PREFIX}_scope_p_foo_bar`);
  });

  it('findSkillByToolName 精确命中', () => {
    const skills = collectPluginSkills([JSON.stringify(MANIFEST_WITH_SKILLS)], (ct) => ct === 'my.search');
    expect(findSkillByToolName(skills, skills[0].toolName)?.commandType).toBe('my.search');
    expect(findSkillByToolName(skills, 'pskill_unknown')).toBeUndefined();
  });
});

describe('buildPluginSkillTools', () => {
  it('生成 OpenAI function 工具（显式 parametersSchema）', () => {
    const skills = collectPluginSkills(
      [
        JSON.stringify({
          id: '@scope/p',
          contributes: {
            'ai.skill.provider': [
              {
                id: 's1',
                name: '技能A',
                description: '做某事',
                commandType: 'p.act',
                parametersSchema: { type: 'OBJECT', properties: { q: { type: 'STRING' } } },
              },
            ],
          },
        }),
      ],
      () => true,
    );
    const tools = buildPluginSkillTools(skills);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe(`${SKILL_TOOL_PREFIX}p_act`);
    expect(tools[0].function.description).toBe('做某事');
    // 伪 schema 大写类型被 normalizeToolSchema 归一为小写
    expect(tools[0].function.parameters.type).toBe('object');
  });
});
