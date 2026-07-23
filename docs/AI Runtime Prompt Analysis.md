# OpenLearn AI Runtime Prompt Analysis (AI 运行时 Prompt 分析报告)

## 1. Executive Summary (概述)

本报告审查 AI Runtime 中的 Prompt 模版、系统指令构建逻辑（`buildAgentSystemInstruction`）、提示词拼装（`buildAgentFinalMessage`）以及多语言（中文/英文）支持。

---

## 2. System Instruction Audit (系统 Prompt 渲染审计)

```typescript
// Located in server.ts:
const buildAgentSystemInstruction = (lang: 'zh' | 'en', currentLessonId?: string | null) => {
  let systemInstruction = lang === 'zh'
    ? '你是一个教育系统底层的 OS Agent。你需要理解老师的指令，并调用可用的工具（命令）去执行这些操作...'
    : 'You are an educational OS kernel agent. You interpret teacher instructions and use your available tools...';
  if (currentLessonId) {
    systemInstruction += `\n[Context] The current selected lesson ID is "${currentLessonId}"...`;
  }
  return systemInstruction;
};
```

---

## 3. Attachment & Message Formatting (附件与消息打包)

- 支持 JSON, CSV, Markdown 与 ZIP 压缩包的智能消息打包。
- `buildAgentFinalMessage` 自动将超过 5000 字符或 ZIP 文件的二进制数据转译为 Base64 索引块（`ATTACHMENT_BASE64:N`），有效节省 Context Window 消耗。
