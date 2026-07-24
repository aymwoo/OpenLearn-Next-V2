# OpenLearn AI Runtime Tool Analysis (AI 运行时工具分析报告)

## 1. Executive Summary (概述)

本报告审查 AI Runtime 的 Tool 注册、Tool 检索与 Tool 调度链路（Tool Calling & Action Conversion）。

---

## 2. Tool Calling Flow (工具调用链路)

```mermaid
graph LR
    UserInstruction["User Instruction"] --> AgentInstruction["OS Agent System Prompt"]
    AgentInstruction --> FunctionCall["Function Call Output"]
    FunctionCall --> CommandBus["CommandBus.execute(command)"]
    CommandBus --> ToolResult["Tool Execution Result"]
    ToolResult --> NextTurn["Next Conversation Turn"]
```

---

## 3. Supported Tool Commands (支持的工具能力)

- **Classroom & Student Tools**: `class_create`, `student_create`, `class_add_student`
- **Process Management Tools**: `process.spawn`, `process.kill`, `process.list`
- **VFS Storage Tools**: `vfs.write_file`, `vfs.read_file`, `vfs.list_dir`
- **Lesson Content Tools**: 自动生成丰富格式课程大纲与课件内容
