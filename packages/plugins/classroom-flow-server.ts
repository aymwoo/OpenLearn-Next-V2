/**
 * ClassroomFlowServer 内置插件：注册通讯协议的发送命令 `classroom.sendMessage`。
 *
 * 前端插件经 ctx.invokeCommand('classroom.sendMessage', payload) 发送可靠消息；
 * 本命令 handler 调 ClassroomMessageService.send()（含 channel 归属校验）。
 * 走命令总线 = 复用 default-deny + ActionDescriptor 授权 + 幂等，是平台规范写路径。
 *
 * 发送者身份由宿主注入的 command.actorId 派生（插件为 plugin:<id>），不可伪造；
 * 因此插件只能往自己拥有的 channel（或 shared 通道）发消息。
 */
import {
  ICommandBusServiceToken,
  IActionRegistryServiceToken,
  IClassroomMessageServiceToken,
  type ICommandBusService,
  type IActionRegistryService,
  type IClassroomMessageService,
} from '../core/di/interfaces.js';
import type { PluginContext } from '@openlearn/plugin-sdk';

const COMMAND_TYPE = 'classroom.sendMessage';

/** 从 actorId 派生 senderPluginId 与 senderRole（actorId 由宿主注入，不可伪造） */
function deriveSender(actorId: string): { senderPluginId: string | null; senderRole: string } {
  if (actorId.startsWith('plugin:')) {
    return { senderPluginId: actorId.slice(7), senderRole: 'plugin' };
  }
  const roleMatch = /^user:[^:]+:(administrator|admin|teacher|student)$/.exec(actorId);
  return { senderPluginId: null, senderRole: roleMatch?.[1] ?? 'system' };
}

export const ClassroomFlowServerPlugin = {
  manifest: {
    id: '@openlearn/plugin-classroom-flow-server',
    name: 'Classroom Flow Server Plugin',
    version: '1.0.0',
    main: 'index.js',
    requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    capabilitiesProposed: ['lesson:write'],
  },

  async activate(ctx: PluginContext) {
    const commandBus = (await ctx.resolve(ICommandBusServiceToken)) as ICommandBusService;
    const actionRegistry = (await ctx.resolve(IActionRegistryServiceToken)) as IActionRegistryService;
    const messageService = (await ctx.resolve(IClassroomMessageServiceToken)) as IClassroomMessageService;

    await actionRegistry.register({
      id: 'classroom-send-message',
      commandType: COMMAND_TYPE,
      description: '发送一条课堂可靠消息（学案步骤/测验交卷/互动信号等），经 channel 归属校验',
      capabilityRequired: 'lesson:write',
      exposeToAgent: false, // 传输命令，不交给 Agent 自主决策
      inputSchema: {
        type: 'OBJECT',
        properties: {
          channel: { type: 'STRING', description: '已注册的 channel 名（如 xuean:task）' },
          msgType: { type: 'STRING', description: 'request 或 response' },
          lessonId: { type: 'STRING' },
          classId: { type: 'STRING' },
          targetUserIds: { type: 'ARRAY', description: '定向用户 id 列表；空表示房间广播' },
          correlationId: { type: 'STRING' },
          payload: { type: 'OBJECT', description: '业务载荷' },
          ttlMs: { type: 'NUMBER' },
          messageId: { type: 'STRING', description: '幂等键；缺省生成' },
        },
        required: ['channel', 'msgType', 'payload'],
      },
    });

    await commandBus.registerHandler(COMMAND_TYPE, {
      async execute(command) {
        const p = command.payload as Record<string, unknown>;
        const { senderPluginId, senderRole } = deriveSender(command.actorId);
        const result = messageService.send({
          channel: String(p.channel ?? ''),
          msgType: p.msgType === 'response' ? 'response' : 'request',
          lessonId: (p.lessonId as string | null) ?? null,
          classId: (p.classId as string | null) ?? null,
          targetUserIds: (p.targetUserIds as string[] | null) ?? null,
          correlationId: (p.correlationId as string | null) ?? null,
          payload: p.payload ?? {},
          ttlMs: (p.ttlMs as number | null) ?? null,
          messageId: p.messageId as string | undefined,
          senderActorId: command.actorId,
          senderRole,
          senderPluginId,
        });
        if (!result.ok) {
          throw new Error(`[classroom.sendMessage] ${result.code}: ${result.error}`);
        }
        return { ok: true, messageId: result.messageId, seq: result.seq, duplicated: result.duplicated };
      },
    });
  },
};
