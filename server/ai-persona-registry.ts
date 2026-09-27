/**
 * ai-persona-registry — 插件注册 AI Agent 角色模板（P2: ai.agent.persona）
 *
 * 场景：第三方插件注册专任 Agent 角色（如「苏格拉底追问者」「反方辩论助手」
 * 「历史名人模拟对话伴学」），教师聊天面板经下拉选择后，Agent 采用该角色的
 * 系统指令（叠加在基础指令之上，不替换工具链）。
 *
 * 注册入口：`ctx.services.ai.registerAIPersona(id, cfg)`（Inline 插件传服务端
 * 闭包无必要 —— persona 是静态模板，Inline/Worker 均可用）。
 * 消费点：`/api/agent/chat` 按 `personaId` 查找并以 `[Persona · <name>]` 段注入。
 */

export interface AIPersonaConfig {
  /** 角色唯一标识 */
  id: string;
  /** 角色名称（zh，如「苏格拉底追问者」） */
  nameZh: string;
  /** 角色名称（en） */
  nameEn: string;
  /** 角色系统指令（zh）—— 叠加在基础 Agent 指令之上 */
  instructionZh: string;
  /** 角色系统指令（en） */
  instructionEn: string;
  /** 展示图标（emoji 或 lucide 名称，可选） */
  icon?: string;
}

export interface AIPersona {
  id: string;
  nameZh: string;
  nameEn: string;
  instructionZh: string;
  instructionEn: string;
  icon?: string;
  registeredBy?: string;
  /** built-in = 宿主种子模板；plugin = 插件注册 */
  source: 'builtin' | 'plugin';
}

interface AIPersonaRegistryState {
  personas: Map<string, AIPersona>;
}

const registry: AIPersonaRegistryState = {
  personas: new Map(),
};

function seedBuiltins(): void {
  const builtin = (cfg: Omit<AIPersona, 'source'>) => registry.personas.set(cfg.id, { ...cfg, source: 'builtin' });

  builtin({
    id: 'socratic_questioner',
    nameZh: '苏格拉底追问者',
    nameEn: 'Socratic Questioner',
    instructionZh:
      '你现在切换为「苏格拉底追问者」角色：不直接给出答案，而是通过一连串有层次的追问引导学生自己发现结论。每次回复最多提出 1-2 个问题，聚焦学生表述中的模糊点或未经验证的假设。保持友善但坚持让学生自己推理。',
    instructionEn:
      'You are now in "Socratic Questioner" mode: never hand over the answer directly. Guide the student with layered follow-up questions, one or two at a time. Challenge assumptions kindly but firmly, and keep pushing the student to articulate their own reasoning.',
    icon: '🤔',
  });

  builtin({
    id: 'debate_opponent',
    nameZh: '反方辩论助手',
    nameEn: 'Debate Opponent',
    instructionZh:
      '你现在切换为「反方辩论助手」角色：针对老师或学生提出的观点，始终站在反方立场给出有理有据的反驳，每次反驳控制在 3 句话以内，并在最后提出一个引导学生换位思考的问题。',
    instructionEn:
      'You are now in "Debate Opponent" mode: always argue from the opposing side with well-reasoned counterpoints (max 3 sentences), then end with one perspective-shifting question.',
    icon: '⚔️',
  });

  builtin({
    id: 'historical_figure',
    nameZh: '历史名人模拟对话',
    nameEn: 'Historical Figure Roleplay',
    instructionZh:
      '你现在切换为「历史名人模拟对话」角色：根据对话中出现的历史人物名称，以该人物的第一人称视角、用语习惯与时代背景进行对话，对话中自然融入该时代的历史事实，并在结尾以人物口吻提出一个反思问题。',
    instructionEn:
      'You are in "Historical Figure" mode: adopt the first-person voice of the historical figure named in the conversation, weave period-accurate facts into the dialogue, and end with one reflective question in character.',
    icon: '🏛️',
  });

  builtin({
    id: 'plain_assistant',
    nameZh: '普通助教（默认）',
    nameEn: 'Plain Assistant (Default)',
    instructionZh: '保持基础 OS Agent 行为，不附加任何角色设定。',
    instructionEn: 'Base OS Agent behavior, no persona overlay.',
    icon: '🤖',
  });
}

seedBuiltins();

/** 注册角色模板（插件 or 宿主；同 id 覆盖，builtin 可被同名插件更新） */
export function registerAIPersona(
  config: Omit<AIPersona, 'source'> & { source?: 'builtin' | 'plugin' },
  registeredBy?: string,
): void {
  if (!config?.id?.trim() || !config.instructionZh?.trim()) {
    throw new Error('[AIPersonaRegistry] id and instructionZh are required');
  }
  registry.personas.set(config.id.trim(), {
    ...config,
    id: config.id.trim(),
    registeredBy: registeredBy ?? config.registeredBy,
    source: config.source ?? 'plugin',
  } as AIPersona);
}

export function getAIPersona(id: string | null | undefined): AIPersona | undefined {
  if (!id) return undefined;
  return registry.personas.get(id);
}

/** 教师聊天面板选择列表（全量，含 builtin + plugin） */
export function listAIPersonas(): AIPersona[] {
  return Array.from(registry.personas.values());
}

/** 注销插件注册的角色（builtin 不可注销） */
export function unregisterAIPersona(id: string, registeredBy?: string): void {
  const persona = registry.personas.get(id);
  if (!persona || persona.source === 'builtin') return;
  if (registeredBy && persona.registeredBy && persona.registeredBy !== registeredBy) return;
  registry.personas.delete(id);
}

/**
 * 服务器启动时接线：把角色注册表委托给 kernel AIService（插件经
 * ctx.services.ai.registerAIPersona 调用的真源落地在此）。
 */
export function bindAIPersonaRegistry(kernelAIService: {
  bindPersonaRegistry(delegates: {
    register: (persona: AIPersona) => void;
    list: () => AIPersona[];
    unregister: (id: string, registeredBy?: string) => void;
  }): void;
}): void {
  kernelAIService.bindPersonaRegistry({
    register: (persona) => registerAIPersona(persona, persona.registeredBy),
    list: () => listAIPersonas(),
    unregister: (id, registeredBy) => unregisterAIPersona(id, registeredBy),
  });
}
