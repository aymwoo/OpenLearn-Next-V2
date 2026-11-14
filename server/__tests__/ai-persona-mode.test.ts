import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildAgentSystemInstruction,
  isToolAllowedByPolicy,
  resolvePersonaMaxTurns,
  resolveToolsForPersona,
  runOpenAIAgentChat,
  type PluginSkillTool,
} from '../ai-agent.js';
import { registerAIPersona, unregisterAIPersona } from '../ai-persona-registry.js';

describe('IKVA8R P0 · 可替换式 Persona、toolPolicy 与 maxTurns', () => {
  const PLUGIN_ID = '@test/persona-mode';
  const createdIds: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const id of createdIds) {
      unregisterAIPersona(id, PLUGIN_ID);
    }
    createdIds.length = 0;
  });

  it('mode=replace + basePolicy=drop 丢弃内置 OS Agent 指令，仅保留角色指令与上下文', () => {
    const out = buildAgentSystemInstruction(
      'zh',
      'lesson-99',
      ['[Plugin Context · py]\nsyntax error'],
      {
        nameZh: '独立科研导师',
        nameEn: 'Research Mentor',
        instructionZh: '你是独立科研导师，只引导实验设计。',
        instructionEn: 'You are an independent research mentor.',
        mode: 'replace',
        basePolicy: 'drop',
      },
      'teacher',
    );

    expect(out).toContain('[Persona · 独立科研导师]');
    expect(out).toContain('你是独立科研导师，只引导实验设计。');
    expect(out).not.toContain('OS Agent');
    expect(out).toContain('lesson-99');
    expect(out).toContain('[Plugin Context · py]');
  });

  it('mode=replace + basePolicy=inherit 保留内置基础指令并附着角色段落', () => {
    const out = buildAgentSystemInstruction(
      'en',
      null,
      undefined,
      {
        nameZh: '独立助手',
        nameEn: 'Scoped Helper',
        instructionZh: '补充规则',
        instructionEn: 'Stay concise.',
        mode: 'replace',
        basePolicy: 'inherit',
      },
      'teacher',
    );

    expect(out).toContain('educational OS kernel agent');
    expect(out).toContain('[Persona · Scoped Helper]');
    expect(out).toContain('Stay concise.');
  });

  it('学生角色默认不继承插件上下文切片，即使提供 pluginSlices', () => {
    const out = buildAgentSystemInstruction(
      'zh',
      null,
      ['[Plugin Context · secret]\ninternal teacher notes'],
      {
        nameZh: '学习伴学',
        nameEn: 'Study Buddy',
        instructionZh: '陪伴学生复习。',
        instructionEn: 'Help student review.',
        mode: 'replace',
        basePolicy: 'drop',
      },
      'student',
    );

    expect(out).toContain('陪伴学生复习。');
    expect(out).not.toContain('internal teacher notes');
  });

  it('toolPolicy 支持 allow / deny 与通配符，且 deny 优先、空 allow=[] 清空全部工具', () => {
    expect(
      isToolAllowedByPolicy({ toolName: 'vfs_read_file', commandType: 'vfs.read_file' }, { allow: ['vfs.*'] }),
    ).toBe(true);
    expect(
      isToolAllowedByPolicy({ toolName: 'process_spawn', commandType: 'process.spawn' }, { allow: ['vfs.*'] }),
    ).toBe(false);
    expect(
      isToolAllowedByPolicy(
        { toolName: 'vfs_write_file', commandType: 'vfs.write_file' },
        { allow: ['vfs.*'], deny: ['vfs.write_file'] },
      ),
    ).toBe(false);
    expect(isToolAllowedByPolicy({ toolName: 'lesson_list', commandType: 'lesson.list' }, { allow: [] })).toBe(false);
  });

  it('SEC-01 交集兜底：即使 persona 声明 allow=["*"]，学生角色仍不可获得特权工具或插件技能', () => {
    const fakeSkills: PluginSkillTool[] = [
      {
        toolName: 'pskill_demo_action',
        skillName: 'Demo Skill',
        description: 'Demo',
        commandType: 'demo.action',
        pluginActorId: 'plugin:demo',
        pluginId: 'demo',
      },
    ];

    const studentResolved = resolveToolsForPersona('student', { toolPolicy: { allow: ['*'] } }, fakeSkills);
    const names = Array.from(studentResolved.allowedToolNames);
    expect(names.some((n) => n.startsWith('process_'))).toBe(false);
    expect(names.some((n) => n.startsWith('vfs_'))).toBe(false);
    expect(names).not.toContain('class_create');
    expect(names).not.toContain('pskill_demo_action');
  });

  it('resolveToolsForPersona 对 teacher 应用 toolPolicy 收窄（含插件技能）', () => {
    const fakeSkills: PluginSkillTool[] = [
      {
        toolName: 'pskill_math_solve',
        skillName: 'Solve',
        description: 'Solve math',
        commandType: 'math.solve',
        pluginActorId: 'plugin:math',
        pluginId: 'math',
      },
      {
        toolName: 'pskill_admin_nuke',
        skillName: 'Admin',
        description: 'Admin op',
        commandType: 'admin.nuke',
        pluginActorId: 'plugin:math',
        pluginId: 'math',
      },
    ];

    const resolved = resolveToolsForPersona(
      'teacher',
      { toolPolicy: { allow: ['math.*'], deny: ['admin.*'] } },
      fakeSkills,
    );
    expect(Array.from(resolved.allowedToolNames)).toEqual(['pskill_math_solve']);
  });

  it('resolvePersonaMaxTurns 正确钳位在 1..20，未传默认 5', () => {
    expect(resolvePersonaMaxTurns(undefined)).toBe(5);
    expect(resolvePersonaMaxTurns(0)).toBe(1);
    expect(resolvePersonaMaxTurns(999)).toBe(20);
    expect(resolvePersonaMaxTurns(3)).toBe(3);
  });

  it('runOpenAIAgentChat 遵循 persona.maxTurns 且拒绝执行不在 toolPolicy 内的越权 functionCall', async () => {
    const personaId = 'strict_chat_persona';
    createdIds.push(personaId);
    registerAIPersona(
      {
        id: personaId,
        nameZh: '纯对话严格角色',
        nameEn: 'Strict Chat Persona',
        instructionZh: '不允许调用任何工具。',
        instructionEn: 'No tools allowed.',
        mode: 'replace',
        basePolicy: 'drop',
        toolPolicy: { allow: [] },
        maxTurns: 2,
      },
      PLUGIN_ID,
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'process_spawn', arguments: '{"name":"x"}' },
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runOpenAIAgentChat(
      {
        id: 'prov_1',
        name: 'Mock',
        api_url: 'http://127.0.0.1:9999/v1/chat/completions',
        api_key: '',
        model_name: 'mock-model',
      },
      {
        message: 'hello',
        lang: 'zh',
        callerRole: 'teacher',
        personaId,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.tools).toBeUndefined();
    expect(firstBody.messages[0].content).not.toContain('OS Agent');
    expect(result.toolResults.length).toBeGreaterThan(0);
    expect(result.toolResults[0].success).toBe(false);
    expect(result.toolResults[0].error).toContain('not permitted by the active persona policy');
  });
});
