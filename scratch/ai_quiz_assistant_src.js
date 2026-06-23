// <stdin>
var index_default = {
  manifest: {
    id: "ext-ai-quiz-assistant",
    name: "AI Quiz Assistant",
    version: "1.0.0"
  },
  activate: async (ctx) => {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    await actionRegistry.register({
      id: "ext-ai-quiz-create",
      commandType: "quiz.create",
      description: "Create a quiz on the whiteboard",
      capabilityRequired: "whiteboard:write",
      inputSchema: {
        type: "OBJECT",
        properties: {
          lessonId: { type: "STRING" },
          question: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["lessonId", "question", "options"]
      }
    });
    await commandBus.registerHandler("quiz.create", {
      execute: async (command) => {
        const payload = command.payload;
        const result = await commandBus.execute({
          id: "int_" + Math.random().toString(36).slice(2),
          type: "whiteboard.draw",
          actorId: command.actorId || "agent-system-0",
          payload: {
            lessonId: payload.lessonId,
            type: "quiz",
            data: JSON.stringify({
              question: payload.question,
              options: payload.options,
              x: payload.x || 120,
              y: payload.y || 120,
              width: 320,
              height: 280,
              isMinimized: false
            })
          }
        });
        return { success: true, elementId: result?.elementId };
      }
    });
  },
  deactivate: async () => {
  }
};
export {
  index_default as default
};
