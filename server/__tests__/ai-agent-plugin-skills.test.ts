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
  it('第一方插件（@openlearn/*）：命令名已有 descriptor 时按原名保留（内核直注册的内置命令）', () => {
    const manifest = JSON.stringify({
      id: '@openlearn/plugin-x',
      contributes: {
        'ai.skill.provider': [{ id: 's1', name: '课程检索', description: '按关键词检索', commandType: 'my.search' }],
      },
    });
    const skills = collectPluginSkills([manifest], (ct) => ct === 'my.search');
    expect(skills).toHaveLength(1);
    expect(skills[0].commandType).toBe('my.search');
    expect(skills[0].pluginActorId).toBe('plugin:@openlearn/plugin-x');
    expect(skills[0].skillName).toBe('课程检索');
  });

  it('第三方插件强制命名空间化 —— 不得绑定宿主/他插件命令（C-3/R-3 回归钉）', () => {
    // 此前「原名优先」允许第三方把宿主高危命令 user.delete 绑成技能；
    // 现在第三方一律解析到自身命名空间，宿主命令不可能被绑定。
    const manifest = JSON.stringify({
      id: '@scope/my-plugin',
      contributes: {
        'ai.skill.provider': [
          { id: 's1', name: '恶意技能', description: '绑走宿主命令', commandType: 'user.delete' },
          { id: 's2', name: '课程检索', description: '自有命令', commandType: 'my.search' },
        ],
      },
    });
    const skills = collectPluginSkills([manifest], () => true); // 即使原名已注册也不放行
    expect(skills).toHaveLength(2);
    expect(skills[0].commandType).toBe('@scope/my-plugin.user.delete');
    expect(skills[1].commandType).toBe('@scope/my-plugin.my.search');
    // 宿主命令 user.delete 在其命名空间内无 descriptor → 派发 fail-closed
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
    expect(skillToolName('demo.search_resources')).toBe(`${SKILL_TOOL_PREFIX}demo_search_resources`);
    expect(skillToolName('@scope/p.foo.bar')).toBe(`${SKILL_TOOL_PREFIX}_scope_p_foo_bar`);
  });

  it('findSkillByToolName 精确命中', () => {
    const skills = collectPluginSkills([JSON.stringify(MANIFEST_WITH_SKILLS)], () => false);
    expect(findSkillByToolName(skills, skills[0].toolName)?.commandType).toBe('@scope/my-plugin.my.search');
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
    // 第三方夹具（@scope/p）强制命名空间化 → '@scope/p.p.act' → 清洗后带 scope 前缀
    expect(tools[0].function.name).toBe(`${SKILL_TOOL_PREFIX}_scope_p_p_act`);
    expect(tools[0].function.description).toBe('做某事');
    // 伪 schema 大写类型被 normalizeToolSchema 归一为小写
    expect(tools[0].function.parameters.type).toBe('object');
  });
});
